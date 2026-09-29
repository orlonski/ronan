import fs from "node:fs";
import path from "node:path";
import type { Medidas } from "./medidas";
import type { NomeViewport } from "./viewports";

/**
 * Orçamento de UX (RATCHET). `orcamento.json` guarda, por rota e viewport, o número medido no
 * painel no momento da última regravação. Ele é o TETO: piorou = a suíte falha; melhorou = a
 * suíte passa e pede pra regravar (`pnpm ux:orcamento:atualizar`), pra o ganho virar o novo teto.
 */
export const ARQUIVO_ORCAMENTO = path.join(__dirname, "orcamento.json");

/** Tolerância do ULTRAWIDE (3440px): a largura útil do conteúdo pode variar até isso, pra cima ou pra baixo. */
export const TOLERANCIA_ULTRA_LARGURA_PX = 16;
/** Ruído de medição aceito nos demais números (px de layout, razão e fonte). */
const TOL_PX = 1;
const TOL_RAZAO = 0.01;
const TOL_FONTE = 0.1;

export interface Entrada {
  overflowHorizontalPx: number;
  elementosQueEstouram: number;
  conteudoCortadoPx: number;
  alvosMenor44: number | null;
  textosMenor14: number | null;
  menorFontePx: number | null;
  inputsMenor16: number | null;
  larguraUtilPx: number;
  larguraUtilRazao: number;
  viewportBloqueiaZoom: boolean;
  menuLateralVisivel: boolean;
}

export interface Arquivo {
  versao: 1;
  rotas: Record<string, Partial<Record<NomeViewport, Entrada>>>;
}

export function entradaDe(m: Medidas): Entrada {
  return {
    overflowHorizontalPx: m.overflowHorizontalPx,
    elementosQueEstouram: m.elementosQueEstouram,
    conteudoCortadoPx: m.conteudoCortadoPx,
    alvosMenor44: m.alvosMenor44,
    textosMenor14: m.textosMenor14,
    menorFontePx: m.menorFontePx,
    inputsMenor16: m.inputsMenor16,
    larguraUtilPx: m.larguraUtilPx,
    larguraUtilRazao: m.larguraUtilRazao,
    viewportBloqueiaZoom: m.viewportBloqueiaZoom,
    menuLateralVisivel: m.menuLateralVisivel,
  };
}

export function lerOrcamento(): Arquivo {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_ORCAMENTO, "utf8"));
  } catch {
    return { versao: 1, rotas: {} };
  }
}

function ordenar<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k] as T]));
}

/** Regrava só a entrada (rota, viewport). Ordem estável pra o diff do git ser legível. */
export function gravarEntrada(rota: string, vp: NomeViewport, e: Entrada): void {
  const arq = lerOrcamento();
  arq.rotas[rota] = ordenar({ ...(arq.rotas[rota] ?? {}), [vp]: e }) as Arquivo["rotas"][string];
  arq.rotas = ordenar(arq.rotas);
  fs.writeFileSync(ARQUIVO_ORCAMENTO, JSON.stringify(arq, null, 2) + "\n");
}

export interface Veredito {
  piorou: string[];
  melhorou: string[];
  informativo: string[];
}

/** Menor é melhor. */
function menorMelhor(nome: string, atual: number | null, teto: number | null, tol: number, v: Veredito) {
  if (atual == null || teto == null) return;
  if (atual > teto + tol) v.piorou.push(`${nome}: ${atual} (teto ${teto})`);
  else if (atual < teto - tol) v.melhorou.push(`${nome}: ${atual} (era ${teto})`);
}
/** Maior é melhor. */
function maiorMelhor(nome: string, atual: number | null, piso: number | null, tol: number, v: Veredito) {
  if (atual == null || piso == null) return;
  if (atual < piso - tol) v.piorou.push(`${nome}: ${atual} (piso ${piso})`);
  else if (atual > piso + tol) v.melhorou.push(`${nome}: ${atual} (era ${piso})`);
}

export function comparar(m: Medidas, orc: Entrada, vp: NomeViewport): Veredito {
  const v: Veredito = { piorou: [], melhorou: [], informativo: [] };
  menorMelhor("overflowHorizontalPx", m.overflowHorizontalPx, orc.overflowHorizontalPx, TOL_PX, v);
  menorMelhor("elementosQueEstouram", m.elementosQueEstouram, orc.elementosQueEstouram, 0, v);
  menorMelhor("conteudoCortadoPx", m.conteudoCortadoPx, orc.conteudoCortadoPx, TOL_PX, v);
  menorMelhor("alvosMenor44", m.alvosMenor44, orc.alvosMenor44, 0, v);
  menorMelhor("textosMenor14", m.textosMenor14, orc.textosMenor14, 0, v);
  menorMelhor("inputsMenor16", m.inputsMenor16, orc.inputsMenor16, 0, v);
  maiorMelhor("menorFontePx", m.menorFontePx, orc.menorFontePx, TOL_FONTE, v);
  if (m.viewportBloqueiaZoom && !orc.viewportBloqueiaZoom) v.piorou.push("viewportBloqueiaZoom: o meta viewport passou a travar o zoom");
  if (!m.viewportBloqueiaZoom && orc.viewportBloqueiaZoom) v.melhorou.push("viewportBloqueiaZoom: o zoom foi liberado");

  if (vp === "ultra") {
    // Ultrawide é o viewport que "não pode piorar": a largura útil não pode se mexer nem pra mais nem pra menos.
    const d = m.larguraUtilPx - orc.larguraUtilPx;
    if (Math.abs(d) > TOLERANCIA_ULTRA_LARGURA_PX) {
      v.piorou.push(`larguraUtilPx (ultrawide): ${m.larguraUtilPx} (baseline ${orc.larguraUtilPx}, tolerância ±${TOLERANCIA_ULTRA_LARGURA_PX}px)`);
    }
    if (m.menuLateralVisivel !== orc.menuLateralVisivel) {
      v.piorou.push(`menuLateralVisivel (ultrawide): ${m.menuLateralVisivel} (baseline ${orc.menuLateralVisivel})`);
    }
  } else {
    maiorMelhor("larguraUtilRazao", m.larguraUtilRazao, orc.larguraUtilRazao, TOL_RAZAO, v);
    if (m.menuLateralVisivel !== orc.menuLateralVisivel) {
      v.informativo.push(`menuLateralVisivel mudou: ${orc.menuLateralVisivel} -> ${m.menuLateralVisivel} (informativo; só o ultrawide é travado)`);
    }
  }
  return v;
}
