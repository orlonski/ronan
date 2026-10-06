import { distanciaMetros } from "../geo";
import { normalizarNome, normalizarRodovia, rodoviasDoRef } from "./normalizacao";

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
  const rod = normalizarRodovia(p.rodovia);
  return grupos
    .map((g) => ({ grupo: g, distanciaKm: distanciaMetros(sede.lat, sede.lng, g.lat, g.lng) / 1000 }))
    .filter(
      ({ grupo, distanciaKm }) =>
        distanciaKm <= raioKm && (grupo.rodovias.includes(rod) || (grupo.rodovias.length === 0 && operadoraCasa(grupo, p.concessionaria))),
    )
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
): DecisaoPraca {
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
