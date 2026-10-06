import { createHash } from "node:crypto";

/**
 * Normalização da passagem da tag: eixos, fuso, instante, praça, placa e a
 * chave de idempotência. Funções puras — o leitor, o cruzamento e o serviço
 * usam as mesmas, senão uma tela diz "7 eixos" e a outra "61".
 */

export const MIN = 60_000;
export const HORA = 3_600_000;
export const DIA = 86_400_000;

/**
 * Código de categoria do Sem Parar → eixos cobrados.
 *
 * Provado na fatura real pela tarifa por eixo, constante em cada praça: até
 * 20 o código É o número de eixos, e 61 = 7 eixos. Outro código (62, 63…) não
 * foi visto: devolve null ("não sei"), e quem usa trata como eixo desconhecido
 * em vez de chutar.
 */
export function eixosDaCategoria(categoria: number): number | null {
  if (categoria === 61) return 7;
  if (categoria >= 1 && categoria <= 20) return categoria;
  return null;
}

/**
 * UF da concessionária. O PDF não traz UF nem fuso — vem daqui. Concessionária
 * desconhecida cai na UF da rodovia estadual ("MT246" → MT) ou fica sem UF.
 */
const UF_DA_CONCESSIONARIA: Record<string, string> = {
  "NOVA ROTA DO OESTE": "MT",
  "ROTA DO OESTE": "MT",
  "VIA BRASIL MT 246": "MT",
  "VIA BRASIL MT 320": "MT",
  "VIA BRASIL MT 100": "MT",
  "MORRO DA MESA": "MT",
  "ECOVIAS DO ARAGUAIA": "TO",
  "ECOVIAS DO CERRADO": "GO",
  "MS VIA": "MS",
  "MSVIA": "MS",
  "WAY 306": "MS",
};

export function ufDaPassagem(concessionaria: string | null | undefined, rodovia: string): string | null {
  const c = (concessionaria ?? "").trim().toUpperCase();
  if (c && UF_DA_CONCESSIONARIA[c]) return UF_DA_CONCESSIONARIA[c]!;
  const estadual = /^([A-Z]{2})\d{2,3}$/.exec(rodovia);
  if (estadual && estadual[1] !== "BR") return estadual[1]!;
  return null;
}

/** Fuso padrão (minutos em relação ao UTC) pela UF. Brasília quando não sei. */
const OFFSET_UF: Record<string, number> = { MT: -240, MS: -240, RO: -240, RR: -240, AM: -240, AC: -300 };
export const offsetDaUf = (uf: string | null): number => (uf ? OFFSET_UF[uf] ?? -180 : -180);

/** "dd/mm/aa" ou "dd/mm/aaaa" + "hh:mm:ss" no fuso dado → instante. */
export function instanteDaPassagem(data: string, hora: string, offsetMin: number): Date {
  const [d, m, a] = data.split("/").map(Number) as [number, number, number];
  const ano = a < 100 ? 2000 + a : a;
  const [hh, mm, ss] = hora.split(":").map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, m - 1, d, hh, mm, ss ?? 0) - offsetMin * MIN);
}

/** A praça física, sem sentido: "BR364|579100". */
export const chaveDaPraca = (rodovia: string, kmMetros: number) => `${rodovia}|${kmMetros}`;

/** "BR-364" ⇄ "BR364" ⇄ "BR 364", e "MT-010" ⇄ "MT10". */
export const normalizarRodovia = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]{2})0*(\d+)$/, "$1$2");

/** O `ref` do OSM pode vir com várias: "BR-163;BR-364;MT-010". */
export const rodoviasDoRef = (ref: string | null | undefined): string[] =>
  (ref ?? "").split(/[;,/]/).map(normalizarRodovia).filter(Boolean);

/** Nome de cidade comparável: sem acento, sem "do/da/de". */
export const normalizarNome = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["DO", "DA", "DE", "DOS", "DAS"].includes(w))
    .join(" ");

export const normalizarPlaca = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * A mesma placa nas duas formas: Mercosul (ABC1D23) e antiga (ABC1323). O
 * cadastro pode ter a antiga e a fatura a nova — o 5º caractere A–J ⇄ 0–9.
 */
export function variantesDaPlaca(placa: string): string[] {
  const p = normalizarPlaca(placa);
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p)) return [p];
  const c = p[4]!;
  const outra = /[A-J]/.test(c)
    ? p.slice(0, 4) + String(c.charCodeAt(0) - 65) + p.slice(5)
    : /\d/.test(c)
      ? p.slice(0, 4) + String.fromCharCode(65 + Number(c)) + p.slice(5)
      : null;
  return outra ? [p, outra] : [p];
}

export type LinhaParaChave = {
  operadora: string;
  placa: string;
  tipo: "PEDAGIO" | "VALE";
  data: string;
  hora: string;
  rodovia: string;
  kmMetros: number;
  sentido: string;
  categoria: number;
  valorCent: number;
  dc: string;
  numeroViagemVale?: string | null;
};

/**
 * Chaves de idempotência das linhas de UM documento, na ordem dada.
 *
 * O ordinal (`#1`, `#2`) é o que impede o dedup de engolir justamente a
 * cobrança em dobro: duas linhas idênticas no arquivo viram duas chaves.
 */
export function chavesDasLinhas(linhas: LinhaParaChave[]): string[] {
  const vistos = new Map<string, number>();
  return linhas.map((x) => {
    const base = [
      x.operadora,
      normalizarPlaca(x.placa),
      x.tipo,
      x.data,
      x.hora,
      x.rodovia,
      x.kmMetros,
      x.sentido,
      x.categoria,
      x.valorCent,
      x.dc,
      x.numeroViagemVale ?? "",
    ].join("|");
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return createHash("sha256").update(`${base}#${n}`).digest("hex");
  });
}

export const centavos = (valor: string) => Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100);

export const brl = (cent: number) =>
  (cent / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "dd/mm hh:mm" no fuso da passagem. */
export function rotuloHora(t: number, offsetMin: number): string {
  const d = new Date(t + offsetMin * MIN);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
