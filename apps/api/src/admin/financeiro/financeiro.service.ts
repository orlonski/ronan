import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma } from "@prisma/client";
import type {
  AtualizarFaturaInput,
  CriarTituloPagarInput,
  DarBaixaInput,
  GerarFaturaInput,
  PreviaFaturaQuery,
  PreviaSobretaxa,
  SobretaxaCongelada,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { estadiasCobraveis } from "../../common/estadia-fatura";
import { calcularSobretaxa, precoMedioDiesel, TIPOS_DIESEL } from "../../common/sobretaxa-combustivel";
import { resolverRemuneracao } from "../../common/acerto-motorista";
import { dentroDeEmprego, soDigitos } from "../../common/regime-vigente";
import { inicioDoDiaBR } from "../../common/timezone";
import {
  apurarTitulo,
  gerarParcelas,
  montarAging,
  vencimentoPeloPrazo,
  type TituloParaAging,
} from "../../common/financeiro";

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

@Injectable()
export class FinanceiroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ---------------------------------------------------------------- faturas

  /**
   * Transforma o período conferido em cobrança.
   *
   * As linhas saem do `ViagemValor` — o valor congelado de cada viagem — e são
   * copiadas pra `FaturaLinha`. A cópia é o ponto: a fatura emitida não pode
   * mudar porque alguém corrigiu o km depois. Mês fechado que muda sozinho é
   * como a contabilidade do cliente perde a fé no sistema.
   */
  async gerarFatura(input: GerarFaturaInput, usuarioId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: input.empresaId },
      select: { id: true, nome: true, prazoPagamentoDias: true },
    });
    if (!empresa) throw new NotFoundException("Cliente não encontrado");

    const inicio = diaUtc(input.periodoInicio);
    const fim = diaUtc(input.periodoFim);

    const viagens = await this.viagensFaturaveis(empresa.id, inicio, fim);

    if (viagens.length === 0) {
      throw new BadRequestException(
        `Nenhuma viagem com valor pra faturar de ${empresa.nome} nesse período. ` +
          `Confira se a tabela de preços está cadastrada e se as viagens já foram precificadas.`,
      );
    }

    // Estadia: só as que a prévia ofereceu E quem fatura deixou marcadas, e
    // recalculadas aqui — o valor que vale é o do servidor, não o da tela.
    const pedidas = new Set(input.estadias);
    const estadias = pedidas.size
      ? (await this.estadiasDe(viagens.map((v) => v.id))).filter((e) => pedidas.has(e.eventoId))
      : [];
    const viagemPorId = new Map(viagens.map((v) => [v.id, v]));

    // Sobretaxa: recalculada aqui com a mesma função da prévia. Só entra com
    // regra ligada, conta que deu valor e quem fatura sem ter desmarcado.
    const sobretaxa = input.aplicarSobretaxa
      ? await this.sobretaxaDe(empresa.id, input.periodoInicio, input.periodoFim, viagens, input.precoDiesel ?? null)
      : null;
    const linhaSobretaxa = sobretaxa?.aplica ? sobretaxa.calculo : null;

    const bruto = viagens
      .reduce((acc, v) => acc.add(new Prisma.Decimal(v.valor!.valorTotal)), new Prisma.Decimal(0))
      .add(estadias.reduce((acc, e) => acc.add(e.valor), new Prisma.Decimal(0)))
      .add(linhaSobretaxa ? new Prisma.Decimal(linhaSobretaxa.valor) : 0);

    const prazo = input.prazoDias ?? empresa.prazoPagamentoDias ?? null;
    const parcelas = gerarParcelas({
      valorTotal: bruto,
      parcelas: input.parcelas,
      primeiroVencimento: vencimentoPeloPrazo(fim, prazo),
    });

    const fatura = await this.prisma.$transaction(async (tx) => {
      const ultima = await tx.fatura.aggregate({ _max: { numero: true } });
      const criada = await tx.fatura.create({
        data: {
          numero: (ultima._max.numero ?? 0) + 1,
          empresaId: empresa.id,
          fechamentoId: input.fechamentoId ?? null,
          periodoInicio: inicio,
          periodoFim: fim,
          valorBruto: bruto,
          valorLiquido: bruto,
          observacao: input.observacao ?? null,
          criadoPorId: usuarioId,
        },
      });

      await tx.faturaLinha.createMany({
        // `Viagem.data` é nullable (o lifecycle abre sem data). O filtro de
        // status já tira as incompletas, mas o tipo não sabe — e faturar uma
        // viagem sem data seria cobrar por algo que não dá pra localizar no
        // período.
        data: viagens
          .filter((v): v is typeof v & { data: Date } => v.data != null)
          .map((v) => ({
          faturaId: criada.id,
          viagemId: v.id,
          descricao: [
            v.data.toISOString().slice(0, 10).split("-").reverse().join("/"),
            v.ticket ? `ticket ${v.ticket}` : null,
            v.cliente?.nome,
            v.material?.nome,
          ]
            .filter(Boolean)
            .join(" · "),
          quantidade: v.valor!.quantidade,
          precoUnitario: v.valor!.precoUnitario,
          valor: v.valor!.valorTotal,
        })),
      });

      if (estadias.length > 0) {
        await tx.faturaLinha.createMany({
          data: estadias.map((e) => {
            const v = viagemPorId.get(e.viagemId);
            return {
              faturaId: criada.id,
              viagemId: e.viagemId,
              eventoViagemId: e.eventoId,
              descricao: [
                "Estadia",
                v?.data ? v.data.toISOString().slice(0, 10).split("-").reverse().join("/") : null,
                v?.ticket ? `ticket ${v.ticket}` : null,
                e.tipoNome,
                `${e.horasCobradas}h`,
              ]
                .filter(Boolean)
                .join(" · "),
              quantidade: e.horasCobradas,
              precoUnitario: e.valorHora,
              valor: e.valor,
            };
          }),
        });
      }

      if (linhaSobretaxa) {
        const { descricao, ...numeros } = linhaSobretaxa;
        await tx.faturaLinha.create({
          data: {
            faturaId: criada.id,
            descricao,
            quantidade: 1,
            precoUnitario: numeros.valor,
            valor: numeros.valor,
            sobretaxa: numeros satisfies SobretaxaCongelada,
          },
        });
      }

      await tx.tituloReceber.createMany({
        data: parcelas.map((p) => ({
          faturaId: criada.id,
          empresaId: empresa.id,
          parcela: p.parcela,
          emissao: new Date(),
          vencimento: p.vencimento,
          valor: p.valor,
        })),
      });

      return criada;
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Fatura",
      entidadeId: fatura.id,
      acao: AcaoAuditoria.UPDATE,
      motivo: `Fatura ${fatura.numero} gerada com ${viagens.length} viagem(ns)`,
      valorDepois: { valorBruto: bruto.toFixed(2), parcelas: parcelas.length },
    });

    return this.detalheFatura(fatura.id);
  }

  /**
   * As viagens que entram numa fatura. Uma regra só pra prévia e pra geração —
   * se as duas divergissem, a tela mostraria um total e a fatura sairia com
   * outro.
   */
  private viagensFaturaveis(empresaId: string, inicio: Date, fim: Date) {
    return this.prisma.viagem.findMany({
      where: {
        cliente: { empresaId },
        data: { gte: inicio, lte: fim },
        status: { notIn: STATUS_FORA_FECHAMENTO },
        // Só o que tem valor: viagem sem preço cadastrado entraria como R$ 0,00
        // na fatura, e zero numa cobrança parece conferido e aceito.
        valor: { isNot: null },
        // Não refatura o que já está em fatura viva.
        faturaLinhas: { none: { fatura: { status: { not: "CANCELADA" } }, eventoViagemId: null } },
      },
      select: {
        id: true,
        data: true,
        ticket: true,
        cliente: { select: { nome: true } },
        material: { select: { nome: true } },
        valor: {
          select: { quantidade: true, precoUnitario: true, valorFrete: true, valorTotal: true, base: true },
        },
      },
      orderBy: { data: "asc" },
    });
  }

  /** Estadias encerradas e ainda não faturadas destas viagens (common/estadia-fatura.ts). */
  private async estadiasDe(viagemIds: string[]) {
    if (viagemIds.length === 0) return [];
    const eventos = await this.prisma.eventoViagem.findMany({
      where: { viagemId: { in: viagemIds }, tipoEvento: { geraCobranca: true } },
      select: {
        id: true,
        viagemId: true,
        iniciouEm: true,
        terminouEm: true,
        tipoEvento: { select: { nome: true, geraCobranca: true, valorHora: true } },
        local: { select: { nome: true } },
        faturaLinhas: { where: { fatura: { status: { not: "CANCELADA" } } }, select: { id: true } },
      },
    });
    return estadiasCobraveis(
      eventos.map((e) => ({
        id: e.id,
        viagemId: e.viagemId,
        tipoNome: e.local?.nome ? `${e.tipoEvento.nome} (${e.local.nome})` : e.tipoEvento.nome,
        geraCobranca: e.tipoEvento.geraCobranca,
        valorHora: e.tipoEvento.valorHora,
        iniciouEm: e.iniciouEm,
        terminouEm: e.terminouEm,
        jaFaturado: e.faturaLinhas.length > 0,
      })),
    );
  }

  /**
   * A sobretaxa de combustível que esta fatura leva (common/sobretaxa-combustivel.ts).
   * Uma função só pra prévia e geração, pelo mesmo motivo de `viagensFaturaveis`.
   *
   * `null` = o cliente não tem regra ligada pro período: a fatura sai como
   * sempre saiu, e a tela nem mostra o bloco.
   */
  private async sobretaxaDe(
    empresaId: string,
    periodoInicio: string,
    periodoFim: string,
    viagens: { valor: { valorFrete?: Prisma.Decimal } | null }[],
    precoInformado: number | null,
  ): Promise<PreviaSobretaxa | null> {
    // Vale a regra cuja vigência cobre o ÚLTIMO dia faturado. Ligadas não se
    // sobrepõem (o cadastro recusa), então há no máximo uma.
    const fim = diaUtc(periodoFim);
    const regra = await this.prisma.regraSobretaxaCombustivel.findFirst({
      where: {
        empresaId,
        ativo: true,
        vigenciaDe: { lte: fim },
        OR: [{ vigenciaAte: null }, { vigenciaAte: { gte: fim } }],
      },
      orderBy: { vigenciaDe: "desc" },
    });
    if (!regra) return null;

    const regraOut: PreviaSobretaxa["regra"] = {
      id: regra.id,
      dieselReferencia: regra.dieselReferencia.toFixed(3),
      gatilho: regra.gatilho.toFixed(3),
      percentualPorPasso: regra.percentualPorPasso.toFixed(3),
      tetoPercentual: regra.tetoPercentual?.toFixed(3) ?? null,
    };

    const media = precoMedioDiesel(await this.dieselPagoPelaEmpresa(periodoInicio, periodoFim));
    const mediaOut = media
      ? { preco: media.preco.toFixed(3), litros: media.litros.toFixed(3), abastecimentos: media.abastecimentos }
      : null;

    const preco = precoInformado != null ? new Prisma.Decimal(precoInformado) : (media?.preco ?? null);
    if (preco == null) {
      const p = (d: string) => d.split("-").reverse().join("/");
      return {
        regra: regraOut,
        aplica: false,
        motivo:
          `Nenhum abastecimento de diesel pago pela empresa entre ${p(periodoInicio)} e ${p(periodoFim)}: ` +
          `sem preço médio, a sobretaxa não entra. Informe o preço do diesel à mão pra aplicar.`,
        media: null,
        calculo: null,
      };
    }

    // Base = só o FRETE. `valorTotal` traz o pedágio repassado, que é reembolso
    // de praça e não gasta diesel; a estadia nem passa por aqui.
    const base = viagens.reduce(
      (acc, v) => acc.add(v.valor?.valorFrete ?? 0),
      new Prisma.Decimal(0),
    );
    const conta = calcularSobretaxa(regra, preco, base);
    const calculo = {
      ...conta,
      regraId: regra.id,
      origemPreco: precoInformado != null ? ("INFORMADO" as const) : ("MEDIA_ABASTECIMENTOS" as const),
      litros: precoInformado == null && media ? media.litros.toFixed(3) : null,
      abastecimentos: precoInformado == null && media ? media.abastecimentos : null,
      // A descrição diz de onde veio o preço quando foi à mão: quem lê a fatura
      // daqui a seis meses precisa saber que não foi média.
      descricao: precoInformado != null ? conta.descricao.replace("diesel médio", "diesel informado") : conta.descricao,
    };

    let motivo: string | null = null;
    if (base.lte(0)) motivo = "Nenhuma viagem com frete no período: não há sobre o que aplicar a sobretaxa.";
    else if (conta.passos === 0)
      motivo = "O diesel não subiu um passo inteiro acima da referência: sem sobretaxa nesta fatura.";

    return { regra: regraOut, aplica: motivo == null, motivo, media: mediaOut, calculo };
  }

  /**
   * Os abastecimentos de diesel do período que a EMPRESA pagou, de toda a frota
   * da conta — o preço do diesel é um só, não importa o caminhão nem o cliente
   * atendido. "Pagou" segue `common/lucro-veiculo.ts`: comboio, motorista
   * empregado no dia, ou modalidade que reembolsa abastecimento. O diesel que o
   * parceiro pagou do bolso sem reembolso não é custo da empresa e não serve
   * pra cobrar sobretaxa em nome dela.
   */
  private async dieselPagoPelaEmpresa(periodoInicio: string, periodoFim: string) {
    // Abastecimento é instante: o dia ancora em Brasília e o fim é o começo do
    // dia seguinte, senão o que entrou depois das 21h do último dia some.
    const abastecimentos = await this.prisma.abastecimento.findMany({
      where: {
        tipo: { in: [...TIPOS_DIESEL] },
        data: {
          gte: inicioDoDiaBR(periodoInicio),
          lt: new Date(inicioDoDiaBR(periodoFim).getTime() + 86_400_000),
        },
        valorTotal: { not: null },
      },
      select: { motoristaId: true, data: true, litros: true, valorTotal: true, emComboio: true },
    });
    if (abastecimentos.length === 0) return [];

    const motoristaIds = [...new Set(abastecimentos.filter((a) => !a.emComboio).map((a) => a.motoristaId))];
    const motoristas = motoristaIds.length
      ? await this.prisma.motorista.findMany({
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
        })
      : [];
    const cpfs = [...new Set(motoristas.map((m) => soDigitos(m.cpf ?? "")).filter((c) => c.length === 11))];
    const regimes = cpfs.length
      ? await this.prisma.regimeVigente.findMany({
          where: { cpf: { in: cpfs }, regime: "EMPREGADO" },
          select: { cpf: true, iniciouEm: true, encerradoEm: true },
        })
      : [];
    const porId = new Map(motoristas.map((m) => [m.id, m]));

    return abastecimentos.filter((a) => {
      if (a.emComboio) return true; // diesel do caminhão-tanque é da empresa por definição
      const m = porId.get(a.motoristaId);
      // Motorista apagado: sem régua conhecida, cai no padrão (reembolsa).
      if (!m) return true;
      const cpf = soDigitos(m.cpf ?? "");
      const emprego = regimes
        .filter((r) => r.cpf === cpf)
        .map((r) => ({ inicio: r.iniciouEm, fim: r.encerradoEm }));
      if (dentroDeEmprego(emprego, a.data)) return true;
      return resolverRemuneracao(m, m.modalidade).reembolsaAbastecimento;
    });
  }

  /** O que entraria na fatura, sem gravar: viagens, total, o que ficou sem preço e as estadias. */
  async previaFatura(q: PreviaFaturaQuery) {
    const inicio = diaUtc(q.periodoInicio);
    const fim = diaUtc(q.periodoFim);
    const [viagens, semPreco] = await Promise.all([
      this.viagensFaturaveis(q.empresaId, inicio, fim),
      this.prisma.viagem.count({
        where: {
          cliente: { empresaId: q.empresaId },
          data: { gte: inicio, lte: fim },
          status: { notIn: STATUS_FORA_FECHAMENTO },
          valor: { is: null },
        },
      }),
    ]);
    const estadias = await this.estadiasDe(viagens.map((v) => v.id));
    const viagemPorId = new Map(viagens.map((v) => [v.id, v]));
    const sobretaxa = await this.sobretaxaDe(
      q.empresaId,
      q.periodoInicio,
      q.periodoFim,
      viagens,
      q.precoDiesel ?? null,
    );
    return {
      sobretaxa,
      viagens: viagens.length,
      valorViagens: viagens
        .reduce((acc, v) => acc.add(new Prisma.Decimal(v.valor!.valorTotal)), new Prisma.Decimal(0))
        .toFixed(2),
      semPreco,
      estadias: estadias.map((e) => {
        const v = viagemPorId.get(e.viagemId);
        return { ...e, data: v?.data ?? null, ticket: v?.ticket ?? null };
      }),
    };
  }

  listFaturas(params: PaginationQuery & { empresaId?: string; status?: string }) {
    const where: Prisma.FaturaWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.status) where.status = params.status as Prisma.FaturaWhereInput["status"];
    return paginate(this.prisma.fatura, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["empresa.nome", "observacao"],
      sortable: { numero: "numero", periodoInicio: "periodoInicio", valorLiquido: "valorLiquido" },
      defaultSort: { field: "numero", order: "desc" },
      include: {
        empresa: { select: { id: true, nome: true } },
        _count: { select: { linhas: true, titulos: true } },
      },
    });
  }

  async detalheFatura(id: string) {
    const f = await this.prisma.fatura.findUnique({
      where: { id },
      include: {
        empresa: { select: { id: true, nome: true, cnpj: true, prazoPagamentoDias: true } },
        linhas: { orderBy: { descricao: "asc" } },
        titulos: {
          orderBy: { parcela: "asc" },
          include: { baixas: { orderBy: { data: "asc" } } },
        },
      },
    });
    if (!f) throw new NotFoundException("Fatura não encontrada");

    return {
      ...f,
      titulos: f.titulos.map((t) => ({ ...t, ...apurarTitulo(t.valor, t.baixas, t.status) })),
    };
  }

  async atualizarFatura(id: string, input: AtualizarFaturaInput, usuarioId: string) {
    const f = await this.prisma.fatura.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("Fatura não encontrada");

    // Cancelar fatura com título já baixado deixaria dinheiro recebido apontando
    // pro vazio. O conserto de um recebimento errado é outro lançamento, não
    // apagar o passado.
    if (input.status === "CANCELADA") {
      const comBaixa = await this.prisma.baixaTitulo.count({
        where: { tituloReceber: { faturaId: id } },
      });
      if (comBaixa > 0) {
        throw new ConflictException(
          "Essa fatura já tem recebimento lançado. Cancele as baixas antes, ou lance um ajuste.",
        );
      }
    }

    const atualizada = await this.prisma.fatura.update({
      where: { id },
      data: {
        ...input,
        ...(input.status === "EMITIDA" && !f.emitidaEm ? { emitidaEm: new Date() } : {}),
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "Fatura",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      valorAntes: { status: f.status },
      valorDepois: { status: atualizada.status },
    });
    return this.detalheFatura(id);
  }

  // ---------------------------------------------------------------- títulos

  listReceber(params: PaginationQuery & { empresaId?: string; status?: string; vencidos?: string }) {
    const where: Prisma.TituloReceberWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.status) where.status = params.status as Prisma.TituloReceberWhereInput["status"];
    if (params.vencidos === "true") {
      where.status = { in: ["ABERTO", "PARCIAL"] };
      where.vencimento = { lt: new Date() };
    }
    return paginate(this.prisma.tituloReceber, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["empresa.nome", "observacao"],
      sortable: { vencimento: "vencimento", valor: "valor", status: "status" },
      defaultSort: { field: "vencimento", order: "asc" },
      include: {
        empresa: { select: { id: true, nome: true } },
        fatura: { select: { id: true, numero: true } },
        // Sem isto a tela não tinha o id da baixa, e o estorno — que existe na
        // API desde sempre — não tinha como virar botão. Baixa errada parecia
        // permanente pra quem opera.
        baixas: {
          select: { id: true, valor: true, data: true, meio: true },
          orderBy: { data: "desc" },
        },
      },
    });
  }

  listPagar(params: PaginationQuery & { status?: string; vencidos?: string }) {
    const where: Prisma.TituloPagarWhereInput = {};
    if (params.status) where.status = params.status as Prisma.TituloPagarWhereInput["status"];
    if (params.vencidos === "true") {
      where.status = { in: ["ABERTO", "PARCIAL"] };
      where.vencimento = { lt: new Date() };
    }
    return paginate(this.prisma.tituloPagar, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["descricao", "fornecedor.nome", "motorista.nome"],
      sortable: { vencimento: "vencimento", valor: "valor", status: "status" },
      defaultSort: { field: "vencimento", order: "asc" },
      include: {
        motorista: { select: { id: true, nome: true } },
        transportadora: { select: { id: true, nome: true } },
        fornecedor: { select: { id: true, nome: true, tipo: true } },
        veiculo: { select: { id: true, placa: true } },
        baixas: {
          select: { id: true, valor: true, data: true, meio: true },
          orderBy: { data: "desc" },
        },
      },
    });
  }

  async criarTituloPagar(input: CriarTituloPagarInput, usuarioId: string) {
    return this.prisma.tituloPagar.create({
      data: {
        descricao: input.descricao,
        valor: input.valor,
        emissao: input.emissao ? diaUtc(input.emissao) : new Date(),
        vencimento: diaUtc(input.vencimento),
        motoristaId: input.motoristaId ?? null,
        transportadoraId: input.transportadoraId ?? null,
        fornecedorId: input.fornecedorId ?? null,
        veiculoId: input.veiculoId ?? null,
        observacao: input.observacao ?? null,
        criadoPorId: usuarioId,
      },
    });
  }

  /**
   * CANCELAR CONTA A PAGAR — lançada errado, ou o serviço não aconteceu. Não
   * apaga: fica como cancelada, com o motivo, e sai dos totais (que só somam
   * ABERTO e PARCIAL). Até 24/09/2026 não havia como, e a manutenção que virou
   * conta não podia mais ser excluída.
   *
   * Não cancela o que já tem dinheiro lançado (estorna as baixas antes) nem o
   * que nasceu de um acerto do motorista: esse é do acerto, que tem regra
   * própria (FECHADO não regenera, PAGO não reabre).
   */
  async cancelarTituloPagar(id: string, motivo: string) {
    const t = await this.prisma.tituloPagar.findFirst({
      where: { id },
      select: { status: true, acertoId: true, observacao: true, _count: { select: { baixas: true } } },
    });
    if (!t) throw new NotFoundException("Conta não encontrada");
    if (t.status === "CANCELADO") return { ok: true };
    if (t._count.baixas > 0) {
      throw new BadRequestException("Essa conta já tem pagamento lançado. Estorne o pagamento antes de cancelar.");
    }
    if (t.acertoId) {
      throw new BadRequestException("Essa conta nasceu do acerto do motorista — resolva pelo acerto.");
    }
    await this.prisma.tituloPagar.update({
      where: { id },
      data: {
        status: "CANCELADO",
        observacao: [t.observacao, `Cancelada: ${motivo}`].filter(Boolean).join("\n"),
      },
    });
    return { ok: true };
  }

  /**
   * Baixa num título, de qualquer um dos dois lados.
   *
   * O status NÃO é escrito à mão: é derivado da soma das baixas. Um booleano
   * "pago" não responde "recebemos metade em março e o resto em abril?", que é a
   * pergunta que o financeiro faz toda semana.
   */
  async darBaixa(
    tipo: "receber" | "pagar",
    id: string,
    input: DarBaixaInput,
    usuarioId: string,
  ) {
    const titulo =
      tipo === "receber"
        ? await this.prisma.tituloReceber.findUnique({
            where: { id },
            include: { baixas: true },
          })
        : await this.prisma.tituloPagar.findUnique({
            where: { id },
            include: { baixas: true },
          });
    if (!titulo) throw new NotFoundException("Título não encontrado");
    if (titulo.status === "CANCELADO") {
      throw new ConflictException("Esse título foi cancelado.");
    }

    const antes = apurarTitulo(titulo.valor, titulo.baixas, titulo.status);
    // Baixa maior que o saldo é quase sempre dedo errado; aceitar calado faz o
    // relatório mentir pra sempre.
    if (new Prisma.Decimal(input.valor).gt(new Prisma.Decimal(antes.saldo))) {
      throw new BadRequestException(
        `O saldo desse título é R$ ${antes.saldo}. Baixe no máximo esse valor.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.baixaTitulo.create({
        data: {
          ...(tipo === "receber" ? { tituloReceberId: id } : { tituloPagarId: id }),
          data: input.data ? diaUtc(input.data) : new Date(),
          valor: input.valor,
          meio: input.meio,
          usuarioId,
          observacao: input.observacao ?? null,
        },
      });

      const baixas =
        tipo === "receber"
          ? await tx.baixaTitulo.findMany({ where: { tituloReceberId: id }, select: { valor: true } })
          : await tx.baixaTitulo.findMany({ where: { tituloPagarId: id }, select: { valor: true } });
      const depois = apurarTitulo(titulo.valor, baixas, titulo.status);

      const data = { valorPago: depois.valorPago, status: depois.status };
      if (tipo === "receber") await tx.tituloReceber.update({ where: { id }, data });
      else await tx.tituloPagar.update({ where: { id }, data });
    });

    await this.auditoria.log({
      usuarioId,
      entidade: tipo === "receber" ? "TituloReceber" : "TituloPagar",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "baixa",
      valorDepois: { valor: input.valor, meio: input.meio },
      motivo: input.observacao ?? `Baixa de R$ ${input.valor}`,
    });

    return tipo === "receber"
      ? this.prisma.tituloReceber.findUnique({ where: { id }, include: { baixas: true } })
      : this.prisma.tituloPagar.findUnique({ where: { id }, include: { baixas: true } });
  }

  /** Desfaz uma baixa lançada errado. */
  async estornarBaixa(baixaId: string, usuarioId: string) {
    const baixa = await this.prisma.baixaTitulo.findUnique({ where: { id: baixaId } });
    if (!baixa) throw new NotFoundException("Baixa não encontrada");

    await this.prisma.$transaction(async (tx) => {
      await tx.baixaTitulo.delete({ where: { id: baixaId } });

      if (baixa.tituloReceberId) {
        const t = await tx.tituloReceber.findUniqueOrThrow({
          where: { id: baixa.tituloReceberId },
          include: { baixas: { select: { valor: true } } },
        });
        const r = apurarTitulo(t.valor, t.baixas, t.status);
        await tx.tituloReceber.update({
          where: { id: t.id },
          data: { valorPago: r.valorPago, status: r.status },
        });
      }
      if (baixa.tituloPagarId) {
        const t = await tx.tituloPagar.findUniqueOrThrow({
          where: { id: baixa.tituloPagarId },
          include: { baixas: { select: { valor: true } } },
        });
        const r = apurarTitulo(t.valor, t.baixas, t.status);
        await tx.tituloPagar.update({
          where: { id: t.id },
          data: { valorPago: r.valorPago, status: r.status },
        });
      }
    });

    await this.auditoria.log({
      usuarioId,
      entidade: baixa.tituloReceberId ? "TituloReceber" : "TituloPagar",
      entidadeId: baixa.tituloReceberId ?? baixa.tituloPagarId ?? baixaId,
      acao: AcaoAuditoria.DELETE,
      campo: "baixa",
      valorAntes: { valor: baixa.valor.toString(), meio: baixa.meio },
      motivo: "Baixa estornada",
    });
    return { ok: true };
  }

  /**
   * O painel do financeiro: quanto entra, quanto sai e o que está vencido.
   *
   * É a resposta para "quem está me devendo e há quanto tempo" — a pergunta que
   * o dono faz todo dia e que o sistema não respondia.
   */
  async resumo() {
    const [receber, pagar] = await Promise.all([
      this.prisma.tituloReceber.findMany({
        where: { status: { in: ["ABERTO", "PARCIAL"] } },
        select: { vencimento: true, valor: true, valorPago: true, status: true },
      }),
      this.prisma.tituloPagar.findMany({
        where: { status: { in: ["ABERTO", "PARCIAL"] } },
        select: { vencimento: true, valor: true, valorPago: true, status: true },
      }),
    ]);

    const maioresDevedores = await this.prisma.tituloReceber.groupBy({
      by: ["empresaId"],
      where: { status: { in: ["ABERTO", "PARCIAL"] } },
      _sum: { valor: true, valorPago: true },
      orderBy: { _sum: { valor: "desc" } },
      take: 5,
    });

    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: maioresDevedores.map((d) => d.empresaId) } },
      select: { id: true, nome: true },
    });
    const nomePorId = new Map(empresas.map((e) => [e.id, e.nome]));

    return {
      receber: montarAging(receber as TituloParaAging[]),
      pagar: montarAging(pagar as TituloParaAging[]),
      maioresDevedores: maioresDevedores.map((d) => ({
        empresaId: d.empresaId,
        nome: nomePorId.get(d.empresaId) ?? "—",
        saldo: new Prisma.Decimal(d._sum.valor ?? 0)
          .sub(new Prisma.Decimal(d._sum.valorPago ?? 0))
          .toFixed(2),
      })),
    };
  }
}
