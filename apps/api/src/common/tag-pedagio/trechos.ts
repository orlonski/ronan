import { HORA, MIN } from "./normalizacao";

/**
 * Da fila de passagens de UMA placa aos trechos e às "viagens que a tag
 * enxergou". Regras da prova (05-prova-cruzamento.md §1b–1d):
 *
 * - a linha do tempo é FÍSICA: passagens da tag + débitos do vale (o caminhão
 *   passou nas duas; sem o vale a A some entre 09:40 e 16:39 em 29/09);
 * - corta quando a carga muda (eixos) ou quando a folga passa de 90 min, sendo
 *   folga = Δt − 1,15 × tempo de rota entre as duas praças. Cortar uma viagem
 *   em dois não custa nada (o casamento junta trechos contíguos); juntar duas
 *   viagens num trecho não tem conserto — por isso o erro anda pro lado do corte;
 * - nunca corta por dia: B 31/08 19:00 → 01/09 00:42 é uma viagem só.
 */

export type EstadoCarga = "CARREGADO" | "VAZIO";

export type PassagemFisica = {
  id: string;
  placa: string;
  /** epoch ms */
  t: number;
  offsetMin: number;
  chavePraca: string;
  rodovia: string;
  kmMetros: number;
  sentido: string;
  cidade: string;
  /** null = categoria que não sei traduzir em eixos. */
  eixos: number | null;
  valorCent: number;
  fonte: "TAG" | "VALE";
  numeroViagemVale?: string | null;
};

export type Trecho = {
  placa: string;
  estado: EstadoCarga;
  passagens: PassagemFisica[];
  ini: number;
  fim: number;
  abriuPor: "inicio" | "carregou" | "descarregou" | "parada";
  /** A 1ª passagem: a decisão de gente se ancora nela. */
  ancoraId: string;
  /** Praças distintas, na ordem em que passou. */
  pracas: string[];
  valorTagCent: number;
  valorValeCent: number;
};

/** Tempo de rota em minutos entre duas praças (OSRM). null = não sei. */
export type TempoDeRota = (chaveA: string, chaveB: string) => number | null;

export const FOLGA_MAX_MIN = 90;
export const FATOR_CAMINHAO = 1.15;
/** Sem tempo de rota (praça sem GPS): corta com folga de 3 h, do lado seguro. */
export const SEM_ROTA_MAX_MIN = 180;
/** Viagem inferida: trechos carregados seguidos, sem vazio no meio, buraco ≤ 8 h. */
export const BURACO_VIAGEM_INFERIDA_H = 8;

/**
 * Quantos eixos quer dizer "carregado" pra esta placa.
 *
 * Do cadastro, quando gente confirmou. Senão, o MAIOR número de eixos que se
 * repete (≥ 2 vezes e ≥ 10% das passagens) — nunca o máximo puro: uma cobrança
 * errada de 9 eixos faria todas as passagens carregadas de 7 parecerem vazias
 * (04-qa I6). Esse mesmo número é a sugestão pro cadastro (a moda das carregadas).
 */
export function eixosDeCarregado(
  passagens: Pick<PassagemFisica, "eixos">[],
  cadastro?: number | null,
): { eixos: number | null; origem: "CADASTRO" | "MODA" | "MAXIMO" | "NENHUM"; contagem: Record<number, number> } {
  const contagem: Record<number, number> = {};
  for (const p of passagens) if (p.eixos != null) contagem[p.eixos] = (contagem[p.eixos] ?? 0) + 1;
  if (cadastro) return { eixos: cadastro, origem: "CADASTRO", contagem };
  const n = passagens.filter((p) => p.eixos != null).length;
  if (n === 0) return { eixos: null, origem: "NENHUM", contagem };
  const minimo = Math.max(2, Math.ceil(n * 0.1));
  const repetidos = Object.entries(contagem)
    .filter(([, q]) => q >= minimo)
    .map(([e]) => Number(e));
  if (repetidos.length) return { eixos: Math.max(...repetidos), origem: "MODA", contagem };
  return { eixos: Math.max(...Object.keys(contagem).map(Number)), origem: "MAXIMO", contagem };
}

/** Minutos de estrada entre duas passagens: OSRM; senão km linear na mesma BR; senão null. */
function minutosDeRota(a: PassagemFisica, b: PassagemFisica, tempo: TempoDeRota): number | null {
  if (a.chavePraca === b.chavePraca) return 0;
  const osrm = tempo(a.chavePraca, b.chavePraca);
  if (osrm != null) return osrm;
  if (a.rodovia === b.rodovia && a.rodovia.startsWith("BR")) return (Math.abs(a.kmMetros - b.kmMetros) / 1000 / 80) * 60;
  return null;
}

/** Corta a linha do tempo de UMA placa em trechos. */
export function cortarTrechos(
  passagensDaPlaca: PassagemFisica[],
  eixosCarregado: number | null,
  tempo: TempoDeRota,
): Trecho[] {
  const tl = [...passagensDaPlaca].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  const trechos: Trecho[] = [];
  let atual: Trecho | null = null;
  let estadoAnterior: EstadoCarga = "VAZIO";
  for (let i = 0; i < tl.length; i++) {
    const x = tl[i]!;
    const estado: EstadoCarga =
      x.eixos == null || eixosCarregado == null ? estadoAnterior : x.eixos >= eixosCarregado ? "CARREGADO" : "VAZIO";
    let abriu: Trecho["abriuPor"] | null = atual ? null : "inicio";
    if (atual) {
      const a = tl[i - 1]!;
      const dtMin = (x.t - a.t) / MIN;
      const rota = minutosDeRota(a, x, tempo);
      const folga = rota == null ? null : dtMin - rota * FATOR_CAMINHAO;
      if (estado !== atual.estado) abriu = estado === "CARREGADO" ? "carregou" : "descarregou";
      else if (folga != null ? folga > FOLGA_MAX_MIN : dtMin > SEM_ROTA_MAX_MIN) abriu = "parada";
    }
    if (abriu) {
      atual = {
        placa: x.placa,
        estado,
        passagens: [],
        ini: x.t,
        fim: x.t,
        abriuPor: abriu,
        ancoraId: x.id,
        pracas: [],
        valorTagCent: 0,
        valorValeCent: 0,
      };
      trechos.push(atual);
    }
    atual!.passagens.push(x);
    atual!.fim = x.t;
    if (atual!.pracas.at(-1) !== x.chavePraca && !atual!.pracas.includes(x.chavePraca)) atual!.pracas.push(x.chavePraca);
    if (x.fonte === "TAG") atual!.valorTagCent += x.valorCent;
    else atual!.valorValeCent += x.valorCent;
    estadoAnterior = estado;
  }
  return trechos;
}

export type ViagemInferida = {
  placa: string;
  /** 1ª passagem da viagem: a pergunta "de quem era a carga" se ancora aqui. */
  ancoraId: string;
  trechos: Trecho[];
  passagens: PassagemFisica[];
  ini: number;
  fim: number;
  temVale: boolean;
  valorTagCent: number;
  valorValeCent: number;
};

/**
 * Trechos carregados seguidos (sem vazio no meio e buraco ≤ 8 h) são UMA
 * viagem: a pergunta "essa carga era de quem?" é feita uma vez por viagem,
 * não por trecho (04-qa I1 — senão a B 31/08 seria perguntada 3 vezes).
 */
export function viagensInferidas(trechosDaPlaca: Trecho[]): ViagemInferida[] {
  const out: ViagemInferida[] = [];
  let atual: ViagemInferida | null = null;
  for (const t of trechosDaPlaca) {
    if (t.estado !== "CARREGADO") {
      atual = null;
      continue;
    }
    if (atual && t.ini - atual.fim <= BURACO_VIAGEM_INFERIDA_H * HORA) {
      atual.trechos.push(t);
      atual.passagens.push(...t.passagens);
      atual.fim = t.fim;
    } else {
      atual = {
        placa: t.placa,
        ancoraId: t.ancoraId,
        trechos: [t],
        passagens: [...t.passagens],
        ini: t.ini,
        fim: t.fim,
        temVale: false,
        valorTagCent: 0,
        valorValeCent: 0,
      };
      out.push(atual);
    }
  }
  for (const v of out) {
    v.temVale = v.passagens.some((p) => p.fonte === "VALE");
    v.valorTagCent = v.passagens.filter((p) => p.fonte === "TAG").reduce((s, p) => s + p.valorCent, 0);
    v.valorValeCent = v.passagens.filter((p) => p.fonte === "VALE").reduce((s, p) => s + p.valorCent, 0);
  }
  return out;
}
