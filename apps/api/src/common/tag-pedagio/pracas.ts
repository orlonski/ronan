import { distanciaMetros } from "../geo";
import { normalizarNome, normalizarRodovia, rodoviasDoRef } from "./normalizacao";
import { PRACAS_ANTT, type PracaAntt } from "./antt-pracas";

/**
 * Praça do extrato ("BR364, KM579+100, NOBRES") → praça do mapa
 * (`PedagioRodovia`, que vem do OSM: um nó por cabine, sem km, quase sempre
 * sem cidade). Texto contra texto não resolve; a prova (05 §1a) casou assim:
 *
 *  1. candidatos: praças cuja rodovia bate (BR-364 ⇄ BR364, listas com `;`) —
 *     ou sem rodovia mas da mesma operadora — a até 40 km da sede da cidade;
 *     cabines a menos de 2 km uma da outra são a MESMA praça;
 *  2. confirmação pela cadeia de km: duas praças da mesma rodovia têm de estar
 *     a uma distância de estrada parecida com o Δkm do extrato (±15%);
 *  3. confirmação pela tarifa: valor ÷ eixos = tarifa por eixo cadastrada;
 *  4. casa sozinha com UM candidato, cadeia sem contradição e ao menos uma
 *     confirmação. Senão vai pra fila "praças a confirmar" — quem decide é
 *     gente (regra "IA nunca afirma").
 *
 * A trava da cadeia evitou um casamento errado na prova: Rosário e Barra do
 * Bugres tinham o MESMO candidato único.
 */

export type NoPedagio = {
  id: string;
  nome: string;
  lat: number;
  lng: number;
  rodovia: string | null;
  concessionaria: string | null;
  /** R$ por eixo, quando cadastrado. */
  valorBase: number | null;
};

export type GrupoPraca = {
  /** O nó representante (o mais perto do centro do grupo). */
  id: string;
  nome: string;
  nos: NoPedagio[];
  lat: number;
  lng: number;
  rodovias: string[];
  operadoras: string;
  valorBase: number | null;
};

export type PracaDoExtrato = {
  operadora: string;
  chave: string;
  rodovia: string;
  kmMetros: number;
  cidade: string;
  concessionaria: string | null;
  uf: string | null;
  /** Tarifa por eixo observada (a mais recente), em centavos. */
  tarifaEixoCent: number | null;
};

export const RAIO_CANDIDATO_KM = 40;
export const RAIO_MESMA_PRACA_M = 2000;
export const TOLERANCIA_CADEIA = 0.15;

export function agruparNos(nos: NoPedagio[]): GrupoPraca[] {
  const grupos: { nos: NoPedagio[] }[] = [];
  for (const n of nos) {
    const g = grupos.find((x) => x.nos.some((m) => distanciaMetros(m.lat, m.lng, n.lat, n.lng) < RAIO_MESMA_PRACA_M));
    if (g) g.nos.push(n);
    else grupos.push({ nos: [n] });
  }
  return grupos.map((g) => {
    const lat = g.nos.reduce((s, n) => s + n.lat, 0) / g.nos.length;
    const lng = g.nos.reduce((s, n) => s + n.lng, 0) / g.nos.length;
    const rep = [...g.nos].sort(
      (a, b) => distanciaMetros(a.lat, a.lng, lat, lng) - distanciaMetros(b.lat, b.lng, lat, lng) || a.id.localeCompare(b.id),
    )[0]!;
    return {
      id: rep.id,
      nome: rep.nome,
      nos: g.nos,
      lat,
      lng,
      rodovias: [...new Set(g.nos.flatMap((n) => rodoviasDoRef(n.rodovia)))],
      operadoras: [...new Set(g.nos.map((n) => n.concessionaria).filter(Boolean))].join("/"),
      valorBase: g.nos.find((n) => n.valorBase != null)?.valorBase ?? null,
    };
  });
}

function operadoraCasa(grupo: GrupoPraca, concessionaria: string | null): boolean {
  if (!concessionaria || !grupo.operadoras) return false;
  const a = normalizarNome(grupo.operadoras);
  const b = normalizarNome(concessionaria).split(" ").slice(0, 2).join(" ");
  return !!b && a.includes(b);
}

export type Candidato = { grupo: GrupoPraca; distanciaKm: number };

export function candidatosDaPraca(
  p: PracaDoExtrato,
  grupos: GrupoPraca[],
  sede: { lat: number; lng: number } | null,
  raioKm = RAIO_CANDIDATO_KM,
): Candidato[] {
  if (!sede) return [];
  return grupos
    .map((g) => ({ grupo: g, distanciaKm: distanciaMetros(sede.lat, sede.lng, g.lat, g.lng) / 1000 }))
    .filter(({ grupo, distanciaKm }) => distanciaKm <= raioKm && mesmaRodovia(p, grupo))
    .sort((a, b) => a.distanciaKm - b.distanciaKm);
}

/** A praça do mapa é da rodovia do extrato (ou, sem rodovia no mapa, da mesma operadora). */
export function mesmaRodovia(p: PracaDoExtrato, grupo: GrupoPraca): boolean {
  const rod = normalizarRodovia(p.rodovia);
  return grupo.rodovias.includes(rod) || (grupo.rodovias.length === 0 && operadoraCasa(grupo, p.concessionaria));
}

/**
 * Candidatos no TERRITÓRIO do município (contorno do IBGE), além do raio em
 * volta da sede — praça a 60 km do centro de um município grande de MT ficava
 * de fora. Distância à sede só pra ordenar (0 sem sede).
 */
export function candidatosNoMunicipio(
  p: PracaDoExtrato,
  grupos: GrupoPraca[],
  malha: Malha,
  sede: { lat: number; lng: number } | null,
): Candidato[] {
  return grupos
    .filter((g) => mesmaRodovia(p, g) && dentroDaMalha(g.lat, g.lng, malha))
    .map((g) => ({ grupo: g, distanciaKm: sede ? distanciaMetros(sede.lat, sede.lng, g.lat, g.lng) / 1000 : 0 }))
    .sort((a, b) => a.distanciaKm - b.distanciaKm);
}

/** Tarifa por eixo do cadastro × a observada. null = sem tarifa cadastrada. */
export function tarifaConfere(p: PracaDoExtrato, g: GrupoPraca): boolean | null {
  if (g.valorBase == null || p.tarifaEixoCent == null) return null;
  return Math.abs(Math.round(g.valorBase * 100) - p.tarifaEixoCent) <= 1;
}

/** Pares de praças vizinhas na mesma rodovia (pela ordem do km): a cadeia. */
export function paresDaCadeia(pracas: PracaDoExtrato[]): [PracaDoExtrato, PracaDoExtrato][] {
  const porRod = new Map<string, PracaDoExtrato[]>();
  for (const p of pracas) porRod.set(p.rodovia, [...(porRod.get(p.rodovia) ?? []), p]);
  const out: [PracaDoExtrato, PracaDoExtrato][] = [];
  for (const lista of porRod.values()) {
    lista.sort((a, b) => a.kmMetros - b.kmMetros);
    for (let i = 0; i + 1 < lista.length; i++) out.push([lista[i]!, lista[i + 1]!]);
  }
  return out;
}

/** Δkm do extrato × distância de estrada entre os candidatos (±15%). */
export function cadeiaConfere(dKmExtrato: number, dKmEstrada: number): boolean {
  if (dKmExtrato <= 0) return false;
  return Math.abs(dKmEstrada - dKmExtrato) / dKmExtrato <= TOLERANCIA_CADEIA;
}

export type DecisaoPraca = {
  status: "CASOU" | "A_CONFIRMAR" | "SEM_CANDIDATO";
  grupo: GrupoPraca | null;
  motivo: string;
};

export function decidirPraca(
  p: PracaDoExtrato,
  candidatos: Candidato[],
  cadeia: { com: string; ok: boolean; dKmExtrato: number; dKmEstrada: number }[],
  tarifaOk: boolean | null,
  /**
   * A conta pelo km a partir das vizinhas já casadas. UMA praça que passa e
   * está entre os candidatos da cidade = casa, mesmo com várias candidatas:
   * o km diz qual. Sozinha, fora dos candidatos, não casa — é conflito.
   */
  pv?: PelasVizinhas,
): DecisaoPraca {
  const pelaRegua = pv && pv.passaram.length === 1 ? pv.passaram[0]! : null;
  if (pelaRegua) {
    const entre = candidatos.find((c) => c.grupo.id === pelaRegua.id);
    if (entre) {
      return {
        status: "CASOU",
        grupo: pelaRegua,
        motivo: `Uma praça só da ${p.rodovia} ${pv!.motivo}, como no extrato.`,
      };
    }
    if (candidatos.length > 0) {
      return {
        status: "A_CONFIRMAR",
        grupo: null,
        motivo: `Pelo km, a praça seria ${pelaRegua.nome}, mas ela não está entre as praças perto de ${p.cidade}.`,
      };
    }
  }
  if (candidatos.length === 0)
    return { status: "SEM_CANDIDATO", grupo: null, motivo: `Nenhuma praça da ${p.rodovia} a até ${RAIO_CANDIDATO_KM} km de ${p.cidade} no mapa.` };
  if (candidatos.length > 1)
    return { status: "A_CONFIRMAR", grupo: null, motivo: `${candidatos.length} praças possíveis perto de ${p.cidade}.` };
  const contradiz = cadeia.filter((c) => !c.ok);
  if (contradiz.length)
    return {
      status: "A_CONFIRMAR",
      grupo: null,
      motivo: `A distância até ${contradiz[0]!.com} não bate: ${contradiz[0]!.dKmExtrato.toFixed(1)} km pelo extrato × ${contradiz[0]!.dKmEstrada.toFixed(1)} km pela estrada.`,
    };
  if (tarifaOk === false)
    return { status: "A_CONFIRMAR", grupo: null, motivo: "A tarifa por eixo não bate com a cadastrada." };
  const confirmacoes = [cadeia.some((c) => c.ok) && "cadeia de km", tarifaOk === true && "tarifa"].filter(Boolean);
  if (!confirmacoes.length)
    return { status: "A_CONFIRMAR", grupo: null, motivo: "Uma praça só no lugar, mas nada pra confirmar (sem vizinha na mesma rodovia nem tarifa cadastrada)." };
  return {
    status: "CASOU",
    grupo: candidatos[0]!.grupo,
    motivo: `Uma praça só da ${p.rodovia} a ${candidatos[0]!.distanciaKm.toFixed(0)} km de ${p.cidade}; confere pela ${confirmacoes.join(" e pela ")}.`,
  };
}

// ---------------------------------------------------------------------------
// Vizinhas já casadas: o km do extrato vira posição na estrada
// ---------------------------------------------------------------------------

/** Praça do extrato já casada com o mapa (de-para) — ponto de apoio pelo km. */
export type PracaConhecida = {
  chave: string;
  rodovia: string;
  kmMetros: number;
  lat: number;
  lng: number;
  nome: string;
  uf: string | null;
};

/** "BR364|579100" → rodovia e km. null se a chave não tem esse formato. */
export function kmDaChave(chave: string): { rodovia: string; kmMetros: number } | null {
  const [rodovia, km] = chave.split("|");
  const kmMetros = Number(km);
  if (!rodovia || !Number.isFinite(kmMetros)) return null;
  return { rodovia, kmMetros };
}

/** Até onde uma vizinha ainda serve de régua: além disso o ±15% vira um trecho grande demais. */
export const ALCANCE_VIZINHA_KM = 250;

/**
 * As praças já casadas mais perto pelo km, UMA de cada lado, na mesma rodovia
 * e no mesmo estado — o km das BRs recomeça em cada divisa, então "BR-364 km
 * 383" de MT e de RO são lugares diferentes.
 */
export function vizinhasNaRodovia(p: PracaDoExtrato, conhecidas: PracaConhecida[]): PracaConhecida[] {
  const rod = normalizarRodovia(p.rodovia);
  const mesmas = conhecidas.filter((c) => {
    const d = Math.abs(c.kmMetros - p.kmMetros);
    return (
      c.chave !== p.chave &&
      normalizarRodovia(c.rodovia) === rod &&
      (!p.uf || !c.uf || p.uf === c.uf) &&
      d >= 1000 &&
      d <= ALCANCE_VIZINHA_KM * 1000
    );
  });
  const abaixo = mesmas.filter((c) => c.kmMetros < p.kmMetros).sort((a, b) => b.kmMetros - a.kmMetros)[0];
  const acima = mesmas.filter((c) => c.kmMetros > p.kmMetros).sort((a, b) => a.kmMetros - b.kmMetros)[0];
  return [abaixo, acima].filter((x): x is PracaConhecida => !!x);
}

export type PelasVizinhas = {
  /** Grupos do mapa cuja distância de estrada até TODAS as vizinhas bate com o Δkm do extrato. */
  passaram: GrupoPraca[];
  motivo: string;
};

/**
 * Qual praça do mapa fica onde o km do extrato diz, contando a partir das
 * vizinhas já casadas: a distância de ESTRADA de cada candidata até cada
 * vizinha tem de bater com o Δkm do extrato (±15%, a mesma régua da cadeia).
 * `estrada(grupoId, vizinhaChave)` = km pela estrada, null = sem rota (não
 * conta a favor).
 */
export function pelasVizinhas(
  p: PracaDoExtrato,
  vizinhas: PracaConhecida[],
  grupos: GrupoPraca[],
  estrada: (grupoId: string, vizinhaChave: string) => number | null,
): PelasVizinhas {
  if (vizinhas.length === 0) return { passaram: [], motivo: "" };
  const passaram = grupos.filter((g) =>
    vizinhas.every((v) => {
      // A própria vizinha não é candidata pra outra praça.
      if (distanciaMetros(g.lat, g.lng, v.lat, v.lng) < RAIO_MESMA_PRACA_M) return false;
      const d = estrada(g.id, v.chave);
      return d != null && cadeiaConfere(Math.abs(p.kmMetros - v.kmMetros) / 1000, d);
    }),
  );
  const desc = vizinhas
    .map((v) => `${v.nome} (km ${(v.kmMetros / 1000).toLocaleString("pt-BR")}), a ${(Math.abs(p.kmMetros - v.kmMetros) / 1000).toFixed(1)} km`)
    .join(" e de ");
  return { passaram, motivo: `pelo km do extrato, fica a ${desc}` };
}

// ---------------------------------------------------------------------------
// Território do município
// ---------------------------------------------------------------------------

type Anel = [number, number][];
/** Geometria GeoJSON do município (IBGE): Polygon ou MultiPolygon, [lng, lat]. */
export type Malha = { type: "Polygon"; coordinates: Anel[] } | { type: "MultiPolygon"; coordinates: Anel[][] };

function dentroDoAnel(lat: number, lng: number, anel: Anel): boolean {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i]!;
    const [xj, yj] = anel[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** O ponto cai dentro do município (respeitando buracos do polígono)? */
export function dentroDaMalha(lat: number, lng: number, malha: Malha): boolean {
  const poligonos = malha.type === "Polygon" ? [malha.coordinates] : malha.coordinates;
  return poligonos.some(
    (aneis) => aneis.length > 0 && dentroDoAnel(lat, lng, aneis[0]!) && !aneis.slice(1).some((buraco) => dentroDoAnel(lat, lng, buraco)),
  );
}

/** Caixa do município [minLat, maxLat, minLng, maxLng], pra pré-filtrar no banco. */
export function caixaDaMalha(malha: Malha): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const pts = (malha.type === "Polygon" ? malha.coordinates : malha.coordinates.flat()).flat();
  return {
    minLat: Math.min(...pts.map((p) => p[1])),
    maxLat: Math.max(...pts.map((p) => p[1])),
    minLng: Math.min(...pts.map((p) => p[0])),
    maxLng: Math.max(...pts.map((p) => p[0])),
  };
}

// ---------------------------------------------------------------------------
// Lista oficial da ANTT (concessões federais)
// ---------------------------------------------------------------------------

/** Distância máxima entre a coordenada da ANTT e a praça do nosso mapa (a ANTT às vezes arredonda). */
export const RAIO_ANTT_MAPA_M = 3000;

/**
 * A praça da fatura na lista da ANTT: mesma rodovia, mesmo estado e km a até
 * 1,5 km (o extrato e a ANTT medem a mesma praça com até meio km de diferença —
 * Alvorada: 745,432 × 744,91 — e duas praças da mesma estrada nunca estão tão
 * perto). É o casamento mais firme que existe — o extrato e a ANTT falam a
 * mesma língua (rodovia + km). A lista às vezes repete a praça (uma linha por
 * sentido): linhas a menos de 3 km uma da outra são a mesma. Sem UF na
 * passagem, só casa se a rodovia+km for única no país (o km recomeça em cada
 * estado).
 */
export function pracaNaAntt(p: PracaDoExtrato, lista: PracaAntt[] = PRACAS_ANTT): PracaAntt | null {
  const rod = normalizarRodovia(p.rodovia);
  const achadas = lista.filter(
    (a) =>
      normalizarRodovia(/^\d+$/.test(a.rodovia) ? `BR${a.rodovia}` : a.rodovia) === rod &&
      (!p.uf || a.uf === p.uf) &&
      Math.abs(a.km * 1000 - p.kmMetros) <= 1500,
  );
  if (achadas.length === 0) return null;
  const primeira = achadas[0]!;
  return achadas.every((a) => distanciaMetros(a.lat, a.lng, primeira.lat, primeira.lng) < RAIO_MESMA_PRACA_M + 1000) ? primeira : null;
}
