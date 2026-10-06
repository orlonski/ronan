import { DIA, HORA, MIN, rotuloHora } from "./normalizacao";
import type { Trecho } from "./trechos";

/**
 * Cruzamento trecho da tag × viagem lançada (05-prova-cruzamento.md §2).
 *
 * O ZERO ERRO da prova não veio do ajuste fino dos pontos — veio das TRAVAS:
 *  1. só trecho CARREGADO vira viagem (o vazio é retorno ou ida vazia);
 *  2. praça na ordem contrária da rota, ou sentido da BR contra o rumo na
 *     maioria das passagens = é a volta, a viagem sai da lista;
 *  3. dia ±1 (e janela da guiada só encostando) NUNCA liga sozinho;
 *  4. vários trechos na mesma viagem só se não houver vazio entre eles;
 *  5. comboio: outro caminhão passou junto e não tem viagem → "confira a placa".
 * Liga sozinho só com ≥ 5 pontos, folga ≥ 2 pra 2ª candidata, janela forte e
 * todas as praças do trecho na rota. O resto é sugestão, sempre com o motivo.
 *
 * Com `ligacaoAutomatica` desligada (o 1º mês de toda empresa), o que ligaria
 * sozinho vira sugestão marcada `ligariaSozinho` — a tela destaca "o sistema
 * ligaria sozinho" e a pessoa confirma.
 */

export type PracaDaRota = { chave: string; ordem: number; rumo: "NORTE" | "SUL" | null };

export type ViagemParaCruzar = {
  id: string;
  /** Placa normalizada do caminhão da viagem. */
  placa: string;
  /** AAAA-MM-DD (o dia do lançamento manual — a data da CARGA). */
  data: string | null;
  /**
   * Quanto o roteador diz que a rota carga→descarga leva, em minutos. Serve pra
   * viagem lançada sem horário: uma viagem de 2 dias passa praça no 2º dia, e
   * sem isto a passagem caía em "um dia de diferença" e nunca ligava sozinha.
   */
  duracaoMin?: number | null;
  /** Viagem guiada: iniciou e o último evento (epoch ms). */
  ini?: number | null;
  fim?: number | null;
  /** Praças da rota NA ORDEM do traçado. null = não sei (sem geometria). */
  pracas: PracaDaRota[] | null;
};

export type ConfigCruzamento = {
  autoMin: number;
  margem: number;
  margemViagem: number;
  comboioMin: number;
  ligacaoAutomatica: boolean;
};

export const CONFIG_CRUZAMENTO_PADRAO: ConfigCruzamento = {
  autoMin: 5,
  margem: 2,
  margemViagem: 1,
  comboioMin: 30,
  ligacaoAutomatica: false,
};

export type Janela = "GUIADA" | "GUIADA_PARCIAL" | "DIA" | "NO_TEMPO_DA_ROTA" | "MADRUGADA" | "DIA_MAIS_MENOS_1";

export type Candidata = {
  viagemId: string;
  pontos: number;
  janela: Janela;
  cobertura: string;
  coberturaTotal: boolean;
  foraDaRota: string[];
  sentidoContra: string[];
  ordemOk: boolean;
  /** Em português, pra tela: "3 de 3 praças da rota, na ordem, mesmo dia". */
  razao: string;
};

export type StatusCruzamento = "AUTO" | "SUGESTAO" | "SOBRA" | "RETORNO" | "IDA_VAZIA" | "VAZIO_SOLTO";

export type ResultadoTrecho = {
  ancoraId: string;
  placa: string;
  estado: Trecho["estado"];
  status: StatusCruzamento;
  viagemId: string | null;
  /** Com a ligação automática desligada: seria AUTO. */
  ligariaSozinho: boolean;
  /** Por que NÃO ligou sozinho (ou por que é retorno). Vazio quando AUTO. */
  motivo: string;
  candidatas: Candidata[];
};

const JANELA_TEXTO: Record<Janela, string> = {
  GUIADA: "dentro do horário da viagem",
  GUIADA_PARCIAL: "encostando no horário da viagem",
  DIA: "mesmo dia",
  NO_TEMPO_DA_ROTA: "dentro do tempo da rota depois da carga",
  MADRUGADA: "na madrugada seguinte",
  DIA_MAIS_MENOS_1: "um dia de diferença",
};

/** Meia-noite local do dia AAAA-MM-DD no fuso da passagem. */
function meiaNoite(data: string, offsetMin: number): number {
  const [a, m, d] = data.split("-").map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d) - offsetMin * MIN;
}

function janela(t: Trecho, v: ViagemParaCruzar): { tipo: Janela; pts: number } | null {
  if (v.ini != null) {
    const a = v.ini - 30 * MIN;
    const b = (v.fim ?? v.ini + DIA) + 30 * MIN;
    if (t.ini >= a && t.fim <= b) return { tipo: "GUIADA", pts: 4 };
    if (t.fim >= a && t.ini <= b) return { tipo: "GUIADA_PARCIAL", pts: 1 };
    return null;
  }
  if (!v.data) return null;
  const d0 = meiaNoite(v.data, t.passagens[0]!.offsetMin);
  if (t.ini >= d0 && t.ini < d0 + DIA) return { tipo: "DIA", pts: 2 };
  // A data lançada é a da carga, sem hora: carregou em algum momento do dia e
  // rodou o tempo da rota. Caminhão pesado anda mais devagar que o roteador e
  // para pra dormir — por isso 1,5× o tempo e mais 6 h de folga.
  if (v.duracaoMin != null && v.duracaoMin > 0) {
    const fim = d0 + DIA + v.duracaoMin * 1.5 * MIN + 6 * HORA;
    if (t.ini >= d0 + DIA && t.ini < fim) return { tipo: "NO_TEMPO_DA_ROTA", pts: 1.5 };
  }
  if (t.ini >= d0 + DIA && t.ini < d0 + 36 * HORA) return { tipo: "MADRUGADA", pts: 1 };
  if (t.ini >= d0 - DIA && t.ini < d0 + 60 * HORA) return { tipo: "DIA_MAIS_MENOS_1", pts: 0 };
  return null;
}

/** Pontua o par (trecho, viagem). null = não é candidata. */
export function pontuar(t: Trecho, v: ViagemParaCruzar): Candidata | null {
  if (t.placa !== v.placa) return null;
  if (t.estado !== "CARREGADO") return null;
  const j = janela(t, v);
  if (!j) return null;
  if (v.pracas === null) return null;
  const naRota = new Map(v.pracas.map((p) => [p.chave, p]));
  const distintas = t.pracas;
  const comuns = distintas.filter((c) => naRota.has(c));
  if (comuns.length === 0) return null;
  const cob = comuns.length / distintas.length;
  let pts = j.pts + 3 * cob;

  // Ordem: as praças comuns, na ordem do tempo, têm que andar pra frente na rota.
  const ords = comuns.map((c) => naRota.get(c)!.ordem);
  if (ords.some((o, i) => i > 0 && o < ords[i - 1]!)) return null;

  // Sentido declarado × rumo da rota (só BR: na MT-246 o "sentido" do extrato
  // não é bússola — a A anda pra LESTE e o extrato diz OESTE).
  const br = t.passagens.filter(
    (p) =>
      p.rodovia.startsWith("BR") &&
      naRota.has(p.chavePraca) &&
      naRota.get(p.chavePraca)!.rumo != null &&
      (p.sentido === "NORTE" || p.sentido === "SUL"),
  );
  const contra = br.filter((p) => naRota.get(p.chavePraca)!.rumo !== p.sentido);
  if (br.length && contra.length * 2 >= br.length + (br.length === 1 ? 0 : 1)) return null;
  const sentidoContra = contra.map((p) => `${p.cidade} ${p.sentido} ${rotuloHora(p.t, p.offsetMin)}`);
  const ordemOk = contra.length === 0 && (br.length > 0 || comuns.length > 1);
  if (ordemOk) pts += 1;

  const foraDaRota = distintas.filter((c) => !naRota.has(c));
  const razao = [
    `${comuns.length} de ${distintas.length} praça${distintas.length > 1 ? "s" : ""} da rota`,
    ordemOk && comuns.length > 1 ? "na ordem" : null,
    JANELA_TEXTO[j.tipo],
    sentidoContra.length ? `contra o rumo: ${sentidoContra.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    viagemId: v.id,
    pontos: Math.round(pts * 10) / 10,
    janela: j.tipo,
    cobertura: `${comuns.length}/${distintas.length}`,
    coberturaTotal: cob === 1,
    foraDaRota,
    sentidoContra,
    ordemOk,
    razao,
  };
}

/**
 * Cruza todos os trechos (de todas as placas) com as viagens. Devolve um
 * resultado por trecho, pela âncora.
 */
export function cruzar(
  trechos: Trecho[],
  viagens: ViagemParaCruzar[],
  config: ConfigCruzamento = CONFIG_CRUZAMENTO_PADRAO,
): Map<string, ResultadoTrecho> {
  const res = new Map<string, ResultadoTrecho>();
  for (const t of trechos) {
    const cands = viagens
      .map((v) => pontuar(t, v))
      .filter((c): c is Candidata => c != null)
      .sort((a, b) => b.pontos - a.pontos || a.viagemId.localeCompare(b.viagemId));
    const [b1, b2] = cands;
    let status: StatusCruzamento = t.estado === "CARREGADO" ? "SOBRA" : "VAZIO_SOLTO";
    let motivo = t.estado === "CARREGADO" ? "Nenhuma viagem deste caminhão com estas praças na rota, na data." : "";
    if (b1) {
      const folga = b2 ? b1.pontos - b2.pontos : Infinity;
      const okJanela = b1.janela !== "DIA_MAIS_MENOS_1" && b1.janela !== "GUIADA_PARCIAL";
      const okCob = b1.coberturaTotal;
      const auto = b1.pontos >= config.autoMin && folga >= config.margem && okJanela && okCob;
      status = auto ? "AUTO" : "SUGESTAO";
      motivo = auto
        ? ""
        : [
            !okJanela && (b1.janela === "DIA_MAIS_MENOS_1" ? "a data da viagem é de um dia de diferença" : "o horário só encosta no da viagem"),
            !okCob && `praça fora da rota da viagem (${b1.foraDaRota.length})`,
            folga < config.margem && b2 && `empate com outra viagem (${b1.pontos} × ${b2.pontos} pontos)`,
            b1.pontos < config.autoMin && `poucos sinais (${b1.pontos} pontos)`,
          ]
            .filter(Boolean)
            .join("; ");
    }
    res.set(t.ancoraId, {
      ancoraId: t.ancoraId,
      placa: t.placa,
      estado: t.estado,
      status,
      viagemId: b1?.viagemId ?? null,
      ligariaSozinho: false,
      motivo,
      candidatas: cands.slice(0, 5),
    });
  }

  // Trava 4 — contiguidade: vários AUTO na mesma viagem só se não houver um
  // trecho de outra condição entre eles (vazio no meio = descarregou).
  const porPlaca = new Map<string, Trecho[]>();
  for (const t of trechos) porPlaca.set(t.placa, [...(porPlaca.get(t.placa) ?? []), t]);
  for (const lista of porPlaca.values()) lista.sort((a, b) => a.ini - b.ini);
  for (const v of viagens) {
    const meus = trechos
      .filter((t) => res.get(t.ancoraId)!.status === "AUTO" && res.get(t.ancoraId)!.viagemId === v.id)
      .sort((a, b) => a.ini - b.ini);
    if (meus.length < 2) continue;
    const doCaminhao = porPlaca.get(v.placa) ?? [];
    const idx = meus.map((t) => doCaminhao.indexOf(t));
    const contiguos = idx.every(
      (k, i) =>
        i === 0 ||
        doCaminhao
          .slice(idx[i - 1]! + 1, k)
          .every((x) => x.estado === "CARREGADO" && res.get(x.ancoraId)!.viagemId === v.id),
    );
    if (contiguos) continue;
    const pts = (t: Trecho) => res.get(t.ancoraId)!.candidatas[0]!.pontos;
    const ord = [...meus].sort((a, b) => pts(b) - pts(a));
    const vence = pts(ord[0]!) - pts(ord[1]!) >= config.margemViagem;
    for (const t of ord.slice(vence ? 1 : 0)) {
      const r = res.get(t.ancoraId)!;
      r.status = "SUGESTAO";
      r.motivo = "outro trecho, com um vazio no meio, também casa com esta viagem";
    }
  }

  // Trava 5 — comboio: outro caminhão passou nas MESMAS praças, no mesmo
  // sentido, a ≤ 30 min, e não tem viagem. A viagem pode estar na placa errada.
  for (const t of trechos) {
    const r = res.get(t.ancoraId)!;
    if (r.status !== "AUTO") continue;
    const gemeo = trechos.find(
      (x) =>
        x.placa !== t.placa &&
        x.estado === t.estado &&
        x.pracas.join() === t.pracas.join() &&
        x.passagens.length === t.passagens.length &&
        x.passagens.every((p, i) => p.sentido === t.passagens[i]!.sentido) &&
        Math.abs(x.ini - t.ini) <= config.comboioMin * MIN,
    );
    if (gemeo && res.get(gemeo.ancoraId)!.candidatas.length === 0) {
      r.status = "SUGESTAO";
      r.motivo = `comboio: a placa ${gemeo.placa} passou junto e não tem viagem — confira a placa`;
    }
  }

  // Primeiro mês: só sugere. O que seria AUTO vira sugestão destacada.
  if (!config.ligacaoAutomatica) {
    for (const r of res.values()) {
      if (r.status === "AUTO") {
        r.status = "SUGESTAO";
        r.ligariaSozinho = true;
        r.motivo = "o sistema ligaria sozinho";
      }
    }
  }

  marcarVazios(trechos, porPlaca, res);
  return res;
}

/**
 * Vazio não vira viagem: vira RETORNO da viagem anterior (passagens depois da
 * descarga, até 24 h) ou IDA VAZIA da seguinte. Custo da viagem, não órfão.
 */
function marcarVazios(trechos: Trecho[], porPlaca: Map<string, Trecho[]>, res: Map<string, ResultadoTrecho>) {
  const ligada = (t: Trecho | undefined) => {
    if (!t) return null;
    const r = res.get(t.ancoraId)!;
    return r.status === "AUTO" || r.status === "SUGESTAO" ? r : null;
  };
  for (const lista of porPlaca.values()) {
    lista.forEach((t, i) => {
      if (t.estado !== "VAZIO") return;
      const r = res.get(t.ancoraId)!;
      const ant = [...lista.slice(0, i)].reverse().find((x) => x.estado === "CARREGADO");
      const prox = lista.slice(i + 1).find((x) => x.estado === "CARREGADO");
      const rAnt = ligada(ant);
      const rProx = ligada(prox);
      if (ant && rAnt && t.ini - ant.fim <= 24 * HORA) {
        r.status = "RETORNO";
        r.viagemId = rAnt.viagemId;
        r.ligariaSozinho = rAnt.ligariaSozinho;
        r.motivo = "volta vazia depois da viagem";
      } else if (prox && rProx && prox.ini - t.fim <= 24 * HORA) {
        r.status = "IDA_VAZIA";
        r.viagemId = rProx.viagemId;
        r.ligariaSozinho = rProx.ligariaSozinho;
        r.motivo = "ida vazia até a carga";
      } else {
        r.status = "VAZIO_SOLTO";
        r.viagemId = null;
        r.motivo = "passagem vazia sem viagem por perto";
      }
    });
  }
  void trechos;
}

/**
 * Praças que a rota da viagem atravessa e a tag NÃO cobrou: a tag não leu
 * (risco de multa de evasão), o motorista pagou em dinheiro, ou foi outro
 * caminho. Não é achado contra ninguém — é o que explica um lançamento manual.
 */
export function pracasEsperadasSemPassagem(
  viagem: ViagemParaCruzar,
  trechosLigados: Trecho[],
): string[] {
  if (!viagem.pracas || viagem.pracas.length === 0) return [];
  const passou = new Set(trechosLigados.flatMap((t) => t.pracas));
  return viagem.pracas.map((p) => p.chave).filter((c) => !passou.has(c));
}
