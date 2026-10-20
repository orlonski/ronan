/**
 * A cena do Escritório de Agentes: dois lugares (OBRA e ESCRITÓRIO) ligados por
 * uma faixa de SINAL, num canvas lógico de 1280x480. A arte mora em `desenho.ts`;
 * aqui moram o estado, as linhas do tempo e o laço de animação.
 *
 * Dois modos, a MESMA arte:
 *  - "vivo": os números vêm do snapshot da API e o ÚNICO gatilho da rotina na
 *    obra é uma chegada real. Sem chegada, a vaga fica vazia (só a camada
 *    ambiente se mexe). Nada de estado inventado.
 *  - "demo": ciclo fictício em loop, com dados de exemplo.
 *
 * Duas linhas do tempo independentes:
 *  - a CHEGADA (`Cheg`): caminhão, descarga, conferência na obra, lançamento,
 *    sinal, torre, servidor, papel na mesa de entrada. Relógio local `tc`
 *    (0 = o motorista lança).
 *  - o VEREDITO (`Ver`): o leitor levanta, pega o papel, lê, carimba e leva ao
 *    destino. Relógio local `u` (0 = começou a rotina do leitor).
 */
import type { EscritorioSnapshot } from "@ronan/shared-types";
import {
  ALTURA, C, LARGURA, OBRA_FIM, SINAL_FIM, ZE, ZO, ZS, criarDesenho, pctNaCena,
  type Braco, type Dir, type LinhaCartao, type Pt, type Pt3, type Zona,
} from "./desenho";

export { ALTURA, LARGURA, pctNaCena, ZE, ZO, ZS };
export type { Zona };

export type Caso = "OK" | "DIV" | "AJ" | "TRAV" | "HUM" | "SEMTK";
export type Modo = "vivo" | "demo";
export type TomLog = "ok" | "no" | "wait" | "info";

export interface Numeros {
  fila: number;
  val: number;
  dev: number;
  aj: number;
  trav: number;
  /** Minutos parada a travada mais antiga (0 quando não há travada). */
  age: number | null;
}
export interface EntradaLog {
  h: string;
  msg: string;
  tom: TomLog;
  gl: string;
}
export interface CenaCallbacks {
  onNumeros(n: Numeros): void;
  onLog(e: EntradaLog): void;
}
export interface Cena {
  setModo(m: Modo): void;
  setSnapshot(s: EscritorioSnapshot | null): void;
  setCaso(c: Caso | ""): void;
  setPausado(p: boolean): void;
  setVelocidade(v: 1 | 2): void;
  /** Dado velho demais: a idade da travada para de subir sozinha. */
  setDefasado(d: boolean): void;
  destruir(): void;
}

/** Rótulos em HTML por cima da cena (a zona diz qual origem usar em `pctNaCena`). */
export const ROTULOS: { zona: Zona; x: number; y: number; alt: number; texto: string; opc?: boolean; obra?: boolean }[] = [
  { zona: ZO, x: 7.0, y: 3.0, alt: 50, texto: "Guarita do conferente", opc: true, obra: true },
  { zona: ZO, x: 9.5, y: 1.0, alt: -12, texto: "Avisos no celular", opc: true, obra: true },
  { zona: ZS, x: 2.77, y: 6.6, alt: -6, texto: "Torre", opc: true },
  { zona: ZS, x: 3.9, y: 1.0, alt: -9, texto: "Servidor", opc: true },
];

type Kind = "OK" | "DIV" | "AJ" | "TRAV" | "NEU" | "SOM";
type Tom3 = "ok" | "no" | "wait" | "neu";
type HumDest = "val" | "dev" | "sai";

const SEQ: Caso[] = ["OK", "DIV", "SEMTK", "AJ", "OK", "TRAV", "HUM", "SEMTK"];
const DEMO_NOMES = ["Carlos M.", "Ana P.", "Pedro L.", "Marta R."];
const DEMO_INICIAL: Numeros = { fila: 7, val: 81, dev: 287, aj: 4, trav: 2, age: 195 };

/** Instante em que o papel pousa na mesa de entrada (tc). */
const T_POUSO = 3.9;
const T_INI_CHEG = -10.4;
const T_INI_AJ = -2.0;
const T_FIM_CHEG = 4.9;
const MAX_CHEGADAS_FILA = 30;
const MAX_VEREDITOS_FILA = 50;
const JANELA_CHEGADA_MS = 10 * 60_000;

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const easeOut = (u: number): number => 1 - Math.pow(1 - u, 3);
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const segT = (t: number, a: number, b: number): number => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));

/* ---------- pontos fixos (OBRA) ---------- */
const DOOR: Pt = [6.1, 5.5];
const MEET: Pt = [6.4, 8.05];
const DG: Pt = [8.05, 5.55];
const MEETC: Pt = [7.35, 8.05];
/* ---------- pontos fixos (ESCRITÓRIO) ---------- */
const HOMEL: Pt = [5.0, 4.75];
const HOMEC: Pt = [5.0, 1.75];
const WPL: Pt = [3.8, 4.7];
const INB: Pt = [2.6, 5.45];
const PILE: Pt = [2.5, 7.0];
const DESK1: Pt3 = [5.0, 5.55, 14.6];
const DESK2: Pt3 = [5.0, 2.6, 14.6];
const HUMS: Pt = [11.7, 5.0];
const HUMH: Pt = [10.5, 7.55];
const SP = 2.4;
const DEST: Record<Kind, Pt3> = { OK: [9.5, 1.2, 44], AJ: [9.35, 3.55, 14], DIV: [9.35, 5.75, 20], TRAV: [8.9, 8.9, 22], NEU: [1.2, 4.0, 10], SOM: [1.2, 4.0, 10] };

/* ---------- roteiro do escritório ---------- */
interface StepIn {
  k: "rise" | "walk" | "stand" | "sitdown" | "sit";
  d?: number;
  pts?: Pt[];
  at?: Pt;
  dir?: Dir;
  arm?: Braco;
  pp?: "hand" | "desk" | "deskC" | null;
  pp2?: "hand" | "desk" | "deskC";
  ppS?: number;
  ppA?: number;
  ppB?: number;
  act?: "read" | "verdict" | "stamp";
  drawer?: boolean;
  ev?: [number, string][];
}
interface Step extends StepIn {
  t0: number;
  t1: number;
  d: number;
}
interface Ev {
  t: number;
  id: string;
  who: string;
  k: string;
}
interface Script {
  L: Step[];
  C: Step[];
  H: Step[] | null;
  ev: Ev[];
  tEnd: number;
  retT: number | null;
}
interface Pose {
  x: number;
  y: number;
  dir: Dir;
  seat?: boolean;
  walk?: boolean;
  chair: number;
  arm: Braco;
  pp: "hand" | "desk" | "deskC" | null;
  sg?: Step;
  fr: number;
}

const plen = (pts: Pt[]): number => {
  let q = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    q += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return q;
};
const rev = (pts: Pt[]): Pt[] => pts.slice().reverse();
function mk(t0: number, steps: StepIn[], who: string, evs: Ev[]): Step[] {
  let tt = t0;
  return steps.map((s) => {
    const d = s.d ?? (s.k === "walk" ? plen(s.pts ?? []) / SP : 0.5);
    const out: Step = { ...s, d, t0: tt, t1: tt + d };
    (s.ev ?? []).forEach((e) => evs.push({ t: out.t0 + e[0] * d, id: e[1], who, k: `${who}${e[1]}${evs.length}` }));
    tt = out.t1;
    return out;
  });
}
/** Caminho do papel até o destino. `de` = de que mesa o agente sai. */
function rotaDestino(kind: Kind, de: "L" | "C", sx: number): { pts: Pt[]; dir: Dir; drawer?: boolean } {
  const h = de === "L" ? HOMEL : HOMEC;
  const p1: Pt = de === "L" ? [6.4, 4.75] : [6.6, 1.75];
  if (kind === "AJ") return { pts: [h, p1, [7.5, 4.3], [8.05, 3.55]], dir: "px" };
  if (kind === "TRAV") return { pts: [h, p1, de === "L" ? [7.5, 5.2] : [7.5, 2.5], [7.5, 7.6], [sx, 7.6]], dir: "py" };
  if (kind === "DIV") return { pts: [h, p1, de === "L" ? [7.5, 5.2] : [7.5, 2.5], [7.5, 5.8], [8.0, 5.8]], dir: "px" };
  if (kind === "NEU" || kind === "SOM") return { pts: de === "L" ? [h, WPL, [2.0, 4.05]] : [h, [3.4, 1.5], [2.0, 2.5], [2.0, 4.05]], dir: "mx" };
  return { pts: de === "L" ? [h, p1, [7.5, 3.8], [7.5, 2.15], [9.47, 2.15]] : [h, p1, [7.5, 2.15], [9.47, 2.15]], dir: "my", drawer: true };
}
function destHum(d: HumDest): { pts: Pt[]; at: Pt; dir: Dir; drawer: boolean } {
  if (d === "val") return { pts: [HUMH, [10.9, 3.6], [10.47, 2.15]], at: [10.47, 2.15], dir: "my", drawer: true };
  if (d === "dev") return { pts: [HUMH, [10.9, 6.6], [10.7, 5.75]], at: [10.7, 5.75], dir: "mx", drawer: false };
  return { pts: [HUMH, [11.0, 6.2], HUMS], at: HUMS, dir: "px", drawer: false };
}

interface OpcVer {
  kind: Kind;
  seg2: boolean;
  sem: boolean;
  hum: boolean;
  soHum: boolean;
  humDest: HumDest;
  nTrav: number;
}
function construirRoteiro(o: OpcVer): Script {
  const evs: Ev[] = [];
  let L: Step[] = [];
  let Cc: Step[] = [];
  let H: Step[] | null = null;
  const sx = Math.min(10.3, 6.8 + 0.5 + o.nTrav * 0.55);
  let tEnd = 0;
  let retT: number | null = null;
  if (!o.soHum) {
    const k = o.kind;
    const ls: StepIn[] = [
      { k: "rise", d: 0.5 },
      { k: "walk", pts: [HOMEL, WPL, INB] },
      { k: "stand", d: 0.8, at: INB, dir: "py", arm: "front", pp: "hand", ppA: 0.5, ev: [[0.5, "pick"]] },
      { k: "walk", pts: [INB, WPL, HOMEL], pp: "hand", arm: "front" },
      { k: "sitdown", d: 0.5, pp: "hand", pp2: "desk", ppS: 0.55 },
      { k: "sit", d: o.sem ? 1.1 : 2.4, pp: "desk", act: "read" },
      { k: "sit", d: 0.6, pp: "desk", act: "verdict" },
    ];
    const destDe = (de: "L" | "C"): StepIn[] => {
      const dd = rotaDestino(k, de, sx);
      const last = dd.pts[dd.pts.length - 1] as Pt;
      const hp = de === "L" ? "desk" : "deskC";
      return [
        { k: "rise", d: 0.5, pp: hp },
        { k: "walk", pts: dd.pts, pp: "hand", arm: "front" },
        { k: "stand", d: dd.drawer ? 2.0 : 1.0, at: last, dir: dd.dir, arm: "front", pp: "hand", ppB: dd.drawer ? 0.55 : 0.5, drawer: !!dd.drawer, ev: [[dd.drawer ? 0.55 : 0.5, "place"]] },
        { k: "walk", pts: rev(dd.pts) },
        { k: "sitdown", d: 0.5 },
      ];
    };
    if (o.seg2) {
      ls.push(
        { k: "rise", d: 0.5, pp: "desk" },
        { k: "walk", pts: [HOMEL, [3.7, 4.45], [3.4, 2.6]], pp: "hand", arm: "front" },
        { k: "stand", d: 0.9, at: [3.4, 2.6], dir: "px", arm: "front", pp: "hand", ppB: 0.5, ev: [[0.5, "handover"]] },
        { k: "walk", pts: [[3.4, 2.6], [3.7, 4.45], HOMEL] },
        { k: "sitdown", d: 0.5 },
      );
    } else {
      ls.push({ k: "sit", d: 0.75, pp: "desk", act: "stamp", ev: [[0.4, "stamp"]] }, ...destDe("L"));
    }
    L = mk(3.0 * 0, ls, "L", evs);
    tEnd = (L[L.length - 1] as Step).t1;
    if (o.seg2) {
      const ho = (evs.find((e) => e.id === "handover") as Ev).t;
      Cc = mk(
        ho,
        [
          { k: "sit", d: 0.35, pp: "deskC" },
          { k: "sit", d: 2.3, pp: "deskC", act: "read" },
          { k: "sit", d: 0.55, pp: "deskC", act: "verdict" },
          { k: "sit", d: 0.75, pp: "deskC", act: "stamp", ev: [[0.4, "stamp"]] },
          ...destDe("C"),
        ],
        "C",
        evs,
      );
      tEnd = Math.max(tEnd, (Cc[Cc.length - 1] as Step).t1);
    }
    if (k === "AJ" || k === "DIV") {
      const pl = evs.find((e) => e.id === "place");
      if (pl) retT = pl.t;
    }
  }
  if (o.hum || o.soHum) {
    const h2 = destHum(o.humDest);
    const hp1: Pt[] = [HUMS, [11.0, 5.9], HUMH];
    H = mk(
      o.soHum ? 0 : 1.1,
      [
        { k: "walk", pts: hp1 },
        { k: "stand", d: 0.9, at: HUMH, dir: "py", arm: "front", pp: "hand", ppA: 0.5, ev: [[0.5, "hpick"]] },
        { k: "walk", pts: h2.pts, pp: "hand", arm: "front" },
        { k: "stand", d: h2.drawer ? 2.0 : 1.0, at: h2.at, dir: h2.dir, arm: "front", pp: "hand", ppB: h2.drawer ? 0.55 : 0.5, drawer: h2.drawer, ev: [[h2.drawer ? 0.55 : 0.5, "hplace"]] },
        { k: "walk", pts: rev(h2.pts).concat([HUMS]) },
      ],
      "H",
      evs,
    );
    tEnd = Math.max(tEnd, (H[H.length - 1] as Step).t1);
  }
  if (retT !== null) tEnd = Math.max(tEnd, retT + 6.3);
  return { L, C: Cc, H, ev: evs, tEnd: tEnd + 1.0, retT };
}

const dirDe = (dx: number, dy: number): Dir => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "px" : "mx") : dy > 0 ? "py" : "my");
function ppDe(sg: Step, fr: number): Pose["pp"] {
  let p: Pose["pp"] = sg.pp ?? null;
  if (sg.pp2 && fr >= (sg.ppS ?? 0)) p = sg.pp2;
  if (sg.ppA !== undefined && fr < sg.ppA) p = null;
  if (sg.ppB !== undefined && fr >= sg.ppB) p = null;
  return p;
}
function poseDe(list: Step[] | null, tt: number, home: Pt | null): Pose | null {
  const base: Pose | null = home ? { x: home[0], y: home[1], dir: "py", seat: true, chair: 0, arm: null, pp: null, fr: 0 } : null;
  if (!list || !list.length) return base;
  const first = list[0] as Step;
  const lastS = list[list.length - 1] as Step;
  if (tt < first.t0 || tt >= lastS.t1) return base;
  const sg = list.find((s) => tt >= s.t0 && tt < s.t1);
  if (!sg) return base;
  const fr = (tt - sg.t0) / sg.d;
  const o: Pose = { x: 0, y: 0, dir: "py", chair: 1, arm: sg.arm ?? null, pp: ppDe(sg, fr), sg, fr };
  const h: Pt = home ?? [0, 0];
  if (sg.k === "rise") {
    o.x = h[0];
    o.y = h[1];
    o.chair = ease(clamp01(fr * 1.2));
    o.seat = fr < 0.35;
    if (!o.seat) o.arm = null;
  } else if (sg.k === "sitdown") {
    o.x = h[0];
    o.y = h[1];
    o.chair = 1 - ease(clamp01(fr * 1.2 - 0.1));
    o.seat = fr > 0.45;
    if (o.seat) o.arm = "front";
  } else if (sg.k === "sit") {
    o.x = h[0];
    o.y = h[1];
    o.chair = 0;
    o.seat = true;
    o.arm = sg.act === "read" || sg.act === "stamp" ? "front" : null;
  } else if (sg.k === "walk") {
    const pts = sg.pts as Pt[];
    const tot = plen(pts);
    let dist = fr * tot;
    let q = 0;
    for (; q < pts.length - 2; q++) {
      const a0 = pts[q] as Pt;
      const b0 = pts[q + 1] as Pt;
      const l = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
      if (dist <= l) break;
      dist -= l;
    }
    const a = pts[q] as Pt;
    const b = pts[q + 1] as Pt;
    const ll = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const f = Math.min(1, dist / ll);
    o.x = lerp(a[0], b[0], f);
    o.y = lerp(a[1], b[1], f);
    o.dir = dirDe(b[0] - a[0], b[1] - a[1]);
    o.walk = true;
  } else {
    const at = sg.at as Pt;
    o.x = at[0];
    o.y = at[1];
    o.dir = sg.dir ?? "py";
  }
  return o;
}
function maoDe(o: Pose): Pt3 {
  const ax = o.dir === "px" || o.dir === "mx";
  const fx = o.dir === "px" ? 1 : o.dir === "mx" ? -1 : 0;
  const fy = o.dir === "py" ? 1 : o.dir === "my" ? -1 : 0;
  return [o.x + fx * 0.27 + (ax ? 0 : 0.17), o.y + fy * 0.27 + (ax ? 0.17 : 0), o.seat ? 18 : 21];
}
const p3 = (a: Pt3, b: Pt3, u: number, lift: number): Pt3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u) + 4 * lift * u * (1 - u)];

/* ---------- entidades ---------- */
interface Cheg {
  id: string;
  emIso?: string;
  emMs: number;
  motorista?: string;
  aj: boolean;
  fromQ: boolean;
  tc: number;
  fired: Record<string, boolean>;
  skip: number | null;
  pousou: boolean;
  entrou: number;
}
interface Carimbada {
  u: number;
  text: string;
  col: string;
  who: string;
}
interface Ver {
  id: string;
  emIso?: string;
  kind: Kind;
  seg2: boolean;
  aviso: boolean;
  sem: boolean;
  hum: boolean;
  soHum: boolean;
  humDest: HumDest;
  texto: string;
  tom: Tom3;
  carimbo: string;
  corCarimbo: string;
  logNeu: string;
  demo: boolean;
  scr: Script;
  u: number;
  fired: Record<string, boolean>;
  skip: number | null;
  pegou: boolean;
  guardou: boolean;
  hpegou: boolean;
  hguardou: boolean;
  stamp: Carimbada | null;
}

export function criarCena(canvas: HTMLCanvasElement, cb: CenaCallbacks, reduzirMovimento: boolean): Cena {
  const reduce = reduzirMovimento;
  const ctxOuNulo = canvas.getContext("2d");
  if (!ctxOuNulo) throw new Error("canvas 2d indisponível");
  const ctx: CanvasRenderingContext2D = ctxOuNulo;
  const D = criarDesenho(reduce);
  let s0: HTMLCanvasElement | null = null;
  let s1: HTMLCanvasElement | null = null;
  let SCL = 0;

  /* ---------- estado ---------- */
  const st: Numeros = { fila: 0, val: 0, dev: 0, aj: 0, trav: 0, age: 0 };
  const S = {
    modo: "vivo" as Modo,
    pausado: false,
    vel: 1 as 1 | 2,
    forcado: "" as Caso | "",
    wall: 0,
    sujo: true,
    // demo
    seqI: 0,
    simMin: 14 * 60 + 7,
    nomeI: 0,
    demoVer: null as Ver | null,
    // vivo
    snap: null as EscritorioSnapshot | null,
    primeira: true,
    vistosCh: new Set<string>(),
    vistosVe: new Set<string>(),
    ageBase: null as number | null,
    ageEm: 0,
    antes: null as Numeros | null,
    // compartilhado
    ch: null as Cheg | null,
    chQ: [] as Cheg[],
    ve: null as Ver | null,
    veQ: [] as Ver[],
    // ambiente
    monteV: 0.55,
    monteBase: 0.55,
    retroProx: 6,
    retroT0: -99,
    figProx: 4,
    figT0: -99,
    neuEm: [] as number[],
    neuRot: "SEGUE O FLUXO NORMAL",
    defasado: false,
    ultimoGerado: 0,
  };
  const nuvensL: [number, number, number][] = [[60, 30, 1], [250, 55, 0.8], [430, 22, 1.2]];
  let ultimoEnviado = "";
  let rafId = 0;
  let ultimoTick = performance.now();
  let ultimoDesenho = 0;

  const relogioTexto = (em?: string): string => {
    if (em && !Number.isNaN(Date.parse(em))) {
      return new Date(em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    }
    if (S.modo === "demo") {
      const m = S.simMin % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    }
    return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  };
  const log = (msg: string, tom: TomLog, gl: string, em?: string): void => cb.onLog({ h: relogioTexto(em), msg, tom, gl });
  function notificar(): void {
    const k = `${st.fila}|${st.val}|${st.dev}|${st.aj}|${st.trav}|${st.age === null ? "n" : Math.round(st.age)}`;
    if (k !== ultimoEnviado) {
      ultimoEnviado = k;
      cb.onNumeros({ ...st });
    }
  }
  const nivelAge = (): number => (st.age === null ? 1 : st.age < 15 ? 0 : st.age < 120 ? 1 : st.age < 480 ? 2 : 3);
  function once(f: Record<string, boolean>, k: string, now: number, at: number, fn: () => void, skip: number | null): void {
    if (now >= at && !f[k]) {
      f[k] = true;
      if (skip !== null && at < skip) return;
      fn();
    }
  }
  const demo = (): boolean => S.modo === "demo";

  /* ---------- fábricas ---------- */
  let seqId = 0;
  function novoVer(o: { emIso?: string; kind: Kind; seg2: boolean; aviso?: boolean; sem?: boolean; hum?: boolean; soHum?: boolean; humDest?: HumDest; texto?: string; tom?: Tom3; carimbo?: string; logNeu?: string; demo: boolean }, nTrav: number): Ver {
    const kind = o.kind;
    const carimbo = o.carimbo ?? { OK: "VALIDADO", AJ: "AJUSTADA", TRAV: "EM ESPERA", DIV: "DEVOLVIDA", NEU: "SEM TICKET", SOM: "SOMBRA" }[kind];
    const corCarimbo = { OK: "#27A06A", AJ: "#5B8AE8", TRAV: "#F2B53F", DIV: "#E05A4E", NEU: "#8190B5", SOM: "#8FA3D6" }[kind];
    const scr = construirRoteiro({ kind, seg2: o.seg2, sem: !!o.sem, hum: !!o.hum, soHum: !!o.soHum, humDest: o.humDest ?? "val", nTrav });
    return {
      id: `v${++seqId}`, emIso: o.emIso, kind, seg2: o.seg2, aviso: !!o.aviso, sem: !!o.sem, hum: !!o.hum, soHum: !!o.soHum, humDest: o.humDest ?? "val",
      texto: o.texto ?? "", tom: o.tom ?? "ok", carimbo, corCarimbo, logNeu: o.logNeu ?? "Sem decisão do agente: a viagem segue a conferência normal",
      demo: o.demo, scr, u: 0, fired: {}, skip: null, pegou: false, guardou: false, hpegou: false, hguardou: false, stamp: null,
    };
  }

  /* ---------- demo ---------- */
  function iniciarCicloDemo(pick?: Caso): void {
    let p: Caso = pick ?? (S.forcado || (SEQ[S.seqI++ % SEQ.length] as Caso));
    if (p === "HUM" && st.trav <= 0) p = "OK";
    const kind: Kind = p === "HUM" ? "OK" : p === "SEMTK" ? "NEU" : (p as Kind);
    const aj = kind === "AJ";
    S.simMin += 2;
    S.monteBase = S.monteV;
    const nome = DEMO_NOMES[S.nomeI++ % DEMO_NOMES.length] as string;
    S.ch = { id: `d${++seqId}`, emMs: 0, motorista: aj ? undefined : nome, aj, fromQ: !aj, tc: aj ? T_INI_AJ : T_INI_CHEG, fired: {}, skip: null, pousou: false, entrou: S.wall };
    S.chQ = [];
    S.ve = null;
    S.veQ = [];
    S.demoVer = novoVer({ kind, seg2: kind === "DIV", aviso: kind === "DIV", sem: p === "SEMTK", hum: p === "HUM", demo: true }, st.trav);
  }

  /* ---------- eventos (log e, só na demo, os números) ---------- */
  function eventosChegada(c: Cheg): void {
    const lg = (m: string, t: TomLog, g2: string): void => log(m, t, g2, c.emIso);
    const d = demo();
    const tc = c.tc;
    const f = c.fired;
    const k = c.skip;
    if (d && !c.aj) {
      once(f, "e1", tc, -9.6, () => lg("Caminhão chegou à obra", "info", "•"), k);
      once(f, "e2", tc, -4.9, () => lg("Descarga concluída na obra", "info", "•"), k);
      once(f, "e3", tc, -2.4, () => lg("Conferente conferiu a carga e o ticket", "info", "•"), k);
      once(f, "e4", tc, -1.0, () => lg("Ticket assinado", "info", "•"), k);
    }
    once(f, "e5", tc, 0, () => {
      if (c.aj) lg("Motorista corrigiu a viagem e reenviou", "info", "•");
      else if (c.motorista) lg(`${c.motorista} lançou uma viagem`, "info", "•");
      else lg(d ? "Motorista lançou a viagem no celular" : "Uma viagem chegou do celular do motorista", "info", "•");
    }, k);
    once(f, "e6", tc, 1.4, () => lg("Sinal passou pela torre", "info", "•"), k);
    once(f, "e7", tc, 2.6, () => lg("Servidor recebeu a viagem", "info", "•"), k);
    once(f, "c6", tc, T_POUSO, () => {
      c.pousou = true;
      if (d) st.fila++;
      lg("Viagem na mesa de entrada", "info", "•");
    }, k);
    c.skip = null;
  }
  function eventosVer(v: Ver): void {
    const lg = (m: string, t: TomLog, g2: string): void => log(m, t, g2, v.emIso);
    const d = v.demo;
    const u = v.u;
    const f = v.fired;
    const k = v.skip;
    const rd = v.scr.L.find((z) => z.act === "read");
    if (rd) once(f, "lr", u, rd.t0, () => lg(v.sem ? (v.demo ? "Viagem sem ticket obrigatório: o leitor só confere o cadastro" : "Nada pra conferir no ticket desta viagem") : "Leitor lendo o ticket", "info", "?"), k);
    v.scr.ev.forEach((e) => {
      once(f, e.k, u, e.t, () => {
        if (e.id === "pick") {
          if (d) st.fila = Math.max(0, st.fila - 1);
          v.pegou = true;
          lg("Leitor foi à mesa de entrada e pegou a viagem do topo da pilha", "info", "•");
        } else if (e.id === "handover") lg(v.texto === "Foto ilegível" ? "Leitor não conseguiu ler a foto e levou o papel ao conferente" : v.kind === "DIV" ? "Leitor achou divergência e levou o papel ao conferente" : "Leitor ficou em dúvida e levou o papel ao conferente", "wait", "!");
        else if (e.id === "stamp") {
          v.stamp = { u: e.t, text: v.carimbo, col: v.corCarimbo, who: e.who };
          lg(`Carimbou: ${v.carimbo.toLowerCase()}`, v.kind === "DIV" ? "no" : v.kind === "TRAV" ? "wait" : v.kind === "NEU" || v.kind === "SOM" ? "info" : "ok", v.kind === "DIV" ? "✗" : v.kind === "TRAV" ? "!" : v.kind === "NEU" || v.kind === "SOM" ? "•" : "✓");
        } else if (e.id === "place") {
          v.guardou = true;
          if (v.kind === "OK") {
            if (d) st.val++;
            lg("Guardou a viagem no arquivo de validadas", "ok", "✓");
          } else if (v.kind === "AJ") {
            if (d) {
              st.aj++;
              st.dev = Math.max(0, st.dev - 1);
            }
            lg("Ajuste conferido: viagem guardada em ajustadas", "ok", "✓");
          } else if (v.kind === "DIV") {
            if (d) st.dev++;
            lg(v.aviso ? "Conferente levou a viagem à caixa de devolvidas" : "Viagem levada à caixa de devolvidas", "no", "✗");
          } else if (v.kind === "TRAV") {
            if (d) {
              if (st.trav === 0) st.age = 3;
              st.trav++;
            }
            lg("Sem como decidir: viagem deixada no balcão, esperando alguém do escritório", "wait", "!");
          } else {
            S.neuEm.push(S.wall);
            S.neuRot = v.kind === "SOM" ? "LIDAS EM SOMBRA" : "SEGUE O FLUXO NORMAL";
            lg(v.logNeu, "info", "•");
          }
        } else if (e.id === "hpick") {
          v.hpegou = true;
          if (d) st.trav = Math.max(0, st.trav - 1);
          lg("Alguém do escritório pegou uma travada no balcão", "info", "•");
        } else if (e.id === "hplace") {
          v.hguardou = true;
          if (d) {
            st.val++;
            st.age = st.trav === 0 ? 0 : (st.age ?? 0) * 0.6;
          }
          lg(v.humDest === "val" ? "Travada resolvida e guardada nas validadas" : v.humDest === "dev" ? "Travada resolvida: viagem devolvida ao motorista" : "Travada resolvida por alguém do escritório", "ok", "✓");
        }
      }, k);
    });
    if (v.scr.retT !== null) {
      once(f, "c12", u, v.scr.retT + 3.9, () => lg(v.kind === "AJ" ? "Motorista recebeu a confirmação do ajuste" : "Aviso ao motorista registrado", "info", "•"), k);
    }
    v.skip = null;
  }

  /* ---------- números exibidos nos montes ---------- */
  /**
   * Ao vivo, os números do snapshot já contam o que a animação ainda está
   * entregando. A ETIQUETA mostra sempre o número real; só a ALTURA do monte
   * espera o papel chegar (e a fila espera o leitor pegar). Em repouso, monte
   * e número coincidem.
   */
  function visiveis(): Numeros {
    const v = { ...st };
    if (demo()) return v;
    // Fila de reprodução grande: o ajuste não faz sentido, a pilha mostra o número real.
    if (S.chQ.length + S.veQ.length > 3) return v;
    const robo = S.snap?.robo;
    const roboAgindo = !!robo && robo.ativo && !robo.modoSombra;
    // só a chegada em curso, e só com o robô agindo (não se supõe que toda viagem gerou job)
    if (roboAgindo && S.ch && !S.ch.pousou) v.fila -= 1;
    const ves = [...(S.ve ? [S.ve] : []), ...S.veQ].slice(0, 2);
    ves.forEach((e) => {
      if (e.kind === "SOM" || e.kind === "NEU") return; // não mexem em pilha nenhuma
      if (!e.pegou) v.fila += 1;
      if (!e.guardou) {
        if (e.kind === "OK") v.val -= 1;
        else if (e.kind === "DIV") v.dev -= 1;
        else if (e.kind === "AJ") v.aj -= 1;
        else if (e.kind === "TRAV") v.trav -= 1;
      }
    });
    v.fila = Math.max(0, v.fila);
    v.val = Math.max(0, v.val);
    v.dev = Math.max(0, v.dev);
    v.aj = Math.max(0, v.aj);
    v.trav = Math.max(0, v.trav);
    return v;
  }

  /* ---------- poses da OBRA (tc relativo ao lançamento) ---------- */
  function truckPose(c: Cheg | null): { pos: number; cen: number; tilt: number; cargo: number; alpha: number; lights: boolean; smoke: boolean } | null {
    if (!c || c.aj) return null;
    const t = c.tc;
    let y: number;
    let a = 1;
    if (t < -7.6) {
      const e = easeOut(segT(t, T_INI_CHEG, -7.6));
      y = c.fromQ ? lerp(9.0, 5.0, e) : lerp(28, 5.0, e);
    } else if (t < -7.0) y = 5.0 + 0.12 * Math.sin(segT(t, -7.6, -7.0) * Math.PI);
    else if (t < 2.4) y = 5.0;
    else {
      y = lerp(5.0, -9.0, Math.pow(segT(t, 2.4, 4.4), 1.7));
      a = y > -2.5 ? 1 : clamp01((y + 9) / 6.5);
    }
    const x = c.fromQ && t < -7.6 ? lerp(1.8, 5.0, ease(easeOut(segT(t, T_INI_CHEG, -7.6)))) : 5.0;
    let tilt = 0;
    if (t >= -6.6) {
      const up = ease(segT(t, -6.6, -5.4));
      tilt = up * (1 - ease(segT(t, -4.6, -3.8)));
    }
    return { pos: y, cen: x, tilt, cargo: 1 - ease(segT(t, -5.4, -4.6)), alpha: a, lights: t < -7.2 || t > 1.8, smoke: t < -7.2 || t > 1.2 };
  }
  interface PoseObra {
    x: number;
    y: number;
    dir: Dir;
    walk?: boolean;
    arm?: Braco;
    sign?: boolean;
    cam?: boolean;
    lanca?: boolean;
    bal?: boolean;
    prancheta?: boolean;
  }
  function motoristaPose(c: Cheg | null): PoseObra | null {
    if (!c || c.aj) return null;
    const t = c.tc;
    if (t < -7.0 || t >= 1.6) return null;
    if (t < -5.6) {
      const u = ease(segT(t, -7.0, -5.6));
      return { x: lerp(DOOR[0], MEET[0], u), y: lerp(DOOR[1], MEET[1], u), dir: "py", walk: true };
    }
    if (t < -3.0) return { x: MEET[0], y: MEET[1], dir: "px" };
    if (t < -1.8) return { x: MEET[0], y: MEET[1], dir: "px", arm: "front" };
    if (t < -0.8) return { x: MEET[0], y: MEET[1], dir: "px", arm: "front", sign: true };
    if (t < -0.2) return { x: MEET[0], y: MEET[1], dir: "px", arm: "up", cam: true };
    if (t < 0.4) return { x: MEET[0], y: MEET[1], dir: "px", arm: "up", lanca: true };
    const v = ease(segT(t, 0.4, 1.6));
    return { x: lerp(MEET[0], DOOR[0], v), y: lerp(MEET[1], DOOR[1], v), dir: "my", walk: true };
  }
  function conferenteObraPose(c: Cheg | null): PoseObra {
    const idle: PoseObra = { x: DG[0], y: DG[1], dir: "py", prancheta: true };
    if (!c || c.aj) return idle;
    const t = c.tc;
    if (t < -4.4) return idle;
    if (t < -3.0) {
      const u = ease(segT(t, -4.4, -3.0));
      return { x: lerp(DG[0], MEETC[0], u), y: lerp(DG[1], MEETC[1], u), dir: u < 0.7 ? "py" : "mx", walk: true, prancheta: true };
    }
    if (t < 0.4) return { x: MEETC[0], y: MEETC[1], dir: "mx", prancheta: true, bal: t < -1.8 };
    if (t < 1.6) {
      const v = ease(segT(t, 0.4, 1.6));
      return { x: lerp(MEETC[0], DG[0], v), y: lerp(MEETC[1], DG[1], v), dir: v < 0.8 ? "my" : "py", walk: true, prancheta: true };
    }
    return idle;
  }

  /* ---------- sinais (estágios) ---------- */
  function sigStage(c: Cheg | null, v: Ver | null): { ledP?: number; spark?: number; torF?: boolean } {
    const o: { ledP?: number; spark?: number; torF?: boolean } = {};
    if (c) {
      const s = c.tc;
      if (s >= 2.2 && s < 2.6) {
        o.ledP = (s - 2.2) / 0.4;
        o.spark = 1 - (s - 2.2) / 0.4;
      }
      if (s >= 2.0 && s < 2.8) o.spark = Math.max(o.spark ?? 0, 0.6);
      if (s >= 0.8 && s < 1.7) o.torF = s > 1.35;
    }
    if (v && v.scr.retT !== null) {
      const r = v.u - v.scr.retT;
      if (r >= 1.7 && r < 2.3) {
        o.ledP = (r - 1.7) / 0.6;
        o.spark = 1 - (r - 1.7) / 0.6;
      }
      if (r >= 2.5 && r < 3.3) o.torF = true;
    }
    return o;
  }
  function bolhaEstado(c: Cheg | null, v: Ver | null): { col?: string; glowA?: number; glowC?: string; tela?: string; glyph?: string } {
    const b: { col?: string; glowA?: number; glowC?: string; tela?: string; glyph?: string } = { col: "rgba(166,179,210,.5)", glowA: 0, tela: "#1B2A52" };
    if (c) {
      const t = c.tc;
      if (t >= 0 && t < 1.2) {
        b.col = "#5B8AE8";
        b.glowA = t < 0.9 ? 1 : 1 - (t - 0.9) / 0.3;
        b.glowC = "rgba(91,138,232,.9)";
        b.tela = "#2A4A9E";
        b.glyph = c.aj ? "↺" : "↑";
      }
      if (!c.aj && t >= -0.2 && t < 0) b.tela = "#27A06A";
    }
    if (v && v.scr.retT !== null) {
      const r = v.u - v.scr.retT;
      if (r >= 3.2 && r < 6.9) {
        const red = v.kind === "DIV";
        b.col = red ? "#E05A4E" : "#5B8AE8";
        b.tela = red ? "#7a2a24" : "#2A4A9E";
        b.glyph = red ? "✗" : "↺";
        b.glowA = 0.9;
        b.glowC = red ? "rgba(224,90,78,.9)" : "rgba(91,138,232,.9)";
      }
    }
    return b;
  }

  /* ---------- quadro ---------- */
  interface Item {
    k: number;
    f: () => void;
  }
  function roboRotulo(): { texto: string; cor: string } {
    if (demo()) return { texto: "DEMONSTRAÇÃO · DADOS DE EXEMPLO", cor: "#F2B53F" };
    const r = S.snap?.robo;
    if (!r) return { texto: "AGUARDANDO DADOS REAIS", cor: "#A6B3D2" };
    if (!r.ativo) return { texto: "AGENTE DESLIGADO", cor: "#A6B3D2" };
    if (r.modoSombra) return { texto: "AGENTE EM MODO SOMBRA", cor: "#F2B53F" };
    return { texto: "AGENTE ATIVO · MODO REAL", cor: "#7ED9A6" };
  }

  function frame(): void {
    if (!s0 || !s1) return;
    const tm = S.wall;
    const g = D.usar(ctx);
    const W = LARGURA;
    const H = ALTURA;
    g.clearRect(0, 0, W, H);
    g.drawImage(s0, 0, 0, W * SCL, H * SCL, 0, 0, W, H);
    const live = !demo();
    const ch = S.ch;
    const ve = S.ve;
    const vis = visiveis();
    const aj = !!ch && ch.aj;
    const veA = ve && !ve.soHum ? ve : null;
    const nome = ch?.motorista;

    /* ===== OBRA ===== */
    D.clipZona(0, OBRA_FIM);
    D.setO(ZO);
    D.nuvens(tm, nuvensL);
    if (S.figT0 >= 0) {
      const fu = (tm - S.figT0) / 10;
      if (fu < 1) D.caminhao({ ori: "x", pos: lerp(-7, 22, fu), cen: -3.5, tilt: 0, cargo: 1, sat: 0.7, tm, alpha: 0.92 });
    }
    g.restore();
    g.drawImage(s1, 0, 0, W * SCL, H * SCL, 0, 0, W, H);
    D.clipZona(0, OBRA_FIM);
    D.setO(ZO);
    const items: Item[] = [];
    const add = (k: number, fn: () => void): void => {
      items.push({ k, f: fn });
    };
    const tp = truckPose(ch);
    // a vaga: apagada sem chegada, âmbar enquanto há uma viagem real em reprodução
    const dp: Pt[] = [D.P(3.7, 4.2, 0), D.P(6.3, 4.2, 0), D.P(6.3, 10.9, 0), D.P(3.7, 10.9, 0)];
    if (live && ch) {
      const pa = 0.16 + (reduce ? 0 : 0.08 * Math.sin(tm * 3));
      D.poly(dp, `rgba(242,181,63,${pa.toFixed(2)})`, "rgba(242,181,63,.85)", 2);
      D.glow(D.P(5, 7.5, 0), 90, "rgba(242,181,63,.3)", 1);
    } else {
      D.poly(dp, "rgba(0,0,0,.16)", null);
      const lp0 = D.P(3.55, 10.95, 8);
      g.fillStyle = "#2a3150";
      g.fillRect(lp0[0] - 2, lp0[1] - 2, 4, 4);
    }
    // fila de caminhões (só reprodução de chegadas reais; na demo, 2 esperando)
    const nEspera = live ? S.chQ.length : 2;
    const shift = ch && ch.fromQ ? 1 - ease(easeOut(segT(ch.tc, T_INI_CHEG, -7.6))) : 0;
    const slotDe = (j: number): number => j + shift;
    for (let j = 0; j < Math.min(nEspera, 3); j++) {
      const q = live ? (S.chQ[j] as Cheg) : null;
      const entra = q ? 1 - easeOut(clamp01((tm - q.entrou) / 1.4)) : 0;
      const sl = slotDe(j) + entra * 1.6;
      if (sl > 2.3) continue;
      const y = 9.0 + 4.4 * sl;
      add(1.8 + y + 2.4, () => D.caminhao({ ori: "y", pos: y, cen: 1.8, tilt: 0, cargo: 1, tm, smoke: false, alpha: 1 - entra * 0.7 }));
    }
    if (tp) add(tp.cen + tp.pos + 2.4, () => D.caminhao({ ori: "y", pos: tp.pos, cen: tp.cen, tilt: tp.tilt, cargo: tp.cargo, tm, smoke: tp.smoke, lights: tp.lights, alpha: tp.alpha }));
    // monte e retroescavadeira
    const mdump = ease(segT(ch?.tc ?? 99, -5.4, -4.6));
    let mnow = S.monteV;
    if (ch && !aj && !reduce) {
      mnow = lerp(S.monteBase, Math.min(1, S.monteBase + 0.3), mdump);
      if (ch.tc >= -4.6) S.monteV = Math.min(1, S.monteBase + 0.3);
    }
    const rph = S.retroT0 >= 0 ? (tm - S.retroT0) / 5 : -1;
    add(5 + 10.95, () => D.monte(mnow));
    add(7.2 + 10.2 + 1, () => D.retro(tm, rph));
    add(1.5 + 1.1, () => D.betoneira(tm));
    add(8 + 4, () => D.guarita());
    add(9.6 + 4.7, () => D.mesinha());
    add(9.8 + 8.2, () => D.palete());
    add(9.2 + 12.4 + 1.5, () => D.container());
    add(9.6 + 5.9, () => D.tubos());
    add(10.2 + 3.0, () => D.torreLuz());
    add(5 + 11.4, () => D.cones());
    const bst = bolhaEstado(ch, ve);
    add(9.5 + 1.0, () => D.bolha(bst, tm));
    const mt = motoristaPose(ch);
    if (mt) {
      add(mt.x + mt.y, () => {
        D.humano({ x: mt.x, y: mt.y, dir: mt.dir, t: tm, shirt: "#8A3A12", skin: C.pa, hair: C.pc, walk: mt.walk, arm: mt.arm, cap: true });
        if (mt.arm === "up") D.celular(D.P(mt.x + 0.16, mt.y, 34), !!mt.lanca);
      });
    }
    const cf = conferenteObraPose(ch);
    add(cf.x + cf.y, () => D.humano({ x: cf.x, y: cf.y, dir: cf.dir, t: tm, shirt: "#2A4A9E", skin: C.pc, hair: C.g0, vest: true, helmet: true, walk: cf.walk, arm: "front", prancheta: cf.prancheta }));
    items.sort((a, b) => a.k - b.k);
    items.forEach((i) => i.f());
    // etiquetas da obra
    if (nEspera > 0) {
      const sl0 = slotDe(0);
      const qp = D.P(1.8, 9.0 + 4.4 * sl0, 48);
      D.tagS(qp[0], qp[1], `A reproduzir · +${nEspera}`, "#DF7234");
    }
    if (tp && live) {
      const q = D.P(tp.cen, tp.pos + 1.6, 66);
      D.tagS(q[0], q[1], "↓ viagem real", "#DF7234", "rgba(60,24,6,.94)");
    }
    if (mt && nome) D.tag(mt.x, mt.y, -22, `MOTORISTA · ${nome}`, "#DF7234", "rgba(60,24,6,.94)");
    if (cf.bal) {
      const bp = D.P(cf.x, cf.y, 50);
      D.balaoReticencias(bp, tm);
    }
    if (ch && mt && (mt.sign || (ch.tc >= -3.0 && ch.tc < -1.8))) D.ticketCard(D.P(6.9, 8.05, 58), mt.sign ? segT(ch.tc, -1.8, -0.8) : -1);
    if (ch && mt && ch.tc >= -0.55 && ch.tc < -0.35) D.glow(D.P(mt.x + 0.16, mt.y, 34), 70, "rgba(255,255,255,.95)", 1 - ((ch.tc + 0.55) / 0.2) * 0.6);
    g.restore();

    /* ===== SINAL ===== */
    D.setO(ZS);
    const sg = sigStage(ch, ve);
    D.clipZona(OBRA_FIM, SINAL_FIM);
    D.torre(tm, !!sg.torF);
    D.servidor(tm, sg.ledP ?? -1, sg.spark ?? 0);
    g.restore();

    /* ===== ESCRITÓRIO ===== */
    D.clipZona(SINAL_FIM, W);
    D.parede(tm, !!ve, roboRotulo());
    D.setO(ZE);
    const scr = ve ? ve.scr : null;
    const u = ve ? ve.u : 0;
    const Lp = poseDe(scr ? scr.L : null, u, HOMEL) as Pose;
    const Cp = poseDe(scr ? scr.C : null, u, HOMEC) as Pose;
    const Hp = poseDe(scr ? scr.H : null, u, null);
    const lsg = Lp.sg;
    const csg = Cp.sg;
    const readL = !!lsg && lsg.act === "read";
    const readC = !!csg && csg.act === "read";
    let drawerIdx = -1;
    let drawerP = 0;
    const tmpD: [Pose | null, number][] = [[Lp, 1], [Hp, 2]];
    tmpD.forEach((a) => {
      const o = a[0];
      if (o && o.sg && o.sg.drawer) {
        const f = o.fr;
        drawerIdx = a[1];
        drawerP = f < 0.2 ? ease(f / 0.2) : f < 0.8 ? 1 : 1 - ease((f - 0.8) / 0.2);
      }
    });
    // C também pode abrir a gaveta
    if (Cp.sg && Cp.sg.drawer) {
      const f = Cp.fr;
      drawerIdx = 1;
      drawerP = f < 0.2 ? ease(f / 0.2) : f < 0.8 ? 1 : 1 - ease((f - 0.8) / 0.2);
    }
    const it2: Item[] = [];
    const add2 = (k: number, fn: () => void): void => {
      it2.push({ k, f: fn });
    };
    const rotuloEntrada = `MESA DE ENTRADA · ${st.fila}`;
    add2(9.5, () => {
      D.mesa(1.5, 6, 2, 2, C.md);
      const topo = D.pilhaGrupo(1.7, 6.2, 1.6, 1.6, 14, vis.fila, { col: "#5B8AE8", max: 20 });
      D.plaquetaPendente(2.5, 8.35, 6, rotuloEntrada, "#5B8AE8");
      if (ch && ch.tc >= 3.4 && ch.tc < T_POUSO) {
        const uf = (ch.tc - 3.4) / 0.5;
        const bq = uf < 0.75 ? easeOut(uf / 0.75) : 1 - Math.sin(((uf - 0.75) / 0.25) * Math.PI) * 0.1;
        D.papelChato(lerp(0.1, PILE[0], easeOut(uf)), lerp(7.5, PILE[1], easeOut(uf)), lerp(34, topo, bq), C.pp);
      }
    });
    add2(HOMEL[0] + HOMEL[1] - 0.6, () => D.cadeira(HOMEL[0], HOMEL[1], Lp.chair));
    add2(HOMEC[0] + HOMEC[1] - 0.6, () => D.cadeira(HOMEC[0], HOMEC[1], Cp.chair * -0.6));
    add2(11, () => {
      D.mesa(4, 5, 2, 2, C.md);
      D.monitor(5.0, 6.4, readL, "rgba(91,138,232,.6)");
      if (readL && lsg) D.box(4.62, 6.36, 32, 0.76 * clamp01((u - lsg.t0) / lsg.d), 0.03, 0.9, "#7ED9A6", { edge: null });
      D.box(4.5, 5.2, 14, 0.5, 0.2, 0.8, "#cfd8ee");
      D.box(5.45, 5.3, 14, 0.12, 0.16, 0.8, C.pp);
    });
    add2(8, () => {
      D.mesa(4, 2, 2, 2, C.md);
      D.monitor(5.0, 3.45, readC, "rgba(242,181,63,.55)");
      if (readC && csg) D.box(4.62, 3.41, 32, 0.76 * clamp01((u - csg.t0) / csg.d), 0.03, 0.9, "#F2B53F", { edge: null });
      D.box(4.5, 2.25, 14, 0.5, 0.2, 0.8, "#cfd8ee");
    });
    // papel principal: sempre na mão de alguém, numa mesa ou na pilha
    let mp: Pt3 | null = null;
    if (ve) {
      if (Cp.pp === "hand") mp = maoDe(Cp);
      else if (Cp.pp === "deskC") mp = DESK2;
      else if (Lp.pp === "hand") mp = maoDe(Lp);
      else if (Lp.pp === "desk") mp = DESK1;
    }
    const hmp = ve && Hp && Hp.pp === "hand" ? maoDe(Hp) : null;
    const stampCol = ve && ve.stamp ? ve.stamp.col : null;
    add2(40, () => {
      if (mp) {
        D.papelChato(mp[0], mp[1], mp[2], C.pp);
        if (stampCol) D.box(mp[0] - 0.12, mp[1] - 0.15, mp[2] + 1.4, 0.24, 0.1, 0.5, stampCol, { edge: null });
      }
      if (hmp) D.papelChato(hmp[0], hmp[1], hmp[2], "#ffe0a0");
    });
    // carimbo
    let stp: { p: Pt3; f: number; col: string } | null = null;
    ([[lsg, DESK1], [csg, DESK2]] as [Step | undefined, Pt3][]).forEach((a) => {
      const s2 = a[0];
      if (s2 && s2.act === "stamp" && ve) stp = { p: a[1], f: (u - s2.t0) / s2.d, col: ve.corCarimbo };
    });
    if (stp) {
      const sp = stp as { p: Pt3; f: number; col: string };
      add2(41, () => D.carimbo(sp.p, sp.f, sp.col));
    }
    const agente = (pose: Pose, tg: string, tgc: string, shirt: string, skin: string, hair: string, badge: boolean): void => {
      const tz = pose.seat ? 44 : 50;
      add2(pose.x + pose.y + 0.05, () => {
        D.tag(pose.x, pose.y, tz, tg, tgc);
        D.humano({ x: pose.x, y: pose.y, dir: pose.dir, t: tm, shirt, skin, hair, badge, walk: pose.walk, arm: pose.arm, seat: pose.seat });
      });
    };
    agente(Lp, S.veQ.length > 0 ? `LEITOR · +${S.veQ.length}` : "LEITOR", C.azl, "#2A4A9E", C.pb, C.g0, true);
    agente(Cp, "CONFERENTE", C.am, "#B4501A", C.pa, C.pc, false);
    if (Hp) {
      const hfade = Hp.x > 11.5 ? clamp01((12.3 - Hp.x) / 0.8) : 1;
      add2(Hp.x + Hp.y + 0.05, () => {
        g.save();
        g.globalAlpha = hfade;
        D.humano({ x: Hp.x, y: Hp.y, dir: Hp.dir, t: tm, shirt: "#1d8a5c", skin: C.pc, hair: C.g0, walk: Hp.walk, arm: Hp.arm });
        g.restore();
      });
    }
    const pulsoDest = (k: Kind): boolean => !!ve && ve.kind === k && ve.scr.retT !== null && ve.u > ve.scr.retT && ve.u < ve.scr.retT + 1.5;
    const rotuloVal = `${live ? "VALIDADAS 24 H" : "VALIDADAS"} · ${st.val}`;
    add2(10.2, () => D.arquivo(drawerIdx, drawerP, vis.val, drawerP > 0, rotuloVal));
    add2(13.2, () => D.pastaAjustadas(vis.aj, pulsoDest("AJ"), `AJUSTADAS · ${st.aj}`));
    add2(15.4, () => D.caixaDevolvidas(vis.dev, pulsoDest("DIV"), `DEVOLVIDAS · ${st.dev}`));
    add2(17.5, () => D.balcao(vis.trav, nivelAge(), tm, st.trav > 0, `ESPERANDO O ESCRITÓRIO · ${st.trav}`));
    S.neuEm = S.neuEm.filter((x) => tm - x < 25);
    if (S.neuEm.length > 0) add2(12.0, () => D.bandejaNeutra(Math.min(4, S.neuEm.length), S.neuRot));
    add2(20.5, () => D.planta(0.7, 9.3));
    add2(8.1, () => D.cafeteira(7.3, 0.95));
    it2.sort((a, b) => a.k - b.k);
    if (st.fila > 0) {
      const pa2 = 0.55 + (reduce ? 0 : 0.35 * Math.sin(tm * 3));
      D.poly([D.P(1.35, 5.85, 14), D.P(3.65, 5.85, 14), D.P(3.65, 8.15, 14), D.P(1.35, 8.15, 14)], "rgba(91,138,232,.10)", `rgba(91,138,232,${pa2.toFixed(2)})`, 1.6);
    }
    it2.forEach((i) => i.f());
    D.descarregarPlaquetas();
    g.restore();

    /* ===== sinais por cima ===== */
    desenharSinais(tm, ch, ve);
    if (ve && !ve.soHum) {
      const dv = ve.kind === "DIV";
      D.setO(ZE);
      if (readL && lsg) {
        const pr = clamp01((u - lsg.t0) / (lsg.d * 0.9));
        let rows: LinhaCartao[];
        let titulo = ve.kind === "SOM" ? "LEITOR · SOMBRA (SEM EFEITO)" : ve.sem ? "LEITOR · SEM TICKET" : "LEITOR · TICKET";
        if (ve.demo) {
          rows = ve.sem
            ? [["Ticket", "não obrigatório", "ok"], ["Tipo", "viagem s/ ticket", "ok"], ["Obra", "Obra Centro", "ok"], ["Data", "hoje", "ok"]]
            : [["Peso", dv ? "lido 17,9 t" : "18,4 t", dv ? "no" : "ok"], ["Material", "Brita 1", "ok"], ["Placa", "conferida", "ok"], ["Obra", ve.kind === "TRAV" ? "sem vínculo" : "Obra Centro", ve.kind === "TRAV" ? "wait" : "ok"], ["Data", "hoje", "ok"]];
        } else {
          // Ao vivo: nenhum campo inventado, só "lendo" e o veredito de verdade.
          rows = [["Resultado", ve.seg2 ? "pediu 2ª leitura" : ve.texto, ve.seg2 ? "wait" : ve.tom]];
          if (ve.kind === "NEU" && ve.sem) titulo = "LEITOR · SEM TICKET";
        }
        D.cartao(1100, 40, 150, titulo, rows, pr, "#5B8AE8", tm, D.P(5.0, 4.75, 46));
      }
      if (readC && csg) {
        const rows: LinhaCartao[] = ve.demo
          ? [["Peso", "lido 17,9 t", "no"], ["Lançado", "18,4 t", "ok"], ["Diferença", "0,5 t", "no"]]
          : [["Resultado", ve.texto, ve.tom]];
        D.cartao(790, 46, 150, "CONFERENTE · 2ª LEITURA", rows, clamp01((u - csg.t0) / (csg.d * 0.9)), "#F2B53F", tm, D.P(5.0, 1.75, 46));
      }
      const tipoL: "ok" | "no" | "wait" | "neu" = ve.seg2 || ve.kind === "TRAV" ? "wait" : ve.kind === "DIV" ? "no" : ve.kind === "NEU" || ve.kind === "SOM" ? "neu" : "ok";
      const tipoC: "ok" | "no" | "wait" | "neu" = ve.kind === "DIV" ? "no" : ve.kind === "TRAV" ? "wait" : ve.kind === "NEU" || ve.kind === "SOM" ? "neu" : "ok";
      if (lsg && lsg.act === "verdict") D.selo(D.P(4.25, 5.2, 46), tipoL, easeOut(clamp01((u - lsg.t0) / 0.4)));
      if (csg && csg.act === "verdict") D.selo(D.P(4.25, 2.2, 46), tipoC, easeOut(clamp01((u - csg.t0) / 0.4)));
      if (ve.stamp && u - ve.stamp.u < 2.2) {
        const pp0 = D.P(5.0, ve.stamp.who === "C" ? 2.6 : 5.55, 40);
        D.marcaCarimbo(pp0, ve.stamp.text, ve.stamp.col, u - ve.stamp.u, ve.stamp.who === "C" ? -62 : ve.stamp.text.length > 12 ? -24 : 34);
      }
    }
    // molduras dos painéis e vinheta
    g.lineWidth = 1;
    D.roundRect(0.5, 0.5, OBRA_FIM - 1, H - 1, 10);
    g.strokeStyle = "rgba(223,114,52,.55)";
    g.stroke();
    D.roundRect(SINAL_FIM + 0.5, 0.5, W - SINAL_FIM - 1, H - 1, 10);
    g.strokeStyle = "rgba(91,138,232,.55)";
    g.stroke();
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, W * 0.62);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(3,5,14,.18)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  function desenharSinais(tm: number, ch: Cheg | null, ve: Ver | null): void {
    const g = D.usar(ctx);
    const { bub, tor, dish, slot } = D.PT;
    g.save();
    g.lineCap = "round";
    // guias tracejadas = ilustração (a legenda na faixa explica)
    g.setLineDash([3, 5]);
    g.strokeStyle = "rgba(127,149,201,.35)";
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i <= 20; i++) {
      const q = D.arcPt(bub, tor, i / 20, 40);
      if (i) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
    }
    g.stroke();
    g.beginPath();
    g.moveTo(tor[0], tor[1]);
    g.lineTo(dish[0], dish[1]);
    g.stroke();
    g.setLineDash([]);
    // pulsos lentos pelo duto: linha cheia, o registro real
    if (!reduce) {
      for (let r = 0; r < 3; r++) {
        const pc = D.cabPos((tm * 0.18 + r / 3) % 1);
        g.fillStyle = "rgba(91,138,232,.7)";
        g.fillRect(pc[0] - 1, pc[1] - 1, 2, 2);
      }
    }
    g.restore();
    const ajC = !!ch && ch.aj;
    if (ch) {
      const s = ch.tc;
      const glyph = ajC ? "↺" : null;
      if (!ajC && s >= 0 && s < 0.45) {
        D.setO(ZO);
        const ph = D.P(MEET[0] + 0.16, MEET[1], 34);
        const u0 = ease(s / 0.45);
        const pt = D.arcPt(ph, bub, u0, 10);
        g.setLineDash([2, 3]);
        g.strokeStyle = "rgba(120,170,255,.8)";
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(ph[0], ph[1]);
        g.lineTo(pt[0], pt[1]);
        g.stroke();
        g.setLineDash([]);
        D.pacoteS(pt, "b", false);
      }
      if (s >= 0.3 && s < 0.9) D.ondasS(bub, tm, 20);
      if (s >= 0.8 && s < 1.5) {
        const u1 = ease((s - 0.8) / 0.7);
        D.trilhaArc(bub, tor, u1, 40, "b", false);
        D.pacoteS(D.arcPt(bub, tor, u1, 40), "b", false, glyph);
      }
      if (s >= 1.5 && s < 2.2) {
        const u2 = ease((s - 1.5) / 0.7);
        D.ondasS([tor[0] + 4, tor[1] + 10], tm, 70);
        for (let j = 1; j <= 6; j++) {
          const uu = Math.max(0, u2 - j * 0.04);
          g.beginPath();
          g.arc(lerp(tor[0], dish[0], uu), lerp(tor[1], dish[1], uu), Math.max(0.5, 3 - j * 0.4), 0, 6.2832);
          g.fillStyle = `rgba(91,138,232,${(0.5 - j * 0.07).toFixed(2)})`;
          g.fill();
        }
        D.pacoteS([lerp(tor[0], dish[0], u2), lerp(tor[1], dish[1], u2)], "b", false, glyph);
      }
      if (s >= 2.6 && s < 3.4) {
        const u3 = easeOut((s - 2.6) / 0.8);
        for (let q2 = 1; q2 < 7; q2++) {
          const cq = D.cabPos(Math.max(0, u3 - q2 * 0.03));
          g.beginPath();
          g.arc(cq[0], cq[1], Math.max(0.6, 2.8 - q2 * 0.35), 0, 6.2832);
          g.fillStyle = `rgba(91,138,232,${(0.55 - q2 * 0.08).toFixed(2)})`;
          g.fill();
        }
        D.pacoteS(D.cabPos(u3), "b", true, glyph);
      }
    }
    // retorno (aviso ao celular do motorista)
    if (ve && ve.scr.retT !== null) {
      const rr = ve.u - ve.scr.retT;
      const red = ve.kind === "DIV";
      const col = red ? "r" : "b";
      const gl = red ? null : "↺";
      D.setO(ZE);
      const dz = DEST[ve.kind];
      const from = D.P(dz[0], dz[1], dz[2] + 2);
      if (rr >= 0 && rr < 0.9) {
        const ua = ease(rr / 0.9);
        D.trilhaArc(from, slot, ua, 30, col, true);
        D.pacoteS(D.arcPt(from, slot, ua, 30), col, true, gl);
      }
      if (rr >= 0.9 && rr < 1.7) {
        const ub = easeOut((rr - 0.9) / 0.8);
        for (let q3 = 1; q3 < 7; q3++) {
          const cq3 = D.cabPos(Math.min(1, 1 - ub + q3 * 0.03));
          g.beginPath();
          g.arc(cq3[0], cq3[1], Math.max(0.6, 2.8 - q3 * 0.35), 0, 6.2832);
          g.fillStyle = `${(D.COLS[col] as [string, string])[0]}${(0.55 - q3 * 0.08).toFixed(2)})`;
          g.fill();
        }
        D.pacoteS(D.cabPos(1 - ub), col, true, gl);
      }
      if (rr >= 1.7 && rr < 2.5) {
        const uc = ease((rr - 1.7) / 0.8);
        D.pacoteS([lerp(dish[0], tor[0], uc), lerp(dish[1], tor[1], uc)], col, false, gl);
      }
      if (rr >= 2.5 && rr < 3.2) {
        const ud = ease((rr - 2.5) / 0.7);
        D.ondasS([tor[0] - 4, tor[1] + 10], tm, 50, red ? "rgba(224,90,78," : "rgba(126,180,255,");
        D.trilhaArc(tor, bub, ud, 36, col, false);
        D.pacoteS(D.arcPt(tor, bub, ud, 36), col, false, gl);
      }
      if (rr >= 3.2 && rr < 6.5) D.selo([bub[0], bub[1] - 36], red ? "no" : "ok", easeOut(clamp01((rr - 3.2) / 0.5)));
    }
  }

  /* ---------- ao vivo: do snapshot às animações ---------- */
  function veredictoParaKind(v: EscritorioSnapshot["veredictos"][number], sombra: boolean): { kind: Kind; texto: string; tom: Tom3; aviso: boolean; sem: boolean; carimbo?: string; logNeu?: string } {
    const acao = v.acao ?? "";
    // MODO SOMBRA: o robô só anota (acao NENHUMA) e a viagem NÃO muda, nem entra em contador.
    // Todo veredito vira "lido em sombra": carimbo neutro, nada vai pra arquivo/caixa/pasta/balcão,
    // nenhum aviso volta ao motorista.
    if (sombra) {
      const m = {
        BATE: ["SOMBRA · CONFERE", "Confere", "O agente decidiria: ticket confere (modo sombra, nada mudou)"],
        DIVERGE: ["SOMBRA · DIVERGE", "Diverge", "O agente decidiria: ticket diverge do lançamento (modo sombra, nada mudou)"],
        INCERTO: ["SOMBRA · DÚVIDA", "Dúvida", "O agente decidiria: ficar em dúvida e chamar alguém (modo sombra, nada mudou)"],
        ILEGIVEL: ["SOMBRA · ILEGÍVEL", "Ilegível", "O agente decidiria: pedir outra foto (modo sombra, nada mudou)"],
        NAO_APLICAVEL: ["SOMBRA · SEM TICKET", "Sem ticket", "O agente não teria o que conferir (modo sombra, nada mudou)"],
      }[v.veredito] as [string, string, string];
      return { kind: "SOM", texto: m[1], tom: "neu", aviso: false, sem: v.veredito === "NAO_APLICAVEL", carimbo: m[0], logNeu: m[2] };
    }
    // Pediu algo ao motorista (divergência, foto nova, pedágio): a viagem VOLTA pro celular dele.
    const avisou = acao === "AVISOU_MOTORISTA" || acao === "PEDIU_FOTO" || acao === "PEDIU_PEDAGIO";
    if (v.veredito === "NAO_APLICAVEL") {
      // No código da API a viagem NÃO é aprovada (acao NENHUMA): só sai da fila de revisão e
      // segue a conferência normal. Por isso o carimbo é neutro e nada soma em "validadas".
      return { kind: "NEU", texto: "Sem ticket", tom: "ok", aviso: false, sem: true, carimbo: "SEM TICKET", logNeu: "Sem ticket pra conferir: a viagem não foi aprovada, segue a conferência normal" };
    }
    if (avisou) {
      const texto = acao === "PEDIU_FOTO" || v.veredito === "ILEGIVEL" ? "Foto ilegível" : acao === "PEDIU_PEDAGIO" ? "Falta pedágio" : "Diverge";
      return { kind: "DIV", texto, tom: "no", aviso: true, sem: false };
    }
    if (v.veredito === "BATE") {
      if (acao === "APROVOU") return { kind: "OK", texto: "Confere", tom: "ok", aviso: false, sem: false };
      return { kind: "NEU", texto: "Confere", tom: "ok", aviso: false, sem: false, carimbo: "CONFERE", logNeu: "Ticket confere, mas a viagem não foi aprovada sozinha: segue a conferência normal" };
    }
    if (v.veredito === "DIVERGE" && acao !== "FILA_REVISAO") return { kind: "DIV", texto: "Diverge", tom: "no", aviso: false, sem: false };
    return { kind: "TRAV", texto: v.veredito === "ILEGIVEL" ? "Foto ilegível" : "Em dúvida", tom: "wait", aviso: false, sem: false };
  }
  function limitar(set: Set<string>): void {
    while (set.size > 400) {
      const primeiro = set.values().next().value;
      if (primeiro === undefined) break;
      set.delete(primeiro);
    }
  }
  function aplicarNumeros(s: EscritorioSnapshot): void {
    st.fila = s.contagens.fila;
    st.val = s.contagens.validadas24h;
    st.dev = s.contagens.devolvidas;
    st.aj = s.contagens.ajustadas;
    st.trav = s.contagens.travadas;
    S.ageBase = s.travadaMaisAntigaMin; // null = idade desconhecida (mostra "—")
    S.ageEm = performance.now();
    st.age = st.trav > 0 ? S.ageBase : 0;
  }
  function ingerir(s: EscritorioSnapshot): void {
    // snapshot mais antigo que o último aplicado não volta o tempo
    const gerado = Date.parse(s.geradoEm);
    if (!Number.isNaN(gerado)) {
      if (gerado < S.ultimoGerado) return;
      S.ultimoGerado = gerado;
    }
    const antes = S.antes ? { ...S.antes } : null;
    aplicarNumeros(s);
    S.antes = { ...st };
    const novosCh = s.chegadas.filter((c) => !S.vistosCh.has(c.id));
    const novosVe = s.veredictos.filter((v) => !S.vistosVe.has(v.id)).sort((a, b) => a.em.localeCompare(b.em));
    s.chegadas.forEach((c) => S.vistosCh.add(c.id));
    s.veredictos.forEach((v) => S.vistosVe.add(v.id));
    limitar(S.vistosCh);
    limitar(S.vistosVe);
    S.sujo = true;
    // Primeira carga: só preenche os números, nunca reanima o histórico.
    if (S.primeira) {
      S.primeira = false;
      return;
    }
    // Sem movimento (preferência do sistema): os números já mudaram, e basta.
    if (reduce) return;
    const agora = Date.now();
    const recente = (em: string): boolean => {
      const t = Date.parse(em);
      return !Number.isNaN(t) && agora - t <= JANELA_CHEGADA_MS; // data ilegível: não anima
    };
    let descartadas = 0;
    novosCh
      .filter((c) => recente(c.em))
      .sort((a, b) => a.em.localeCompare(b.em))
      .forEach((c) => {
        if (S.chQ.length >= MAX_CHEGADAS_FILA) {
          descartadas++;
          return;
        }
        S.chQ.push({ id: c.id, emIso: c.em, emMs: Date.parse(c.em), motorista: c.motorista, aj: false, fromQ: false, tc: T_INI_CHEG, fired: {}, skip: null, pousou: false, entrou: S.wall });
      });
    if (descartadas > 0) log(`${descartadas} chegadas sem reprodução (fila cheia)`, "info", "•");
    const nRec = novosCh.filter((c) => recente(c.em)).length;
    if (nRec >= 3) log(`${nRec} viagens chegaram juntas: reprodução acelerada`, "info", "•");
    // vereditos novos: comprimem (acelera e agrupa com +N), nunca somem em silêncio
    const sombra = s.robo.modoSombra;
    let cortados = 0;
    const veRec = novosVe.filter((v) => recente(v.em));
    veRec.forEach((v) => {
      if (S.veQ.length >= MAX_VEREDITOS_FILA) {
        cortados++;
        return;
      }
      const m = veredictoParaKind(v, sombra);
      S.veQ.push(
        novoVer({ emIso: v.em, kind: m.kind, seg2: m.kind === "SOM" ? false : v.segundaLeitura, aviso: m.aviso, sem: m.sem, texto: m.texto, tom: m.tom, carimbo: m.carimbo, logNeu: m.logNeu, demo: false }, st.trav),
      );
    });
    if (cortados > 0) log(`Mais ${cortados} conferências terminaram: os números já estão atualizados, só não reproduzi cada uma`, "info", "•");
    if (veRec.length >= 3) log(`${veRec.length} conferências terminaram juntas: reprodução acelerada`, "info", "•");
    // O balcão só tem saldo: não dá pra saber quem resolveu nem pra onde foi o papel. Só um aviso neutro.
    if (antes && antes.trav > st.trav) log(`O saldo do balcão caiu em ${antes.trav - st.trav}`, "info", "•");
  }

  /* ---------- relógio e laço ---------- */
  const fator = (b: number): number => (b <= 0 ? 1 : b === 1 ? 1.3 : b <= 3 ? 1.6 : 2);
  function avancar(dt: number): void {
    S.wall += dt;
    const live = !demo();
    const dtc = dt * (demo() ? S.vel : 1);
    if (demo()) {
      st.age = (st.age ?? 0) + (dtc / 60) * 240; // relógio acelerado (4 min por segundo)
      if (st.trav <= 0) st.age = 0;
    } else if (st.trav > 0 && S.ageBase !== null && !S.defasado) st.age = S.ageBase + (performance.now() - S.ageEm) / 60000;
    // chegada ativa
    if (live && !S.ch && S.chQ.length > 0) {
      // chegada que esperou demais na fila de reprodução já é história: só conta, não anima
      let velhas = 0;
      while (S.chQ.length > 0 && Date.now() - (S.chQ[0] as Cheg).emMs > 3 * 60_000) {
        S.chQ.shift();
        velhas++;
      }
      if (velhas > 0) log(`${velhas} chegadas sem reprodução`, "info", "•");
    }
    if (live && !S.ch && S.chQ.length > 0) {
      const prox = S.chQ.shift() as Cheg;
      prox.fromQ = S.chQ.length > 0 || S.wall - prox.entrou > 1.5;
      S.ch = prox;
      S.monteBase = S.monteV;
    }
    if (S.ch) {
      S.ch.tc += dtc * (live ? fator(S.chQ.length) : 1);
      const fim = S.ch.aj ? 4.2 : T_FIM_CHEG;
      if (S.ch.tc >= fim) S.ch = null;
    }
    // demo: o veredito entra quando o papel pousa
    if (demo() && S.demoVer && S.ch && S.ch.tc >= T_POUSO) {
      S.demoVer.u = S.ch.tc - T_POUSO;
      S.veQ.push(S.demoVer);
      S.demoVer = null;
    } else if (demo() && S.demoVer && !S.ch) {
      S.veQ.push(S.demoVer);
      S.demoVer = null;
    }
    // veredito ativo: um por vez
    if (S.ve) {
      S.ve.u += dtc * (live ? fator(S.veQ.length) : 1);
      if (S.ve.u > S.ve.scr.tEnd) S.ve = null;
    }
    if (!S.ve && S.veQ.length > 0) {
      const prox = S.veQ.shift() as Ver;
      prox.scr = construirRoteiro({ kind: prox.kind, seg2: prox.seg2, sem: prox.sem, hum: prox.hum, soHum: prox.soHum, humDest: prox.humDest, nTrav: st.trav });
      S.ve = prox;
    }
    // ambiente: retroescavadeira (só sem chegada) e caminhão-figurante, nunca na vaga
    if (!S.ch) {
      if (S.retroT0 < 0 && S.wall >= S.retroProx) S.retroT0 = S.wall;
    }
    if (S.retroT0 >= 0 && (S.wall - S.retroT0) / 5 >= 1) {
      S.retroT0 = -99;
      S.retroProx = S.wall + 22 + Math.random() * 6;
      S.monteV = Math.max(0.3, S.monteV - 0.14);
    }
    if (S.figT0 < 0 && S.wall >= S.figProx) S.figT0 = S.wall;
    if (S.figT0 >= 0 && S.wall - S.figT0 >= 10) {
      S.figT0 = -99;
      S.figProx = S.wall + 18 + Math.random() * 17;
    }
    // demo: ciclo contínuo
    if (demo() && !S.ch && !S.ve && S.veQ.length === 0 && !S.demoVer) iniciarCicloDemo();
  }
  function eventosDoQuadro(): void {
    if (S.ch) eventosChegada(S.ch);
    if (S.ve) eventosVer(S.ve);
  }
  function loop(now: number): void {
    const dt = Math.min(0.1, (now - ultimoTick) / 1000);
    ultimoTick = now;
    if (!document.hidden) {
      const anda = !S.pausado;
      if (anda) avancar(dt);
      eventosDoQuadro();
      // em repouso (só ambiente) ~30 fps; durante a coreografia, 60
      const repouso = !demo() && !S.ch && !S.ve && S.chQ.length === 0 && S.veQ.length === 0;
      if ((anda || S.sujo) && (S.sujo || !repouso || now - ultimoDesenho >= 30)) {
        frame();
        S.sujo = false;
        ultimoDesenho = now;
      }
      notificar();
    }
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- resolução ---------- */
  let rzTimer = 0;
  function refazerCamadas(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth || LARGURA;
    const scl = Math.max(0.5, Math.min(2, (cw / LARGURA) * dpr));
    if (SCL && Math.abs(scl - SCL) < 0.06) return;
    SCL = scl;
    canvas.width = Math.round(LARGURA * SCL);
    canvas.height = Math.round(ALTURA * SCL);
    const c = D.camadas(SCL);
    s0 = c.s0;
    s1 = c.s1;
    S.sujo = true;
  }
  refazerCamadas();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    window.clearTimeout(rzTimer);
    rzTimer = window.setTimeout(refazerCamadas, 120);
  }) : null;
  ro?.observe(canvas);

  /* ---------- API pública ---------- */
  function limparEntidades(): void {
    S.ch = null;
    S.chQ = [];
    S.ve = null;
    S.veQ = [];
    S.demoVer = null;
    S.neuEm = [];
  }
  function resetarVivo(): void {
    limparEntidades();
    S.vistosCh = new Set();
    S.vistosVe = new Set();
    S.primeira = true;
    S.antes = null;
    S.ultimoGerado = 0;
  }
  function resetarDemo(): void {
    limparEntidades();
    Object.assign(st, DEMO_INICIAL);
    S.seqI = 0;
    S.nomeI = 0;
    S.monteV = 0.55;
    iniciarCicloDemo();
    // movimento reduzido: poses estáticas no meio da descarga, sem logar o que "já passou"
    if (reduce && S.ch) {
      S.ch.tc = -2.4;
      S.ch.skip = -2.4;
    }
  }
  // arranque: reduzir movimento começa pausada
  if (reduce) S.pausado = true;
  rafId = requestAnimationFrame(loop);

  return {
    setModo(m) {
      if (S.modo === m) return;
      S.modo = m;
      S.sujo = true;
      if (m === "demo") resetarDemo();
      else {
        limparEntidades();
        Object.assign(st, { fila: 0, val: 0, dev: 0, aj: 0, trav: 0, age: 0 });
        resetarVivo();
        if (S.snap) ingerir(S.snap);
      }
      ultimoEnviado = "";
      notificar();
    },
    setSnapshot(s) {
      if (s && S.modo === "vivo" && Date.parse(s.geradoEm) < S.ultimoGerado) return; // mais antigo que o último
      S.snap = s;
      if (S.modo === "vivo" && s) ingerir(s);
      S.sujo = true;
    },
    setCaso(c) {
      S.forcado = c;
      if (S.modo === "demo" && c) {
        limparEntidades();
        iniciarCicloDemo(c);
        S.pausado = false;
        S.sujo = true;
      }
    },
    setPausado(p) {
      S.pausado = p;
      S.sujo = true;
    },
    setDefasado(d) {
      S.defasado = d;
    },
    setVelocidade(v) {
      S.vel = v;
    },
    destruir() {
      cancelAnimationFrame(rafId);
      window.clearTimeout(rzTimer);
      ro?.disconnect();
    },
  };
}
