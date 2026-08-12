import { AgruparPorRelatorio, GRUPO_SEM_VALOR } from "@ronan/shared-types";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * Registry das dimensões de agrupamento do relatório.
 *
 * O ponto todo deste arquivo é o ANTI-N+1: a agregação roda inteira só com os
 * ids (que já vêm no select da viagem, sem um único JOIN), e os nomes são
 * resolvidos DEPOIS, numa query só, com `id: { in: [...] }`. É o mesmo padrão
 * dos rankings do dashboard e do resumo diário — generalizado, pra não virar um
 * `switch` repetido em cada lugar que agrupa.
 */

/** Escalares da viagem que a agregação carrega. Nenhuma relação — zero JOIN. */
export type LinhaAgregacao = {
  id: string;
  motoristaId: string;
  veiculoId: string;
  clienteId: string | null;
  materialId: string | null;
  localCargaId: string | null;
  localDescargaId: string | null;
  transportadoraId: string | null;
};

export type RotuloGrupo = { nome: string; detalhe: string | null };

type Dimensao = {
  /** Id que forma a chave do grupo. `null` cai em GRUPO_SEM_VALOR. */
  chaveDe: (linha: LinhaAgregacao, empresaPorCliente: Map<string, string>) => string | null;
  /** Rótulo exibido quando a chave é nula. */
  rotuloSemValor: string;
  /** Uma query, só com os ids que apareceram de fato. */
  resolverNomes: (prisma: PrismaService, ids: string[]) => Promise<Map<string, RotuloGrupo>>;
};

const DIMENSOES: Record<AgruparPorRelatorio, Dimensao> = {
  MOTORISTA: {
    chaveDe: (l) => l.motoristaId,
    rotuloSemValor: "(sem motorista)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.motorista.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.nome, detalhe: null }]));
    },
  },

  VEICULO: {
    chaveDe: (l) => l.veiculoId,
    rotuloSemValor: "(sem veículo)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.veiculo.findMany({
        where: { id: { in: ids } },
        select: { id: true, placa: true, modelo: true },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.placa, detalhe: r.modelo ?? null }]));
    },
  },

  MATERIAL: {
    chaveDe: (l) => l.materialId,
    rotuloSemValor: "(sem material)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.material.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.nome, detalhe: null }]));
    },
  },

  CLIENTE: {
    chaveDe: (l) => l.clienteId,
    rotuloSemValor: "(sem cliente)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.cliente.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true, empresa: { select: { nome: true } } },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.nome, detalhe: r.empresa?.nome ?? null }]));
    },
  },

  // Cliente sempre tem empresa (FK obrigatória), então o mapa que a agregação
  // já montou pra resolver o mínimo serve de graça como chave aqui.
  EMPRESA: {
    chaveDe: (l, empresaPorCliente) =>
      l.clienteId ? (empresaPorCliente.get(l.clienteId) ?? null) : null,
    rotuloSemValor: "(sem empresa)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.empresa.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.nome, detalhe: null }]));
    },
  },

  LOCAL_CARGA: {
    chaveDe: (l) => l.localCargaId,
    rotuloSemValor: "(sem local de carga)",
    resolverNomes: (prisma, ids) => resolverLocais(prisma, ids),
  },

  LOCAL_DESCARGA: {
    chaveDe: (l) => l.localDescargaId,
    rotuloSemValor: "(sem local de descarga)",
    resolverNomes: (prisma, ids) => resolverLocais(prisma, ids),
  },

  TRANSPORTADORA: {
    chaveDe: (l) => l.transportadoraId,
    // Viagem antiga, de antes do carimbo de frota. Aparece pra quem tem acesso
    // global e some pro usuário restrito — daí o rótulo explícito, em vez de
    // uma linha em branco que ninguém sabe explicar.
    rotuloSemValor: "(sem frota)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.transportadora.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.nome, detalhe: null }]));
    },
  },
};

async function resolverLocais(prisma: PrismaService, ids: string[]) {
  const rows = await prisma.local.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true, cidade: true, uf: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      { nome: r.nome, detalhe: [r.cidade, r.uf].filter(Boolean).join("/") || null },
    ]),
  );
}

export function dimensao(agruparPor: AgruparPorRelatorio): Dimensao {
  return DIMENSOES[agruparPor];
}

export function chaveDoGrupo(
  agruparPor: AgruparPorRelatorio,
  linha: LinhaAgregacao,
  empresaPorCliente: Map<string, string>,
): string {
  return DIMENSOES[agruparPor].chaveDe(linha, empresaPorCliente) ?? GRUPO_SEM_VALOR;
}

/**
 * Nomes de todos os grupos, em UMA query. `GRUPO_SEM_VALOR` nunca vai pro
 * banco — não é id de coisa nenhuma.
 */
export async function resolverRotulos(
  prisma: PrismaService,
  agruparPor: AgruparPorRelatorio,
  chaves: string[],
): Promise<Map<string, RotuloGrupo>> {
  const d = DIMENSOES[agruparPor];
  const ids = chaves.filter((c) => c !== GRUPO_SEM_VALOR);
  const mapa = ids.length > 0 ? await d.resolverNomes(prisma, ids) : new Map<string, RotuloGrupo>();
  if (chaves.includes(GRUPO_SEM_VALOR)) {
    mapa.set(GRUPO_SEM_VALOR, { nome: d.rotuloSemValor, detalhe: null });
  }
  return mapa;
}
