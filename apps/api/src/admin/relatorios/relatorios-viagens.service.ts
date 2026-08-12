import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, StatusViagem } from "@prisma/client";
import {
  type GrupoRelatorioViagens,
  GRUPO_SEM_VALOR,
  type RelatorioViagensFiltros,
  type RelatorioViagensQuery,
  type RelatorioViagensResposta,
  type TotaisRelatorioViagens,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import type { EscopoAdmin } from "../../common/escopo/escopo";
import { comEscopo, filtroEscopo } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { aplicarMinimos, resolverRegraMinimo } from "../../common/viagem-minimos";
import type { RegraMinimoRow } from "../../common/viagem-minimos";
import { chaveDoGrupo, type LinhaAgregacao, resolverRotulos } from "./dimensoes";
import { omitirComercialDoGrupo } from "./comercial-relatorio";

/**
 * Quantas viagens são lidas por vez. O chunk sai de escopo a cada volta, então
 * o pico de memória é ~CHUNK linhas, independente do tamanho do período.
 */
const CHUNK = 5_000;

/**
 * Teto absoluto. O período já é limitado a MAX_DIAS_RELATORIO no Zod; isto aqui
 * pega o caso de um período curto numa operação grande. Estourar devolve 400
 * (que os apps humanizam) em vez de segurar uma conexão do pool por minutos.
 */
const MAX_LINHAS = 200_000;

// Escalares e nada mais: sem `include`, a query não faz um único JOIN, e os
// nomes das dimensões são resolvidos depois em uma query só (ver dimensoes.ts).
const SELECT_AGREGACAO = {
  id: true,
  motoristaId: true,
  veiculoId: true,
  clienteId: true,
  materialId: true,
  localCargaId: true,
  localDescargaId: true,
  transportadoraId: true,
  status: true,
  toneladas: true,
  km: true,
  valorPedagioTotal: true,
} as const;

type LinhaBruta = LinhaAgregacao & {
  status: StatusViagem;
  toneladas: Prisma.Decimal | null;
  km: Prisma.Decimal | null;
  valorPedagioTotal: Prisma.Decimal | null;
};

type Acumulador = {
  viagens: number;
  toneladas: Prisma.Decimal;
  toneladasEfetiva: Prisma.Decimal;
  toneladasAjustadas: number;
  km: Prisma.Decimal;
  kmEfetivo: Prisma.Decimal;
  kmAjustados: number;
  pedagio: Prisma.Decimal;
  viagensSemPedagio: number;
  viagensNaoConciliadas: number;
};

/**
 * O que `export-fechamento.service.ts` aceita mandar pro cliente. O relatório é
 * mais amplo de propósito (produção ≠ faturamento conciliado): uma viagem
 * DIVERGENTE foi rodada e conta como produção, mas está em disputa com a
 * planilha e não vai no envio. Contamos as que caem fora pra tela poder
 * explicar a diferença em vez de o usuário achar que um dos dois está errado.
 */
const STATUS_CONCILIAVEIS: StatusViagem[] = [
  StatusViagem.ENVIADA,
  StatusViagem.OK,
  StatusViagem.AJUSTADA,
];

/** Uma viagem na aba de detalhe. Campos comerciais somem sem a permissão. */
export type LinhaDetalhe = {
  data: Date | null;
  motorista: string;
  placa: string;
  ticket: string | null;
  status: string;
  material: string | null;
  localCarga: string | null;
  localDescarga: string | null;
  toneladas: string;
  km: string;
  pedagio: string;
  cliente?: string | null;
  toneladasEfetiva?: string;
  kmEfetivo?: string;
};

const zerado = (): Acumulador => ({
  viagens: 0,
  toneladas: new Prisma.Decimal(0),
  toneladasEfetiva: new Prisma.Decimal(0),
  toneladasAjustadas: 0,
  km: new Prisma.Decimal(0),
  kmEfetivo: new Prisma.Decimal(0),
  kmAjustados: 0,
  pedagio: new Prisma.Decimal(0),
  viagensSemPedagio: 0,
  viagensNaoConciliadas: 0,
});

@Injectable()
export class RelatoriosViagensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Monta o `where` UMA vez, e todo mundo (contagem, streaming, detalhe) usa
   * este. Se o `notIn` de STATUS_FORA_FECHAMENTO cair em um dos caminhos, uma
   * viagem AGUARDANDO_PESO entra como 0t e o relatório para de bater com o
   * fechamento — sem erro nenhum, só um número errado.
   */
  montarWhere(f: RelatorioViagensFiltros, escopo: EscopoAdmin): Prisma.ViagemWhereInput {
    const base: Prisma.ViagemWhereInput = {
      status: { notIn: STATUS_FORA_FECHAMENTO },
      // `Viagem.data` é @db.Date: o Prisma devolve meia-noite UTC e
      // `new Date("2026-07-31")` é exatamente isso, então `lte` é inclusivo e
      // pega o último dia inteiro. NÃO usar `inicioDoDiaBR` aqui — aquilo é pra
      // coluna timestamp (Abastecimento.data) e deslocaria 3h, comendo o dia.
      data: { gte: new Date(f.de), lte: new Date(f.ate) },
    };

    if (f.motoristaId) base.motoristaId = f.motoristaId;
    if (f.veiculoId) base.veiculoId = f.veiculoId;
    if (f.clienteId) base.clienteId = f.clienteId;
    if (f.materialId) base.materialId = f.materialId;
    if (f.localCargaId) base.localCargaId = f.localCargaId;
    if (f.localDescargaId) base.localDescargaId = f.localDescargaId;
    if (f.transportadoraId) base.transportadoraId = f.transportadoraId;
    // Subquery em vez de montar um `clienteId: { in: [...] }` gigante.
    if (f.empresaId) base.cliente = { is: { empresaId: f.empresaId } };

    // `comEscopo` combina em AND. Spread aqui apagaria o escopo (ou o filtro)
    // em silêncio se algum dia entrar um OR no `base`.
    return comEscopo(base, escopo) as Prisma.ViagemWhereInput;
  }

  async resumo(
    q: RelatorioViagensQuery,
    escopo: EscopoAdmin,
    podeComercial: boolean,
  ): Promise<RelatorioViagensResposta> {
    const where = this.montarWhere(q, escopo);

    const total = await this.prisma.viagem.count({ where });
    if (total > MAX_LINHAS) {
      throw new BadRequestException(
        `Este recorte tem ${total.toLocaleString("pt-BR")} viagens, acima do limite de ${MAX_LINHAS.toLocaleString("pt-BR")}. Reduza o período ou aplique um filtro.`,
      );
    }

    // Carregados uma vez, fora do laço. `regras_minimo` é pequena e tem
    // @@index([ativo]); o mapa de empresa evita um JOIN por linha e ainda serve
    // de chave pro agrupamento por EMPRESA.
    const [regras, clientes] = await Promise.all([
      this.prisma.regraMinimo.findMany({ where: { ativo: true } }),
      this.prisma.cliente.findMany({ select: { id: true, empresaId: true } }),
    ]);
    const empresaPorCliente = new Map(clientes.map((c) => [c.id, c.empresaId]));

    const grupos = new Map<string, Acumulador>();
    let processadas = 0;
    let cursor: string | undefined;

    // Cursor por `id` (único e estável), NÃO por `data`: `data` tem empates aos
    // milhares e o cursor pularia ou repetiria linhas, corrompendo o total em
    // silêncio. A ordem aqui não importa — o resultado é agregado.
    for (;;) {
      const lote: LinhaBruta[] = await this.prisma.viagem.findMany({
        where,
        select: SELECT_AGREGACAO,
        orderBy: { id: "asc" },
        take: CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (lote.length === 0) break;

      for (const linha of lote) {
        const chave = chaveDoGrupo(q.agruparPor, linha, empresaPorCliente);
        let acc = grupos.get(chave);
        if (!acc) {
          acc = zerado();
          grupos.set(chave, acc);
        }
        acumular(acc, linha, regras, empresaPorCliente);
        processadas++;
      }

      cursor = lote[lote.length - 1]!.id;
      if (lote.length < CHUNK) break;
    }

    const rotulos = await resolverRotulos(this.prisma, q.agruparPor, [...grupos.keys()]);

    let linhas: GrupoRelatorioViagens[] = [...grupos.entries()].map(([chave, acc]) => {
      const r = rotulos.get(chave);
      return {
        chave,
        nome: r?.nome ?? "(desconhecido)",
        detalhe: r?.detalhe ?? null,
        ...serializar(acc),
      };
    });

    linhas = ordenar(linhas, q.ordenarPor, q.ordem);

    // Os totais são a soma dos acumuladores, nunca um aggregate paralelo: dois
    // caminhos de cálculo divergem cedo ou tarde, e o rodapé é justamente o que
    // o cliente confere na mão.
    const totalAcc = zerado();
    for (const acc of grupos.values()) somar(totalAcc, acc);

    const totais: TotaisRelatorioViagens = {
      grupos: grupos.size,
      ...serializar(totalAcc),
    };

    const reconciliacao = await this.reconciliarPedagio(q, escopo);

    const resposta: RelatorioViagensResposta = {
      periodo: { de: q.de, ate: q.ate, dias: diasEntre(q.de, q.ate) },
      agruparPor: q.agruparPor,
      comercial: podeComercial,
      grupos: podeComercial ? linhas : linhas.map(omitirComercialDoGrupo),
      totais: podeComercial
        ? totais
        : (omitirComercialDoGrupo(totais) as TotaisRelatorioViagens),
      pedagioReconciliacao: reconciliacao,
      meta: {
        geradoEm: new Date().toISOString(),
        linhasProcessadas: processadas,
        regrasMinimoAtivas: regras.length,
      },
    };
    return resposta;
  }

  /**
   * Viagem a viagem do mesmo recorte, pra 2ª aba do XLSX. Não pagina: o teto é
   * `limite`, e o que passar disso é cortado com aviso — planilha de 200k
   * linhas não abre, e o resumo continua correto porque é calculado à parte.
   */
  async detalhe(
    f: RelatorioViagensFiltros,
    escopo: EscopoAdmin,
    podeComercial: boolean,
    limite: number,
  ): Promise<{ linhas: LinhaDetalhe[]; truncado: boolean }> {
    const where = this.montarWhere(f, escopo);
    const total = await this.prisma.viagem.count({ where });

    const regras = await this.prisma.regraMinimo.findMany({ where: { ativo: true } });

    const viagens = await this.prisma.viagem.findMany({
      where,
      take: limite,
      orderBy: [{ data: "desc" }, { id: "asc" }],
      select: {
        id: true,
        data: true,
        ticket: true,
        status: true,
        toneladas: true,
        km: true,
        valorPedagioTotal: true,
        motorista: { select: { nome: true } },
        veiculo: { select: { placa: true } },
        cliente: { select: { nome: true, empresaId: true } },
        material: { select: { id: true, nome: true } },
        localCarga: { select: { nome: true, cidade: true, uf: true } },
        localDescarga: { select: { nome: true, cidade: true, uf: true } },
      },
    });

    const linhas = viagens.map((v) => {
      const override =
        regras.length > 0 && v.cliente?.empresaId && v.material?.id
          ? (resolverRegraMinimo(regras, v.cliente.empresaId, v.material.id, v.km ?? 0) ?? undefined)
          : undefined;
      const m = aplicarMinimos(v, override);

      const base: LinhaDetalhe = {
        data: v.data,
        motorista: v.motorista.nome,
        placa: v.veiculo.placa,
        ticket: v.ticket,
        status: v.status,
        material: v.material?.nome ?? null,
        localCarga: v.localCarga?.nome ?? null,
        localDescarga: v.localDescarga?.nome ?? null,
        toneladas: m.toneladasInformada,
        km: m.kmInformado,
        pedagio: (v.valorPedagioTotal ?? new Prisma.Decimal(0)).toFixed(2),
        // Comerciais — omitidos abaixo quando não pode ver.
        cliente: v.cliente?.nome ?? null,
        toneladasEfetiva: m.toneladasEfetiva,
        kmEfetivo: m.kmEfetivo,
      };

      if (podeComercial) return base;
      const { cliente: _c, toneladasEfetiva: _t, kmEfetivo: _k, ...semComercial } = base;
      return semComercial as LinhaDetalhe;
    });

    return { linhas, truncado: total > limite };
  }

  /**
   * Os lançamentos praça a praça da tabela `pedagios`, que NUNCA entram no
   * total. `Viagem.valorPedagioTotal` (o que o total soma, e o que o fechamento
   * fatura em `valor_pedagio`) e `Pedagio.valor` são fontes independentes:
   * nenhum código escreve uma a partir da outra, o app nativo grava a primeira
   * e o PWA grava a segunda. Somar as duas conta o mesmo pedágio duas vezes, e
   * só para quem usa o PWA — divergência que ninguém explica seis meses depois.
   */
  private async reconciliarPedagio(f: RelatorioViagensFiltros, escopo: EscopoAdmin) {
    const base: Prisma.PedagioWhereInput = {
      data: { gte: new Date(f.de), lte: new Date(f.ate) },
      ...(f.motoristaId ? { motoristaId: f.motoristaId } : {}),
      ...(f.veiculoId ? { veiculoId: f.veiculoId } : {}),
      ...filtroEscopo(escopo),
    };

    const [vinculados, avulsos] = await Promise.all([
      this.prisma.pedagio.aggregate({
        where: { ...base, viagemId: { not: null } },
        _sum: { valor: true },
      }),
      this.prisma.pedagio.aggregate({
        where: { ...base, viagemId: null },
        _sum: { valor: true },
      }),
    ]);

    return {
      lancamentosVinculados: (vinculados._sum.valor ?? new Prisma.Decimal(0)).toFixed(2),
      lancamentosAvulsos: (avulsos._sum.valor ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }
}

function acumular(
  acc: Acumulador,
  linha: LinhaBruta,
  regras: RegraMinimoRow[],
  empresaPorCliente: Map<string, string>,
): void {
  const empresaId = linha.clienteId ? empresaPorCliente.get(linha.clienteId) : undefined;

  // Mesma condição de `serializarViagemComMinimos`: sem empresa E material não
  // há regra que case, e vale o real. Usamos o par de baixo nível
  // (resolverRegraMinimo + aplicarMinimos) porque o serializador exige as
  // relações carregadas, e carregá-las custaria dois JOIN por linha.
  const override =
    regras.length > 0 && empresaId && linha.materialId
      ? (resolverRegraMinimo(regras, empresaId, linha.materialId, linha.km ?? 0) ?? undefined)
      : undefined;

  const m = aplicarMinimos(linha, override);

  acc.viagens++;
  // Decimal do começo ao fim: somar dezenas de milhares de valores com 3 casas
  // em float acumula deriva visível no rodapé.
  acc.toneladas = acc.toneladas.plus(m.toneladasInformada);
  acc.toneladasEfetiva = acc.toneladasEfetiva.plus(m.toneladasEfetiva);
  if (m.toneladasAjustada) acc.toneladasAjustadas++;
  acc.km = acc.km.plus(m.kmInformado);
  acc.kmEfetivo = acc.kmEfetivo.plus(m.kmEfetivo);
  if (m.kmAjustada) acc.kmAjustados++;

  const pedagio = linha.valorPedagioTotal;
  if (pedagio && !pedagio.isZero()) acc.pedagio = acc.pedagio.plus(pedagio);
  else acc.viagensSemPedagio++;

  if (!STATUS_CONCILIAVEIS.includes(linha.status)) acc.viagensNaoConciliadas++;
}

function somar(alvo: Acumulador, parcela: Acumulador): void {
  alvo.viagens += parcela.viagens;
  alvo.toneladas = alvo.toneladas.plus(parcela.toneladas);
  alvo.toneladasEfetiva = alvo.toneladasEfetiva.plus(parcela.toneladasEfetiva);
  alvo.toneladasAjustadas += parcela.toneladasAjustadas;
  alvo.km = alvo.km.plus(parcela.km);
  alvo.kmEfetivo = alvo.kmEfetivo.plus(parcela.kmEfetivo);
  alvo.kmAjustados += parcela.kmAjustados;
  alvo.pedagio = alvo.pedagio.plus(parcela.pedagio);
  alvo.viagensSemPedagio += parcela.viagensSemPedagio;
  alvo.viagensNaoConciliadas += parcela.viagensNaoConciliadas;
}

function serializar(acc: Acumulador) {
  return {
    viagens: acc.viagens,
    toneladas: acc.toneladas.toFixed(3),
    km: acc.km.toFixed(2),
    pedagio: acc.pedagio.toFixed(2),
    viagensSemPedagio: acc.viagensSemPedagio,
    viagensNaoConciliadas: acc.viagensNaoConciliadas,
    toneladasEfetiva: acc.toneladasEfetiva.toFixed(3),
    toneladasAjustadas: acc.toneladasAjustadas,
    kmEfetivo: acc.kmEfetivo.toFixed(2),
    kmAjustados: acc.kmAjustados,
  };
}

type CampoOrdenavel = "viagens" | "toneladas" | "toneladasEfetiva" | "km" | "kmEfetivo" | "pedagio";

function ordenar(
  linhas: GrupoRelatorioViagens[],
  por: RelatorioViagensQuery["ordenarPor"],
  ordem: "asc" | "desc",
): GrupoRelatorioViagens[] {
  const sinal = ordem === "asc" ? 1 : -1;
  return [...linhas].sort((a, b) => {
    if (por === "nome") return sinal * a.nome.localeCompare(b.nome, "pt-BR");
    const campo = por as CampoOrdenavel;
    const va = Number(a[campo] ?? 0);
    const vb = Number(b[campo] ?? 0);
    // Number() só pra ordenar; os valores exibidos seguem sendo as strings
    // exatas do Decimal.
    if (va === vb) return a.nome.localeCompare(b.nome, "pt-BR");
    return sinal * (va - vb);
  });
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
}
