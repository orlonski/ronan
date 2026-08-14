import {
  AgruparPorAbastecimento,
  GRUPO_SEM_VALOR,
  TIPO_COMBUSTIVEL_LABEL,
} from "@ronan/shared-types";
import type { TipoCombustivel } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { RotuloGrupo } from "./dimensoes";

/**
 * Registry das dimensões do relatório de abastecimentos. Mesmo anti-N+1 do
 * `dimensoes.ts`: a agregação roda só com ids (zero JOIN) e os nomes são
 * resolvidos depois, numa query por dimensão.
 *
 * A diferença pro relatório de viagens são as dimensões que NÃO são FK:
 *  - POSTO é texto livre digitado pelo motorista. A chave é o nome normalizado
 *    (trim + caixa alta), senão "Posto Shell" e "posto shell" viram dois grupos
 *    e o gasto do posto aparece pela metade em cada. O rótulo exibido é a
 *    primeira grafia que apareceu — a normalização é da chave, não da tela.
 *  - TIPO é enum: a chave é o próprio valor e o rótulo sai da tabela de labels.
 * Nenhuma das duas vai ao banco pra resolver nome; daí `resolverNomes` ser
 * opcional e `rotuloDe` existir.
 */

/** Escalares do abastecimento que a agregação carrega. Nenhuma relação. */
export type LinhaAgregacaoAbastecimento = {
  id: string;
  motoristaId: string;
  veiculoId: string;
  empresaId: string | null;
  transportadoraId: string | null;
  tipo: TipoCombustivel;
  postoNome: string | null;
};

type Dimensao = {
  /** Id (ou texto normalizado) que forma a chave. `null` cai em GRUPO_SEM_VALOR. */
  chaveDe: (linha: LinhaAgregacaoAbastecimento) => string | null;
  /** Rótulo tirado da própria linha, pras dimensões que não são FK. */
  rotuloDe?: (linha: LinhaAgregacaoAbastecimento) => RotuloGrupo;
  rotuloSemValor: string;
  /** Uma query, só com os ids que apareceram de fato. */
  resolverNomes?: (prisma: PrismaService, ids: string[]) => Promise<Map<string, RotuloGrupo>>;
};

export function normalizarPosto(nome: string | null): string | null {
  const limpo = nome?.trim();
  return limpo ? limpo.toUpperCase() : null;
}

const DIMENSOES: Record<AgruparPorAbastecimento, Dimensao> = {
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

  EMPRESA: {
    chaveDe: (l) => l.empresaId,
    // Abastecimento sem empresa existe: o app deixa lançar antes de escolher o
    // tomador. É justamente a linha que o financeiro precisa enxergar.
    rotuloSemValor: "(sem empresa)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.empresa.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.nome, detalhe: null }]));
    },
  },

  TRANSPORTADORA: {
    chaveDe: (l) => l.transportadoraId,
    rotuloSemValor: "(sem frota)",
    resolverNomes: async (prisma, ids) => {
      const rows = await prisma.transportadora.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      });
      return new Map(rows.map((r) => [r.id, { nome: r.nome, detalhe: null }]));
    },
  },

  POSTO: {
    chaveDe: (l) => normalizarPosto(l.postoNome),
    // O `?? ""` nunca é usado na prática (linha sem posto cai em
    // GRUPO_SEM_VALOR, que o resolver nomeia), mas um `!` aqui já derrubou o
    // endpoint inteiro com 500 uma vez.
    rotuloDe: (l) => ({ nome: l.postoNome?.trim() ?? "", detalhe: null }),
    rotuloSemValor: "(sem posto informado)",
  },

  TIPO: {
    chaveDe: (l) => l.tipo,
    rotuloDe: (l) => ({ nome: TIPO_COMBUSTIVEL_LABEL[l.tipo] ?? l.tipo, detalhe: null }),
    rotuloSemValor: "(sem tipo)",
  },
};

export function chaveDoGrupoAbastecimento(
  agruparPor: AgruparPorAbastecimento,
  linha: LinhaAgregacaoAbastecimento,
): string {
  return DIMENSOES[agruparPor].chaveDe(linha) ?? GRUPO_SEM_VALOR;
}

/** Rótulo que sai da própria linha (posto/tipo), ou `null` se a dimensão é FK. */
export function rotuloDaLinha(
  agruparPor: AgruparPorAbastecimento,
  linha: LinhaAgregacaoAbastecimento,
): RotuloGrupo | null {
  const d = DIMENSOES[agruparPor];
  return d.rotuloDe ? d.rotuloDe(linha) : null;
}

/**
 * Nomes de todos os grupos. Dimensão de FK resolve em UMA query; dimensão de
 * texto/enum já veio resolvida da agregação (`rotulosLocais`) e não toca o
 * banco. `GRUPO_SEM_VALOR` nunca vai pro banco — não é id de coisa nenhuma.
 */
export async function resolverRotulosAbastecimento(
  prisma: PrismaService,
  agruparPor: AgruparPorAbastecimento,
  chaves: string[],
  rotulosLocais: Map<string, RotuloGrupo>,
): Promise<Map<string, RotuloGrupo>> {
  const d = DIMENSOES[agruparPor];
  const ids = chaves.filter((c) => c !== GRUPO_SEM_VALOR);

  const mapa = d.resolverNomes
    ? ids.length > 0
      ? await d.resolverNomes(prisma, ids)
      : new Map<string, RotuloGrupo>()
    : new Map(rotulosLocais);

  if (chaves.includes(GRUPO_SEM_VALOR)) {
    mapa.set(GRUPO_SEM_VALOR, { nome: d.rotuloSemValor, detalhe: null });
  }
  return mapa;
}
