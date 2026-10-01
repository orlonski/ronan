/**
 * Ciclo da carga: em qual pedreira e em qual obra o caminhão fica parado.
 *
 * Os marcos já são gravados pelo app na viagem guiada (kit-inicial): "Cheguei
 * no local de carga" → "Saí do local de carga" → "Cheguei no local de
 * descarga" → "Descarreguei". Os concorrentes de granel (TruckIT, Command
 * Alkon TrackIt) vendem justamente esse corte: tempo na carga, no trajeto e
 * na descarga, por local. Mediana e p90 — a média mente quando uma fila de 4h
 * aparece no meio de cem de 20 min.
 *
 * Marco que falta não vira zero: a fase simplesmente não entra na conta.
 * Conta que renomeou os eventos ainda é medida pelo ehCarga/ehDescarga (o
 * começo de cada fase); o fim usa os slugs do kit.
 */

export type EventoCiclo = { slug: string; ehCarga: boolean; ehDescarga: boolean; ocorridoEm: Date };

export type ViagemCiclo = {
  id: string;
  localCarga: { id: string; nome: string } | null;
  localDescarga: { id: string; nome: string } | null;
  eventos: EventoCiclo[];
};

export type Fases = {
  /** Da chegada na carga até sair carregado. */
  carga: number | null;
  /** De sair carregado até chegar na descarga. */
  trajeto: number | null;
  /** Da chegada na descarga até descarregar. */
  descarga: number | null;
  /** Da chegada na carga até descarregar. */
  total: number | null;
};

const SAIDA_CARGA = ["sai-carga", "carreguei"];
const FIM_DESCARGA = ["descarreguei"];
/** Fase com mais de 24h é casca esquecida aberta, não operação. */
const MAX_MIN = 24 * 60;

const min = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;
const valida = (m: number | null) => (m != null && m >= 0 && m <= MAX_MIN ? Math.round(m) : null);

export function fasesDaViagem(eventos: EventoCiclo[]): Fases {
  const ordenados = [...eventos].sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime());
  const chegouCarga = ordenados.find((e) => e.ehCarga)?.ocorridoEm ?? null;
  // A saída é o ÚLTIMO marco de saída (quem toca "carreguei" e depois "saí").
  const saiuCarga = [...ordenados].reverse().find((e) => SAIDA_CARGA.includes(e.slug))?.ocorridoEm ?? null;
  const chegouDescarga = ordenados.find((e) => e.ehDescarga)?.ocorridoEm ?? null;
  const descarregou = ordenados.find((e) => FIM_DESCARGA.includes(e.slug))?.ocorridoEm ?? null;

  return {
    carga: chegouCarga && saiuCarga ? valida(min(chegouCarga, saiuCarga)) : null,
    trajeto: saiuCarga && chegouDescarga ? valida(min(saiuCarga, chegouDescarga)) : null,
    descarga: chegouDescarga && descarregou ? valida(min(chegouDescarga, descarregou)) : null,
    total: chegouCarga && descarregou ? valida(min(chegouCarga, descarregou)) : null,
  };
}

/** Percentil por interpolação linear (p em 0..1). */
export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const pos = (v.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const prox = v[base + 1] ?? v[base]!;
  return Math.round(v[base]! + resto * (prox - v[base]!));
}

export type LinhaCiclo = { chave: string; nome: string; viagens: number; medianaMin: number; p90Min: number };

function agrupar(itens: { chave: string; nome: string; minutos: number }[]): LinhaCiclo[] {
  const m = new Map<string, { nome: string; vs: number[] }>();
  for (const i of itens) {
    const g = m.get(i.chave) ?? { nome: i.nome, vs: [] };
    g.vs.push(i.minutos);
    m.set(i.chave, g);
  }
  return [...m.entries()]
    .map(([chave, g]) => ({
      chave,
      nome: g.nome,
      viagens: g.vs.length,
      medianaMin: percentil(g.vs, 0.5)!,
      p90Min: percentil(g.vs, 0.9)!,
    }))
    // Onde mais se espera primeiro — é o que o dono abre a tela pra ver.
    .sort((a, b) => b.medianaMin - a.medianaMin || b.viagens - a.viagens);
}

export function resumirCiclo(viagens: ViagemCiclo[]) {
  const carga: { chave: string; nome: string; minutos: number }[] = [];
  const descarga: typeof carga = [];
  const trajeto: typeof carga = [];
  const totais: number[] = [];
  let comMarcos = 0;

  for (const v of viagens) {
    const f = fasesDaViagem(v.eventos);
    if (f.carga == null && f.trajeto == null && f.descarga == null) continue;
    comMarcos++;
    if (f.carga != null && v.localCarga) carga.push({ chave: v.localCarga.id, nome: v.localCarga.nome, minutos: f.carga });
    if (f.descarga != null && v.localDescarga)
      descarga.push({ chave: v.localDescarga.id, nome: v.localDescarga.nome, minutos: f.descarga });
    if (f.trajeto != null && v.localCarga && v.localDescarga)
      trajeto.push({
        chave: `${v.localCarga.id}|${v.localDescarga.id}`,
        nome: `${v.localCarga.nome} → ${v.localDescarga.nome}`,
        minutos: f.trajeto,
      });
    if (f.total != null) totais.push(f.total);
  }

  return {
    viagens: viagens.length,
    comMarcos,
    total: totais.length ? { medianaMin: percentil(totais, 0.5)!, p90Min: percentil(totais, 0.9)! } : null,
    naCarga: agrupar(carga),
    naDescarga: agrupar(descarga),
    noTrajeto: agrupar(trajeto),
  };
}
