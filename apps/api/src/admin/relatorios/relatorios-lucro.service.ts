import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AvisosLucro,
  CustosLucro,
  LinhaLucroVeiculo,
  RelatorioLucroQuery,
  RelatorioLucroResposta,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { resolverRemuneracao, type RegraRemuneracao } from "../../common/acerto-motorista";
import type { EscopoAdmin } from "../../common/escopo/escopo";
import { comEscopo } from "../../common/escopo/escopo";
import {
  calcularLucroVeiculo,
  type AbastecimentoParaLucro,
  type CustoFixoParaLucro,
  type DespesaParaLucro,
  type EntradaLucroVeiculo,
  type PedagioAvulsoParaLucro,
} from "../../common/lucro-veiculo";
import type { ViagemParaResultado } from "../../common/resultado-obra";
import { dentroDeEmprego, soDigitos } from "../../common/regime-vigente";
import { inicioDoDiaBR } from "../../common/timezone";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";

type Periodo = { inicio: Date; fim: Date | null };

/** Dia civil como meia-noite UTC — o formato das colunas @db.Date. */
function diaUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * Lucro por caminhão. Este service só BUSCA e decide, por linha, de quem foi o
 * dinheiro; a conta mora em `common/lucro-veiculo.ts`, com teste.
 *
 * Tudo é buscado de uma vez por tipo de registro e agrupado em memória por
 * caminhão — uma consulta por caminhão seria N×7 idas ao banco, e o servidor
 * fica longe do banco o bastante pra isso aparecer.
 */
@Injectable()
export class RelatoriosLucroService {
  constructor(private readonly prisma: PrismaService) {}

  async lucroPorVeiculo(q: RelatorioLucroQuery, escopo: EscopoAdmin): Promise<RelatorioLucroResposta> {
    const caminhoes = await this.carregarCaminhoes(q, escopo);
    const linhas: LinhaLucroVeiculo[] = [];
    for (const { veiculo: v, entrada } of caminhoes) {
      const r = calcularLucroVeiculo(entrada);

      // Caminhão desativado sem nenhum movimento não é linha: é cadastro velho.
      // Ativo parado entra — custo fixo sem viagem é exatamente o que se quer ver.
      const teveMovimento =
        r.viagens > 0 ||
        entrada.abastecimentos.length > 0 ||
        entrada.pedagiosAvulsos.length > 0 ||
        !new Prisma.Decimal(r.gastou).isZero();
      if (!v.ativo && !teveMovimento) continue;

      linhas.push({ veiculoId: v.id, placa: v.placa, modelo: v.modelo, ...r });
    }

    linhas.sort((a, b) => Number(a.sobrou) - Number(b.sobrou) || a.placa.localeCompare(b.placa));

    return { periodo: { de: q.de, ate: q.ate }, veiculos: linhas, frota: totalizar(linhas) };
  }

  /**
   * Busca e monta a entrada de cada caminhão. Separado da conta porque o
   * resultado por obra (`relatorios-resultado-obra.service.ts`) parte
   * EXATAMENTE destas entradas: se cada relatório buscasse do seu jeito, a obra
   * e o caminhão contariam o mesmo dinheiro de dois jeitos.
   *
   * As viagens já vêm com a obra (cliente) e o pedágio repassado — o lucro
   * ignora, o resultado por obra usa. A estadia fica com quem precisa dela.
   */
  async carregarCaminhoes(
    q: RelatorioLucroQuery,
    escopo: EscopoAdmin,
  ): Promise<
    {
      veiculo: { id: string; placa: string; modelo: string | null; ativo: boolean };
      entrada: EntradaLucroVeiculo & { viagens: ViagemParaResultado[] };
    }[]
  > {
    const veiculos = await this.prisma.veiculo.findMany({
      where: comEscopo(
        q.transportadoraId ? { transportadoraId: q.transportadoraId } : {},
        escopo,
      ) as Prisma.VeiculoWhereInput,
      select: { id: true, placa: true, modelo: true, ativo: true },
    });
    const ids = veiculos.map((v) => v.id);

    // Datas: `Viagem.data`, `Pedagio.data` e `TituloPagar.emissao` são
    // @db.Date (meia-noite UTC, `lte` no último dia). Abastecimento, conclusão
    // de manutenção e multa são instantes: o dia ancora em Brasília e o fim é
    // `lt` no dia seguinte, senão o que aconteceu depois das 21h do último dia
    // fica de fora.
    const diaDe = diaUtc(q.de);
    const diaAte = diaUtc(q.ate);
    const instanteDe = inicioDoDiaBR(q.de);
    const instanteAte = new Date(inicioDoDiaBR(q.ate).getTime() + 86_400_000);

    const [viagens, abastecimentos, pedagiosAvulsos, manutencoes, multas, titulos, custosFixos] =
      await Promise.all([
        this.prisma.viagem.findMany({
          where: comEscopo(
            {
              veiculoId: { in: ids },
              data: { gte: diaDe, lte: diaAte },
              // Mesmo corte do fechamento e do acerto: viagem sem peso entraria
              // como 0t e frete zero.
              status: { notIn: STATUS_FORA_FECHAMENTO },
            },
            escopo,
          ) as Prisma.ViagemWhereInput,
          select: {
            id: true,
            data: true,
            ticket: true,
            km: true,
            toneladas: true,
            valorPedagioTotal: true,
            veiculoId: true,
            motoristaId: true,
            valor: { select: { valorFrete: true, valorTotal: true, valorPedagio: true } },
            clienteId: true,
            cliente: { select: { nome: true, empresaId: true, empresa: { select: { nome: true } } } },
            pedagios: { select: { id: true, valor: true } },
            itensAcerto: { where: { tipo: "FRETE" }, select: { valor: true } },
          },
        }),
        this.prisma.abastecimento.findMany({
          where: comEscopo(
            { veiculoId: { in: ids }, data: { gte: instanteDe, lt: instanteAte } },
            escopo,
          ) as Prisma.AbastecimentoWhereInput,
          select: {
            id: true,
            veiculoId: true,
            motoristaId: true,
            data: true,
            tipo: true,
            litros: true,
            valorTotal: true,
            emComboio: true,
          },
        }),
        this.prisma.pedagio.findMany({
          where: comEscopo(
            // Os vinculados a viagem já entram por `pedagioDaViagem`.
            { veiculoId: { in: ids }, viagemId: null, data: { gte: diaDe, lte: diaAte } },
            escopo,
          ) as Prisma.PedagioWhereInput,
          select: { id: true, veiculoId: true, motoristaId: true, data: true, valor: true },
        }),
        this.prisma.manutencaoVeiculo.findMany({
          where: {
            veiculoId: { in: ids },
            status: "CONCLUIDA",
            concluidaEm: { gte: instanteDe, lt: instanteAte },
          },
          select: {
            id: true,
            veiculoId: true,
            descricao: true,
            concluidaEm: true,
            valorTotal: true,
            valorPecas: true,
            valorMaoObra: true,
          },
        }),
        this.prisma.multa.findMany({
          where: {
            veiculoId: { in: ids },
            ocorridaEm: { gte: instanteDe, lt: instanteAte },
            status: { not: "CANCELADA" },
            // A que foi descontada do motorista não saiu do caixa da empresa.
            descontarDoMotorista: false,
          },
          select: { id: true, veiculoId: true, infracao: true, ocorridaEm: true, valor: true },
        }),
        this.prisma.tituloPagar.findMany({
          where: {
            veiculoId: { in: ids },
            emissao: { gte: diaDe, lte: diaAte },
            status: { not: "CANCELADO" },
            // Conta de oficina já entra pela manutenção, e a do acerto é o
            // motorista — contar aqui seria a mesma despesa duas vezes.
            acertoId: null,
            manutencao: { is: null },
          },
          select: { id: true, veiculoId: true, descricao: true, emissao: true, valor: true },
        }),
        this.prisma.custoFixoVeiculo.findMany({
          where: {
            veiculoId: { in: ids },
            vigenciaDe: { lte: diaAte },
            OR: [{ vigenciaAte: null }, { vigenciaAte: { gte: diaDe } }],
          },
          select: {
            id: true,
            veiculoId: true,
            tipo: true,
            valorMensal: true,
            vigenciaDe: true,
            vigenciaAte: true,
          },
        }),
      ]);

    // ---- quem pagou: régua e vínculo de emprego de cada motorista ----------
    const motoristaIds = [
      ...new Set([
        ...viagens.map((v) => v.motoristaId),
        ...abastecimentos.map((a) => a.motoristaId),
        ...pedagiosAvulsos.map((p) => p.motoristaId),
      ]),
    ];
    const motoristas = await this.prisma.motorista.findMany({
      where: { id: { in: motoristaIds } },
      select: {
        id: true,
        cpf: true,
        tipoRemuneracao: true,
        percentualFrete: true,
        valorPorViagem: true,
        valorPorTonelada: true,
        valorPorKm: true,
        modalidade: true,
      },
    });
    const cpfs = [...new Set(motoristas.map((m) => soDigitos(m.cpf ?? "")).filter((c) => c.length === 11))];
    const regimes = cpfs.length
      ? await this.prisma.regimeVigente.findMany({
          where: { cpf: { in: cpfs }, regime: "EMPREGADO" },
          select: { cpf: true, iniciouEm: true, encerradoEm: true },
        })
      : [];
    const empregoPorCpf = new Map<string, Periodo[]>();
    for (const r of regimes) {
      const lista = empregoPorCpf.get(r.cpf) ?? [];
      lista.push({ inicio: r.iniciouEm, fim: r.encerradoEm });
      empregoPorCpf.set(r.cpf, lista);
    }

    const pagador = new Map<string, { regra: RegraRemuneracao; emprego: Periodo[] }>();
    for (const m of motoristas) {
      pagador.set(m.id, {
        regra: resolverRemuneracao(m, m.modalidade),
        emprego: empregoPorCpf.get(soDigitos(m.cpf ?? "")) ?? [],
      });
    }
    /** Régua do motorista no dia. Null = era empregado (salário, não régua). */
    const reguaNoDia = (motoristaId: string, data: Date): RegraRemuneracao | null => {
      const p = pagador.get(motoristaId);
      // Motorista apagado: sem régua conhecida, cai no padrão (devolve tudo).
      if (!p) return resolverRemuneracao(null, null);
      return dentroDeEmprego(p.emprego, data) ? null : p.regra;
    };

    // ---- preço médio do litro, por tipo, pro comboio sem valor ------------
    const somaPreco = new Map<string, { valor: Prisma.Decimal; litros: Prisma.Decimal }>();
    for (const a of abastecimentos) {
      if (a.valorTotal == null || a.valorTotal.lte(0)) continue;
      const s = somaPreco.get(a.tipo) ?? { valor: new Prisma.Decimal(0), litros: new Prisma.Decimal(0) };
      s.valor = s.valor.add(a.valorTotal);
      s.litros = s.litros.add(a.litros);
      somaPreco.set(a.tipo, s);
    }
    const precoMedioLitro: Record<string, string> = {};
    for (const [tipo, s] of somaPreco) {
      if (s.litros.gt(0)) precoMedioLitro[tipo] = s.valor.div(s.litros).toFixed(4);
    }

    // ---- agrupa por caminhão ----------------------------------------------
    const porVeiculo = <T extends { veiculoId: string | null }>(lista: T[]) => {
      const m = new Map<string, T[]>();
      for (const item of lista) {
        if (!item.veiculoId) continue;
        const atual = m.get(item.veiculoId) ?? [];
        atual.push(item);
        m.set(item.veiculoId, atual);
      }
      return m;
    };
    const viagensPor = porVeiculo(viagens);
    const abastPor = porVeiculo(abastecimentos);
    const pedagiosPor = porVeiculo(pedagiosAvulsos);
    const manutPor = porVeiculo(manutencoes);
    const multasPor = porVeiculo(multas);
    const titulosPor = porVeiculo(titulos);
    const custosPor = porVeiculo(custosFixos);

    const saida: Awaited<ReturnType<RelatoriosLucroService["carregarCaminhoes"]>> = [];
    for (const v of veiculos) {
      const vs: ViagemParaResultado[] = (viagensPor.get(v.id) ?? [])
        .filter((x): x is typeof x & { data: Date } => x.data != null)
        .map((x) => ({
          id: x.id,
          data: x.data,
          ticket: x.ticket,
          km: x.km,
          toneladas: x.toneladas,
          valorPedagioTotal: x.valorPedagioTotal,
          valorFrete: x.valor?.valorFrete ?? null,
          pedagios: x.pedagios,
          valorTotal: x.valor?.valorTotal ?? null,
          // Uma viagem pode estar em mais de um acerto só por erro; somar
          // pagaria duas vezes no relatório também. Vale o primeiro — e a
          // tela AVISA, porque o erro aqui é dinheiro que saiu duas vezes.
          freteAcertado: x.itensAcerto[0]?.valor ?? null,
          itensDeFreteNoAcerto: x.itensAcerto.length,
          regra: reguaNoDia(x.motoristaId, x.data),
          obra:
            x.clienteId && x.cliente
              ? {
                  clienteId: x.clienteId,
                  obra: x.cliente.nome,
                  empresaId: x.cliente.empresaId,
                  empresa: x.cliente.empresa.nome,
                }
              : null,
          pedagioCobrado: x.valor?.valorPedagio ?? null,
          estadia: null,
        }));

      const abs: AbastecimentoParaLucro[] = (abastPor.get(v.id) ?? []).map((a) => {
        const regra = reguaNoDia(a.motoristaId, a.data);
        return {
          id: a.id,
          tipo: a.tipo,
          litros: a.litros,
          valorTotal: a.valorTotal,
          emComboio: a.emComboio,
          empresaPaga: regra == null || regra.reembolsaAbastecimento,
        };
      });

      const peds: PedagioAvulsoParaLucro[] = (pedagiosPor.get(v.id) ?? []).map((p) => {
        const regra = reguaNoDia(p.motoristaId, p.data);
        return { id: p.id, valor: p.valor, empresaPaga: regra == null || regra.reembolsaPedagio };
      });

      const manut: DespesaParaLucro[] = (manutPor.get(v.id) ?? []).map((m) => {
        const partes =
          m.valorPecas != null || m.valorMaoObra != null
            ? (m.valorPecas ?? new Prisma.Decimal(0)).add(m.valorMaoObra ?? new Prisma.Decimal(0))
            : null;
        return {
          id: m.id,
          data: m.concluidaEm!,
          descricao: m.descricao,
          valor: m.valorTotal ?? partes,
        };
      });

      const mult: DespesaParaLucro[] = (multasPor.get(v.id) ?? []).map((m) => ({
        id: m.id,
        data: m.ocorridaEm,
        descricao: m.infracao,
        valor: m.valor,
      }));

      const outras: DespesaParaLucro[] = (titulosPor.get(v.id) ?? []).map((t) => ({
        id: t.id,
        data: t.emissao,
        descricao: t.descricao,
        valor: t.valor,
      }));

      const fixos: CustoFixoParaLucro[] = (custosPor.get(v.id) ?? []).map((c) => ({
        id: c.id,
        tipo: c.tipo,
        valorMensal: c.valorMensal,
        vigenciaDe: c.vigenciaDe,
        vigenciaAte: c.vigenciaAte,
      }));

      saida.push({
        veiculo: v,
        entrada: {
          de: q.de,
          ate: q.ate,
          viagens: vs,
          abastecimentos: abs,
          pedagiosAvulsos: peds,
          manutencoes: manut,
          multas: mult,
          outrasContas: outras,
          custosFixos: fixos,
          precoMedioLitro,
        },
      });
    }
    return saida;
  }
}

function totalizar(linhas: LinhaLucroVeiculo[]): RelatorioLucroResposta["frota"] {
  const soma = (f: (l: LinhaLucroVeiculo) => string) =>
    linhas.reduce((acc, l) => acc.add(f(l)), new Prisma.Decimal(0));
  const chavesCusto: (keyof CustosLucro)[] = [
    "motorista",
    "combustivel",
    "pedagio",
    "manutencao",
    "multas",
    "custosFixos",
    "outrasContas",
  ];
  const custos = Object.fromEntries(
    chavesCusto.map((k) => [k, soma((l) => l.custos[k]).toFixed(2)]),
  ) as CustosLucro;
  const chavesAviso: (keyof AvisosLucro)[] = [
    "viagensSemPreco",
    "viagensSemCustoMotorista",
    "viagensEmpregado",
    "abastecimentosEstimados",
    "abastecimentosSemPreco",
    "manutencoesSemValor",
    "viagensEmMaisDeUmAcerto",
  ];
  const avisos = Object.fromEntries(
    chavesAviso.map((k) => [k, linhas.reduce((s, l) => s + l.avisos[k], 0)]),
  ) as AvisosLucro;

  const faturou = soma((l) => l.faturou);
  const gastou = soma((l) => l.gastou);
  const sobrou = faturou.sub(gastou);
  const km = soma((l) => l.km);
  const porKm = km.gt(0)
    ? {
        faturou: faturou.div(km).toFixed(2),
        gastou: gastou.div(km).toFixed(2),
        sobrou: sobrou.div(km).toFixed(2),
        custos: Object.fromEntries(
          chavesCusto.map((k) => [k, new Prisma.Decimal(custos[k]).div(km).toFixed(2)]),
        ) as Record<keyof CustosLucro, string>,
      }
    : null;
  return {
    veiculos: linhas.length,
    viagens: linhas.reduce((s, l) => s + l.viagens, 0),
    km: km.toFixed(0),
    porKm,
    faturou: faturou.toFixed(2),
    gastou: gastou.toFixed(2),
    sobrou: sobrou.toFixed(2),
    margem: faturou.gt(0) ? Number(sobrou.div(faturou).mul(100).toFixed(1)) : null,
    custos,
    foraDaConta: {
      combustivel: soma((l) => l.foraDaConta.combustivel).toFixed(2),
      pedagio: soma((l) => l.foraDaConta.pedagio).toFixed(2),
    },
    avisos,
  };
}
