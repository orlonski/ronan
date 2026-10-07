import { distanciaMetros } from "../geo";
import type { PracaAntt } from "./antt-pracas";

/**
 * Sincronização mensal com a lista oficial de praças da ANTT (Dados Abertos,
 * conjunto "praca-de-pedagio"). Funções puras: ler o CSV e decidir o que entra
 * no mapa. O serviço baixa, grava e roda.
 *
 * As travas são as mesmas da primeira carga (migration 20261007160000):
 *  - coordenada com menos de 4 casas decimais fica de fora — arredondada, erra
 *    até 1 km, e a detecção de "praça na rota" usa 150 m;
 *  - praça a até 8 km de uma que o mapa já tem fica de fora — provavelmente a
 *    MESMA com coordenada diferente, e duas viram pedágio em dobro na rota.
 */

export type LinhaAntt = PracaAntt & { coordenadaPrecisa: boolean };

export const RAIO_JA_NO_MAPA_KM = 8;

const casas = (s: string) => (s.includes(".") ? s.split(".")[1]!.length : 0);

/**
 * O CSV da ANTT (separado por ";", cabeçalho na 1ª linha). Lê pelas colunas,
 * não pela posição — a ANTT já mudou a ordem entre versões. Só as ativas, com
 * km e coordenada numéricos.
 */
export function lerCsvAntt(texto: string): LinhaAntt[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const cab = linhas[0]!.split(";").map((c) => c.trim().toLowerCase());
  const col = (nome: string) => cab.indexOf(nome);
  const iConc = col("concessionaria");
  const iPraca = col("praca_de_pedagio");
  const iRod = col("rodovia");
  const iUf = col("uf");
  const iKm = col("km_m");
  const iMun = col("municipal");
  const iSit = col("situacao");
  const iLat = col("latitude");
  const iLng = col("longitude");
  if ([iConc, iPraca, iRod, iUf, iKm, iLat, iLng].some((i) => i < 0)) return [];
  const out: LinhaAntt[] = [];
  for (const l of linhas.slice(1)) {
    const c = l.split(";").map((x) => x.trim());
    if (iSit >= 0 && c[iSit] && c[iSit]!.toLowerCase() !== "ativo") continue;
    const latS = (c[iLat] ?? "").replace(",", ".");
    const lngS = (c[iLng] ?? "").replace(",", ".");
    const lat = Number(latS);
    const lng = Number(lngS);
    const km = Number((c[iKm] ?? "").replace(",", "."));
    if (!latS || !lngS || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(km)) continue;
    if (lat === 0 || lng === 0) continue;
    out.push({
      concessionaria: c[iConc] ?? "",
      praca: c[iPraca] ?? "",
      rodovia: c[iRod] ?? "",
      uf: (c[iUf] ?? "").toUpperCase(),
      km,
      municipio: iMun >= 0 ? (c[iMun] ?? "") : "",
      lat,
      lng,
      coordenadaPrecisa: casas(latS) >= 4 && casas(lngS) >= 4,
    });
  }
  return out;
}

/** Rodovia como vai pro mapa: só o número (lotes do Paraná) vira as duas siglas. */
export function rodoviaNoMapa(l: Pick<PracaAntt, "rodovia" | "uf">): string {
  if (!/^\d+$/.test(l.rodovia)) return l.rodovia;
  const n = String(Number(l.rodovia)).padStart(3, "0");
  return `${l.uf}-${n};BR-${n}`;
}

export function nomeNoMapa(l: PracaAntt): string {
  const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());
  const km = String(l.km).replace(".", ",");
  return `${l.praca} (${titulo(l.concessionaria)}) — ${rodoviaNoMapa(l).split(";")[0]} km ${km}`.slice(0, 200);
}

/** As praças da lista que o mapa não tem, já com as travas (precisão, 8 km, duplicadas da própria lista). */
export function pracasQueFaltamNoMapa(linhas: LinhaAntt[], mapa: { lat: number; lng: number }[]): LinhaAntt[] {
  const out: LinhaAntt[] = [];
  for (const l of linhas) {
    if (!l.coordenadaPrecisa) continue;
    const perto = (p: { lat: number; lng: number }) => distanciaMetros(l.lat, l.lng, p.lat, p.lng) <= RAIO_JA_NO_MAPA_KM * 1000;
    if (mapa.some(perto) || out.some(perto)) continue;
    out.push(l);
  }
  return out;
}
