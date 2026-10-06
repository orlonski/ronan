import { chaveDaPraca, MIN } from "./normalizacao";
import type { PassagemFisica } from "./trechos";

/**
 * Peças pra montar cenários SINTÉTICOS do cruzamento nos testes: praças
 * públicas (rodovia, km, cidade) e passagens inventadas. Nenhum dado de
 * cliente — os casos difíceis da prova (05) são reproduzidos com outras placas,
 * outros dias e outros horários.
 */

export const PRACAS = {
  ROO: { rodovia: "BR364", kmMetros: 214400, cidade: "RONDONÓPOLIS" },
  CV: { rodovia: "BR364", kmMetros: 316550, cidade: "CAMPO VERDE" },
  SA: { rodovia: "BR364", kmMetros: 383100, cidade: "SANTO ANTÔNIO LEVERGER" },
  JG: { rodovia: "BR364", kmMetros: 479100, cidade: "JANGADA" },
  NB: { rodovia: "BR364", kmMetros: 579100, cidade: "NOBRES" },
  ROS: { rodovia: "MT246", kmMetros: 119000, cidade: "ROSÁRIO DO OESTE" },
} as const;
export type SiglaPraca = keyof typeof PRACAS;
export const chave = (s: SiglaPraca) => chaveDaPraca(PRACAS[s].rodovia, PRACAS[s].kmMetros);

const OFFSET = -240; // MT
let seq = 0;

/** "dd/mm hh:mm" de 2027 (ano inventado) no fuso de MT → epoch ms. */
export const em = (s: string) => {
  const [d, h] = s.split(" ");
  const [dd, mm] = d!.split("/").map(Number) as [number, number];
  const [hh, mi] = (h ?? "00:00").split(":").map(Number) as [number, number];
  return Date.UTC(2027, mm - 1, dd, hh, mi) - OFFSET * MIN;
};

export function px(
  placa: string,
  quando: string,
  praca: SiglaPraca,
  sentido: string,
  eixos: number,
  valorCent: number,
  fonte: "TAG" | "VALE" = "TAG",
  numeroViagemVale: string | null = null,
): PassagemFisica {
  const p = PRACAS[praca];
  return {
    id: `p${++seq}`,
    placa,
    t: em(quando),
    offsetMin: OFFSET,
    chavePraca: chave(praca),
    rodovia: p.rodovia,
    kmMetros: p.kmMetros,
    sentido,
    cidade: p.cidade,
    eixos,
    valorCent,
    fonte,
    numeroViagemVale,
  };
}

/** Rota com as praças na ordem e o rumo da estrada em cada uma. */
export const rota = (...pracas: [SiglaPraca, "NORTE" | "SUL" | null][]) =>
  pracas.map(([s, rumo], ordem) => ({ chave: chave(s), ordem, rumo }));

/** Tempo de rota que ninguém sabe: força o km linear da BR (e 3 h fora dela). */
export const semOsrm = () => null;
