/**
 * A cena isométrica do Escritório de Agentes: desenho em canvas, sem dependência.
 *
 * Dois modos, a MESMA arte:
 *  - "vivo": os números vêm do snapshot da API e a cena só anima fatos reais
 *    (uma viagem que chegou, uma conferência que terminou). Nada é inventado:
 *    o cartão do agente mostra "lendo o ticket…" e o veredito de verdade.
 *  - "demo": o ciclo fictício de 22 s, com valores de exemplo.
 *
 * Duas linhas do tempo independentes alimentam o desenho:
 *  - a CHEGADA (celular → torre → servidor → cabo → mesa de entrada), uma por
 *    viagem que chegou, no relógio local `ta` (3,0 → 9,0);
 *  - o VEREDITO (agente pega o papel, lê, carimba, leva ao destino), um por vez,
 *    no relógio local `tv` (8,9 → fim).
 * No demo as duas andam juntas no mesmo `t`; ao vivo cada fato tem o seu relógio.
 */
import type { EscritorioSnapshot } from "@ronan/shared-types";

export const LARGURA = 1190;
export const ALTURA = 720;
const OX = 492;
const OY = 132;
const GW = 22;
const GD = 15;
const K = 1.25;

export type Caso = "OK" | "DIV" | "AJ" | "TRAV" | "HUM";
export type Modo = "vivo" | "demo";
export type TomLog = "ok" | "no" | "wait" | "info";

export interface Numeros {
  fila: number;
  val: number;
  dev: number;
  aj: number;
  trav: number;
  /** Minutos parada a travada mais antiga (0 quando não há travada). */
  age: number;
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
  destruir(): void;
}

type Pt = [number, number];
type Pt3 = [number, number, number];
type Kind = "OK" | "DIV" | "AJ" | "TRAV";
type Dir = "px" | "py" | "mx" | "my";
type Braco = "up" | "front" | null | undefined;

/** Posição na cena (em tiles) → % do canvas, pros rótulos em HTML por cima. */
export function pctNaCena(x: number, y: number, z = 0): { left: number; top: number } {
  const px = OX + (x - y) * 24 * K;
  const py = OY + (x + y) * 12 * K - z * K;
  return { left: (px / LARGURA) * 100, top: (py / ALTURA) * 100 };
}

export const ROTULOS: {
  texto: string;
  x: number;
  y: number;
  z: number;
  tom: "" | "f" | "v" | "d" | "a";
  opc?: boolean;
  chave?: keyof Numeros;
}[] = [
  { texto: "Ponto de descarga", x: 3.5, y: 14.4, z: 0, tom: "", opc: true },
  { texto: "Torre de celular", x: 7.9, y: 6.5, z: 125, tom: "", opc: true },
  { texto: "Mesa de entrada", x: 10.6, y: 3.0, z: 8, tom: "f", chave: "fila" },
  { texto: "Validadas", x: 19.9, y: 2.8, z: 4, tom: "v", chave: "val" },
  { texto: "Devolvidas pra conferir", x: 20.5, y: 8.9, z: 0, tom: "d", chave: "dev" },
  { texto: "Ajustadas", x: 20.5, y: 12.2, z: 0, tom: "a", chave: "aj" },
];

const C = {
  g0: "#0E1526", g1: "#1B2540", g2: "#2C3A63", az: "#2A4A9E", azl: "#5B8AE8", cz: "#A6B3D2", pp: "#EEF1F8",
  lj: "#DF7234", ljd: "#B4501A", am: "#F2B53F", vd: "#27A06A", vdl: "#7ED9A6", vm: "#E05A4E",
  pa: "#F0C7A0", pb: "#C98F63", pc: "#8A5A3A", md: "#9A6B43", bk: "#07090F",
};

const CABO: Pt3[] = [[6.7, 3.8, 0], [6.7, 5.0, 0], [10.3, 5.0, 0], [10.9, 5.0, 4], [10.9, 5.0, 26]];
const T = 22;
const SEQ: Caso[] = ["OK", "DIV", "AJ", "OK", "TRAV", "OK", "TRAV", "HUM"];
const HOME1: Pt = [13.9, 9.0];
const HOME2: Pt = [13.9, 12.2];
const INBOX: Pt = [12.8, 5.0];
const DRV: Pt = [5.8, 10.6];
const MAX_CHEGADAS = 3;
const MAX_FILA_VEREDITOS = 3;

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const easeOut = (u: number): number => 1 - Math.pow(1 - u, 3);
const seg = (t: number, a: number, b: number): number => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));

/** Chegada de uma viagem: a perna celular → mesa. */
interface Chegada {
  id: string;
  /** Instante (relógio da cena) em que começou. */
  inicio: number;
  slot: number;
  aj: boolean;
  fired: Record<string, boolean>;
}
/** O que o agente está fazendo com um papel. */
interface Veredito {
  id: string;
  inicio: number;
  kind: Kind;
  /** Houve 2ª leitura (o conferente entra em cena). */
  seg2: boolean;
  /** O motorista foi avisado (volta o sinal pro celular dele). */
  aviso: boolean;
  hum: boolean;
  texto: string;
  tom: "ok" | "no" | "wait";
  fired: Record<string, boolean>;
}
interface VView extends Veredito {
  tv: number;
}
interface PoseHumano {
  x: number;
  y: number;
  dir: Dir;
  walk?: boolean;
  arm?: Braco;
  seat?: boolean;
}
interface OpcHumano extends PoseHumano {
  t: number;
  shirt: string;
  skin: string;
  hair: string;
  badge?: boolean;
  cap?: boolean;
}

export function criarCena(canvas: HTMLCanvasElement, cb: CenaCallbacks, reduzirMovimento: boolean): Cena {
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = LARGURA * DPR;
  canvas.height = ALTURA * DPR;
  const ctxOuNulo = canvas.getContext("2d");
  if (!ctxOuNulo) throw new Error("canvas 2d indisponível");
  const ctx: CanvasRenderingContext2D = ctxOuNulo;
  const bgc = document.createElement("canvas");
  bgc.width = LARGURA * DPR;
  bgc.height = ALTURA * DPR;
  const bgx = bgc.getContext("2d");
  if (!bgx) throw new Error("canvas 2d indisponível");
  let g: CanvasRenderingContext2D = ctx;
  let ZK = 1;
  const reduce = reduzirMovimento;

  /* ---------- projeção isométrica ---------- */
  const P = (x: number, y: number, z = 0): Pt => [OX + (x - y) * 24 * K, OY + (x + y) * 12 * K - z * K * ZK];
  const shc: Record<string, string> = {};
  function sh(hex: string, f: number): string {
    const k = hex + f;
    const hit = shc[k];
    if (hit) return hit;
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round((n >> 16) * f));
    const gg = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return (shc[k] = `rgb(${r},${gg},${b})`);
  }
  function poly(pts: Pt[], fill: string | null, stroke?: string | null, lw?: number): void {
    const first = pts[0];
    if (!first) return;
    g.beginPath();
    g.moveTo(first[0], first[1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i] as Pt;
      g.lineTo(p[0], p[1]);
    }
    g.closePath();
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = lw ?? 0.7;
      g.stroke();
    }
  }
  function box(x: number, y: number, z: number, w: number, d: number, h: number, col: string, o?: { lift?: number; a?: number; edge?: string }): void {
    const lf = o?.lift ?? 0;
    const x1 = x + w;
    const y1 = y + d;
    const zt = z + h;
    const L = [P(x, y1, z + lf), P(x1, y1, z + lf), P(x1, y1, zt + lf), P(x, y1, zt + lf)];
    const Rr = [P(x1, y, z), P(x1, y1, z + lf), P(x1, y1, zt + lf), P(x1, y, zt)];
    const Tp = [P(x, y, zt), P(x1, y, zt), P(x1, y1, zt + lf), P(x, y1, zt + lf)];
    const ed = o?.edge === undefined ? "rgba(5,8,20,.22)" : o.edge;
    if (o?.a !== undefined) g.globalAlpha = o.a;
    poly(L, sh(col, 0.92), ed);
    poly(Rr, sh(col, 0.66), ed);
    poly(Tp, sh(col, 1.14), ed);
    if (o?.a !== undefined) g.globalAlpha = 1;
  }
  function glow(p: Pt, r: number, col: string, a?: number): void {
    const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = a === undefined ? 1 : a;
    g.fillStyle = gr;
    g.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
    g.restore();
  }
  function shadowFoot(x: number, y: number, w: number, d: number, off: number): void {
    poly([P(x + off * 0.5, y + off * 0.5, 0), P(x + w + off, y + off * 0.5, 0), P(x + w + off, y + d + off, 0), P(x + off * 0.5, y + d + off, 0)], "rgba(4,7,18,.30)");
  }
  function faceText(face: "x" | "y", x: number, y: number, z: number, text: string, px: number, col: string, weight?: number): void {
    const p = P(x, y, z);
    g.save();
    g.translate(p[0], p[1]);
    if (face === "y") g.transform(1, 0.5, 0, 1, 0, 0);
    else g.transform(1, -0.5, 0, 1, 0, 0);
    g.font = `${weight ?? 600} ${px * K}px Archivo, system-ui, sans-serif`;
    g.fillStyle = col;
    g.textBaseline = "alphabetic";
    g.fillText(text, 0, 0);
    g.restore();
  }
  function faceRect(face: "x" | "y", a0: number, a1: number, fixed: number, z0: number, z1: number, col: string, stroke?: string): void {
    const pts: Pt[] =
      face === "y"
        ? [P(a0, fixed, z0), P(a1, fixed, z0), P(a1, fixed, z1), P(a0, fixed, z1)]
        : [P(fixed, a0, z0), P(fixed, a1, z0), P(fixed, a1, z1), P(fixed, a0, z1)];
    poly(pts, col, stroke);
  }
  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function ellipse(p: Pt, rx: number, ry: number, fill: string): void {
    g.beginPath();
    g.ellipse(p[0], p[1], rx, ry, 0, 0, 6.2832);
    g.fillStyle = fill;
    g.fill();
  }

  /* ---------- fundo estático ---------- */
  function fundo(): void {
    g = bgx as CanvasRenderingContext2D;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    const gr = g.createLinearGradient(0, 0, 0, ALTURA);
    gr.addColorStop(0, "#0F1730");
    gr.addColorStop(1, "#070B17");
    g.fillStyle = gr;
    g.fillRect(0, 0, LARGURA, ALTURA);
    poly([P(0, GD, 0), P(GW, GD, 0), P(GW, GD, -18), P(0, GD, -18)], "#0B1226");
    poly([P(GW, 0, 0), P(GW, GD, 0), P(GW, GD, -18), P(GW, 0, -18)], "#080D1D");
    poly([P(0, GD, 0), P(GW, GD, 0), P(GW, GD, -4), P(0, GD, -4)], "#243158");
    for (let i = 0; i < GW; i++) {
      for (let j = 0; j < GD; j++) {
        let col: string;
        if (i < 8) {
          if (i >= 2 && i <= 4) col = (i + j) % 2 ? "#273259" : "#29345C";
          else col = (i + j) % 2 ? "#3A4A78" : "#364573";
          if (i === 1 || i === 5) col = "#42527F";
        } else col = (i + j) % 2 ? "#3C4D7B" : "#364675";
        poly([P(i, j, 0), P(i + 1, j, 0), P(i + 1, j + 1, 0), P(i, j + 1, 0)], col, "rgba(255,255,255,.035)", 0.6);
      }
    }
    poly([P(2, GD, 0), P(5, GD, 0), P(5, 21, 0), P(2, 21, 0)], "#232D4E");
    poly([P(2, -6, 0), P(5, -6, 0), P(5, 0, 0), P(2, 0, 0)], "#232D4E");
    for (let k = -3; k < 10; k++) poly([P(3.45, k * 2 + 0.4, 0), P(3.55, k * 2 + 0.4, 0), P(3.55, k * 2 + 1.3, 0), P(3.45, k * 2 + 1.3, 0)], "#A6B3D2");
    poly([P(2, -6, 0), P(2.08, -6, 0), P(2.08, 21, 0), P(2, 21, 0)], "#EEF1F8");
    poly([P(4.92, -6, 0), P(5, -6, 0), P(5, 21, 0), P(4.92, 21, 0)], "#EEF1F8");
    poly([P(12.2, 6.2, 0), P(18.6, 6.2, 0), P(18.6, 13.8, 0), P(12.2, 13.8, 0)], "#22305C");
    poly([P(12.4, 6.4, 0), P(18.4, 6.4, 0), P(18.4, 13.6, 0), P(12.4, 13.6, 0)], null, "rgba(223,114,52,.6)", 1.6);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    CABO.forEach((c, i) => {
      const q = P(c[0], c[1], c[2]);
      if (i) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
    });
    g.strokeStyle = "#070B17";
    g.lineWidth = 5;
    g.stroke();
    g.strokeStyle = "#2A4A9E";
    g.lineWidth = 2;
    g.stroke();
    box(8, -0.4, 0, GW - 8, 0.4, 96, "#1E2A4D", { edge: "rgba(5,8,20,.3)" });
    faceRect("y", 8, GW, 0, 0, 10, "#141C36");
    faceRect("y", 8, GW, 0, 10, 11, "rgba(223,114,52,.8)");
    const wins: [number, number][] = [[8.6, 9.9]];
    wins.forEach((w) => {
      faceRect("y", w[0], w[1], 0, 40, 84, "#35508F", "rgba(255,255,255,.25)");
      faceRect("y", w[0] + 0.08, w[1] - 0.08, 0, 44, 80, "#5B8AE8");
      faceRect("y", (w[0] + w[1]) / 2 - 0.02, (w[0] + w[1]) / 2 + 0.02, 0, 40, 84, "#35508F");
    });
    poly([P(8.6, 0.2, 0), P(9.9, 0.2, 0), P(10.9, 3.6, 0), P(9.4, 3.6, 0)], "rgba(120,160,255,.08)");
    poly([P(19.9, 0.2, 0), P(21.6, 0.2, 0), P(22, 3.6, 0), P(20.4, 3.6, 0)], "rgba(120,160,255,.08)");
    const sombras: [number, number, number, number, number][] = [
      [10, 4.2, 2.2, 1.6, 0.3], [14.6, 8.2, 2, 1.6, 0.3], [14.6, 11.4, 2, 1.6, 0.3], [18.4, 0.3, 3, 1.2, 0.5],
      [19.6, 6.8, 2, 1.4, 0.3], [19.6, 10.2, 2, 1.4, 0.3], [10.2, 12.0, 3, 1.3, 0.4], [8.8, 8.6, 1.0, 1.0, 0.4],
      [17.5, 13.2, 3.2, 1.4, 0.4], [5.5, 0.6, 2.4, 3.0, 0.8], [2.85, 7.2, 1.3, 4.3, 0.5],
    ];
    sombras.forEach((s) => shadowFoot(s[0], s[1], s[2], s[3], s[4]));
    g = ctx;
  }

  /* ---------- pessoas ---------- */
  function human(o: OpcHumano): void {
    ZK = 1.22;
    humanBody(o);
    ZK = 1;
  }
  function humanBody(o: OpcHumano): void {
    const { x, y, dir } = o;
    const ax = dir === "px" || dir === "mx";
    const fx = dir === "px" ? 1 : dir === "mx" ? -1 : 0;
    const fy = dir === "py" ? 1 : dir === "my" ? -1 : 0;
    const sw = o.walk ? Math.sin(o.t * 10) : 0;
    let bob = o.walk ? Math.abs(sw) * 1.6 : 0;
    if (o.seat) bob = 0;
    ellipse(P(x, y, 0), 11, 5, "rgba(4,7,18,.38)");
    const lo = 0.07;
    const l1: Pt = ax ? [x + fx * sw * 0.12 - 0.045, y - lo - 0.045] : [x - lo - 0.045, y + fy * sw * 0.12 - 0.045];
    const l2: Pt = ax ? [x - fx * sw * 0.12 - 0.045, y + lo - 0.045] : [x + lo - 0.045, y - fy * sw * 0.12 - 0.045];
    [l1, l2].sort((a, b) => a[0] + a[1] - (b[0] + b[1])).forEach((l) => {
      box(l[0], l[1], 0, 0.09, 0.09, 11, "#232F58");
      box(l[0] - 0.01, l[1] - 0.01, 0, 0.11, 0.11, 3, C.bk);
    });
    const tw = ax ? 0.14 : 0.27;
    const td = ax ? 0.27 : 0.14;
    box(x - tw / 2, y - td / 2, 11 + bob, tw, td, 14, o.shirt);
    const arm = o.arm;
    const arm1 = (side: number): void => {
      const ox = ax ? 0 : side * (tw / 2 + 0.035);
      const oy = ax ? side * (td / 2 + 0.035) : 0;
      const up = arm === "up" && side === 1;
      const front = arm === "front" && side === 1;
      if (up) {
        box(x + ox - 0.035, y + oy - 0.035, 15 + bob, 0.07, 0.07, 16, o.shirt);
        box(x + ox - 0.04, y + oy - 0.04, 29 + bob, 0.08, 0.08, 3, o.skin);
      } else if (front) {
        box(x + ox - 0.035 + fx * 0.09, y + oy - 0.035 + fy * 0.09, 17 + bob, 0.07 + Math.abs(fx) * 0.16, 0.07 + Math.abs(fy) * 0.16, 4, o.shirt);
        box(x + ox - 0.04 + fx * 0.26, y + oy - 0.04 + fy * 0.26, 17 + bob, 0.08, 0.08, 4, o.skin);
      } else box(x + ox - 0.035, y + oy - 0.035, 13 + bob, 0.07, 0.07, 12, o.shirt);
    };
    [-1, 1].sort((a, b) => (ax ? a - b : b - a)).forEach(arm1);
    if (o.badge) {
      const bp = ax ? P(x + fx * (tw / 2 + 0.01), y + 0.05, 20 + bob) : P(x + 0.05, y + fy * (td / 2 + 0.01), 20 + bob);
      if (fx > 0 || fy > 0) {
        g.fillStyle = C.lj;
        g.fillRect(bp[0] - 1.5, bp[1] - 1.5, 3.5, 3.5);
      }
    }
    box(x - 0.1, y - 0.1, 25 + bob, 0.2, 0.2, 9, o.skin);
    box(x - 0.108, y - 0.108, 31 + bob, 0.216, 0.216, 4.5, o.hair);
    if (o.cap) {
      box(x - 0.112, y - 0.112, 32 + bob, 0.224, 0.224, 3, C.lj);
      box(x + fx * 0.12 - 0.08, y + fy * 0.12 - 0.08, 32 + bob, 0.16, 0.16, 1.2, C.ljd);
    }
    g.fillStyle = C.bk;
    if (fx > 0) {
      const e1 = P(x + 0.1, y - 0.05, 28.5 + bob);
      const e2 = P(x + 0.1, y + 0.05, 28.5 + bob);
      g.fillRect(e1[0] - 1, e1[1] - 1, 2, 2.4);
      g.fillRect(e2[0] - 1, e2[1] - 1, 2, 2.4);
    }
    if (fy > 0) {
      const f1 = P(x - 0.05, y + 0.1, 28.5 + bob);
      const f2 = P(x + 0.05, y + 0.1, 28.5 + bob);
      g.fillRect(f1[0] - 1, f1[1] - 1, 2, 2.4);
      g.fillRect(f2[0] - 1, f2[1] - 1, 2, 2.4);
    }
  }
  function tag(x: number, y: number, z: number, txt: string, col: string): void {
    const p = P(x, y, z);
    g.font = "600 10px Archivo, system-ui, sans-serif";
    const w = g.measureText(txt).width + 12;
    g.fillStyle = "rgba(10,15,30,.9)";
    roundRect(p[0] - w / 2, p[1] - 8, w, 15, 4);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#EEF1F8";
    g.textAlign = "center";
    g.fillText(txt, p[0], p[1] + 3);
    g.textAlign = "left";
  }

  /* ---------- objetos ---------- */
  function mesa(x: number, y: number, w: number, d: number, col?: string): void {
    ([[x + 0.08, y + 0.08], [x + w - 0.2, y + 0.08], [x + 0.08, y + d - 0.2], [x + w - 0.2, y + d - 0.2]] as Pt[]).forEach((l) => box(l[0], l[1], 0, 0.12, 0.12, 10, "#3a2a22"));
    box(x, y, 10, w, d, 4, col ?? C.md);
  }
  function papelChato(x: number, y: number, z: number, col?: string, a?: number): void {
    box(x - 0.15, y - 0.19, z, 0.3, 0.38, 1.4, col ?? C.pp, { a });
  }
  function degrausDaPilha(n: number): number {
    return n <= 0 ? 0 : n <= 5 ? n : n <= 20 ? 5 + Math.round((n - 5) / 3) : Math.min(14, 10 + Math.round((Math.log(n / 20) / Math.LN2) * 1.5));
  }
  function pilha(n: number, px: number, py: number, pz: number): number {
    const h = degrausDaPilha(n);
    for (let i = 0; i < h; i++) papelChato(px + (((i * 7) % 3) - 1) * 0.015, py + (((i * 5) % 3) - 1) * 0.015, pz + i * 1.6, i % 2 ? C.pp : "#d4dbeb");
    if (n > 20) for (let k = 0; k < Math.floor(h / 2); k++) papelChato(px + 0.42 + ((k * 3) % 2) * 0.02, py + 0.12, pz + k * 1.6, k % 2 ? C.pp : "#d4dbeb");
    return pz + h * 1.6;
  }
  function monitor(x: number, y: number, on: boolean, glowOn?: string): void {
    box(x - 0.02, y - 0.05, 14, 0.08, 0.1, 3, C.g0);
    box(x - 0.07, y - 0.42, 17, 0.07, 0.84, 15, "#0b1226");
    if (on) glow(P(x - 0.035, y, 26), 36, glowOn ?? "rgba(91,138,232,.55)", 0.7);
  }
  function relogioPino(x: number, y: number, z: number, nivel: number, tm: number): void {
    const rim = [C.vd, C.am, C.lj, C.vm][nivel] ?? C.vd;
    const p = P(x, y, z);
    ellipse([p[0], p[1] + 14], 8, 3, "rgba(4,7,18,.3)");
    g.fillStyle = "#10182f";
    g.fillRect(p[0] - 1.5, p[1] + 8, 3, 8);
    g.beginPath();
    g.arc(p[0], p[1], 13, 0, 6.2832);
    g.fillStyle = rim;
    g.fill();
    g.beginPath();
    g.arc(p[0], p[1], 10.5, 0, 6.2832);
    g.fillStyle = "#EEF1F8";
    g.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.2832;
      g.fillStyle = "#10182f";
      g.fillRect(p[0] + Math.sin(a) * 8.5 - 0.6, p[1] - Math.cos(a) * 8.5 - 0.6, 1.2, 1.2);
    }
    const ang = tm * (nivel > 0 ? 1.4 : 0.5);
    g.strokeStyle = "#10182f";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + Math.sin(ang) * 8, p[1] - Math.cos(ang) * 8);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + Math.sin(ang / 12) * 5, p[1] - Math.cos(ang / 12) * 5);
    g.stroke();
    if (nivel >= 1) glow(p, 26, nivel === 3 ? "rgba(224,90,78,.55)" : nivel === 2 ? "rgba(223,114,52,.4)" : "rgba(242,181,63,.3)", 0.8);
  }
  function planta(x: number, y: number): void {
    box(x - 0.18, y - 0.18, 0, 0.36, 0.36, 10, C.ljd);
    box(x - 0.06, y - 0.06, 10, 0.12, 0.12, 8, "#1f7a4f");
    box(x - 0.22, y - 0.22, 17, 0.44, 0.44, 8, C.vd);
    box(x - 0.15, y - 0.15, 24, 0.3, 0.3, 7, C.vdl);
    box(x - 0.3, y - 0.1, 15, 0.18, 0.2, 6, C.vd);
    box(x + 0.12, y - 0.12, 14, 0.2, 0.2, 6, C.vd);
  }
  function arvore(x: number, y: number): void {
    box(x - 0.1, y - 0.1, 0, 0.2, 0.2, 22, "#5a3a22");
    box(x - 0.5, y - 0.5, 16, 1, 1, 12, "#1f7a4f");
    box(x - 0.38, y - 0.38, 28, 0.76, 0.76, 10, C.vd);
    box(x - 0.22, y - 0.22, 38, 0.44, 0.44, 7, C.vdl);
  }
  function posteLuz(x: number, y: number): void {
    box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 56, "#10182f");
    box(x - 0.2, y - 0.05, 56, 0.3, 0.1, 3, "#10182f");
    const p = P(x - 0.15, y, 54);
    glow(p, 52, "rgba(242,181,63,.55)", 0.8);
    g.fillStyle = "#ffe8a8";
    g.fillRect(p[0] - 3, p[1] - 1, 6, 3);
  }
  function coneTrafego(x: number, y: number): void {
    box(x - 0.12, y - 0.12, 0, 0.24, 0.24, 2, "#10182f");
    box(x - 0.08, y - 0.08, 2, 0.16, 0.16, 10, C.lj);
    box(x - 0.05, y - 0.05, 8, 0.1, 0.1, 2, C.pp);
  }
  function torre(tm: number, flash: boolean): void {
    const bx = 6.2;
    const by = 6.5;
    const tp = 150;
    const hw = 0.34;
    const cs: Pt[] = [[bx - hw, by - hw], [bx + hw, by - hw], [bx + hw, by + hw], [bx - hw, by + hw]];
    const topc: Pt[] = [[bx - 0.05, by - 0.05], [bx + 0.05, by - 0.05], [bx + 0.05, by + 0.05], [bx - 0.05, by + 0.05]];
    g.strokeStyle = "#A6B3D2";
    g.lineWidth = 1.6;
    for (let i = 0; i < 4; i++) {
      const c = cs[i] as Pt;
      const tc = topc[i] as Pt;
      const a = P(c[0], c[1], 0);
      const b = P(tc[0], tc[1], tp);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
    g.lineWidth = 1;
    g.strokeStyle = "rgba(166,179,210,.8)";
    for (let s = 1; s < 8; s++) {
      const u = s / 8;
      const zz = tp * u * 0.96;
      const k = 1 - u * 0.85;
      const q: Pt[] = [[bx - hw * k, by - hw * k], [bx + hw * k, by - hw * k], [bx + hw * k, by + hw * k], [bx - hw * k, by + hw * k]];
      g.beginPath();
      for (let c = 0; c < 5; c++) {
        const qq = q[c % 4] as Pt;
        const pp = P(qq[0], qq[1], zz);
        if (c) g.lineTo(pp[0], pp[1]);
        else g.moveTo(pp[0], pp[1]);
      }
      g.stroke();
      if (s < 7) {
        const q0 = q[0] as Pt;
        const q2 = q[2] as Pt;
        const d1 = P(q0[0], q0[1], zz);
        const d2 = P(q2[0], q2[1], zz + (tp / 8) * 0.8);
        g.beginPath();
        g.moveTo(d1[0], d1[1]);
        g.lineTo(d2[0], d2[1]);
        g.stroke();
      }
    }
    box(bx - 0.45, by - 0.45, 0, 0.9, 0.9, 6, "#1B2540");
    box(bx - 0.14, by - 0.14, tp - 2, 0.28, 0.28, 8, "#d0d8ec");
    box(bx - 0.3, by - 0.06, tp - 14, 0.6, 0.12, 10, C.cz);
    const on = flash || Math.floor(tm) % 2 === 0;
    const bp = P(bx, by, tp + 12);
    g.beginPath();
    g.arc(bp[0], bp[1], 3.5, 0, 6.2832);
    g.fillStyle = on ? "#ff6b5c" : "#6a2a28";
    g.fill();
    if (on) glow(bp, flash ? 50 : 26, "rgba(255,90,76,.8)", flash ? 1 : 0.7);
  }
  function datacenter(tm: number, flash: boolean): void {
    const x = 5.5;
    const y = 0.6;
    const w = 2.3;
    const d = 3.0;
    box(x, y, 0, w, d, 46, "#26335E");
    box(x - 0.06, y - 0.06, 46, w + 0.12, d + 0.12, 3, "#3a4b82");
    for (let i = 0; i < 4; i++) faceRect("y", x + 0.2 + i * 0.52, x + 0.62 + i * 0.52, y + d, 14, 36, flash ? "#9CC0FF" : "#3C6BC8", "rgba(255,255,255,.18)");
    for (let j = 0; j < 4; j++) faceRect("x", y + 0.2 + j * 0.7, y + 0.75 + j * 0.7, x + w, 14, 36, flash ? "#9CC0FF" : "#30539F", "rgba(255,255,255,.14)");
    faceRect("y", x + 0.2, x + w - 0.2, y + d, 4, 10, "#1B2540");
    for (let k = 0; k < 8; k++) {
      const lp = P(x + 0.3 + k * 0.22, y + d, 7);
      const v = Math.floor(tm * 3 + k * 1.3) % 3;
      g.fillStyle = v === 0 ? C.vdl : v === 1 ? C.azl : C.am;
      g.fillRect(lp[0] - 1.4, lp[1] - 1, 2.8, 2.2);
    }
    faceText("y", x + 0.2, y + d, 42, "SERVIDOR", 11, "#EEF1F8", 800);
    box(x + 1.5, y + 1.9, 49, 0.5, 0.5, 4, C.cz);
    box(x + 0.3, y + 0.5, 49, 0.6, 0.6, 5, C.cz);
    box(x + 0.35, y + 1.4, 49, 0.6, 0.6, 5, C.cz);
    const dp = P(x + 1.0, y + 1.1, 62);
    g.beginPath();
    g.ellipse(dp[0], dp[1], 14, 9, -0.4, 0, 6.2832);
    g.fillStyle = "#d0d8ec";
    g.fill();
    g.strokeStyle = "#7f8cb0";
    g.lineWidth = 1.2;
    g.stroke();
    g.beginPath();
    g.moveTo(dp[0], dp[1]);
    g.lineTo(dp[0] + 6, dp[1] - 10);
    g.strokeStyle = "#A6B3D2";
    g.stroke();
    if (flash) glow(dp, 60, "rgba(91,138,232,.9)", 1);
    glow(P(x + w, y + d, 24), 70, "rgba(60,107,200,.35)", 0.7);
  }
  function caminhao(ty: number, tilt: number, cargo: number, tm: number, fumaca: boolean): void {
    const x = 2.85;
    const w = 1.3;
    const cabD = 1.15;
    const gap = 0.08;
    const tl = ty + cabD + gap;
    const td = 3.0;
    [ty + 0.35, tl + 0.5, tl + 1.1, tl + 2.55].forEach((r) => {
      box(x - 0.04, r - 0.17, 0, 0.16, 0.34, 11, "#0b1020");
      box(x + w - 0.12, r - 0.17, 0, 0.16, 0.34, 11, "#0b1020");
    });
    box(x + 0.1, ty, 8, w - 0.2, cabD + gap + td, 5, "#10182f");
    box(x, ty, 11, w, cabD, 17, C.lj);
    box(x, ty + 0.05, 28, w, cabD - 0.1, 14, C.lj);
    faceRect("x", ty + 0.1, ty + 0.5, x + w, 30, 40, "#9CC0FF", "rgba(255,255,255,.3)");
    box(x + 0.05, ty - 0.1, 11, w - 0.1, 0.12, 9, "#10182f");
    box(x + 0.2, ty - 0.02, 12, 0.3, 0.06, 4, C.am);
    const lift = tilt * 36;
    box(x - 0.04, tl, 13, w + 0.08, td, 4, "#10182f", { lift });
    box(x - 0.04, tl, 17, 0.1, td, 16, C.lj, { lift });
    box(x + w - 0.06, tl, 17, 0.1, td, 16, C.lj, { lift });
    box(x - 0.04, tl, 17, w + 0.08, 0.1, 16, C.ljd);
    if (cargo > 0.02) box(x + 0.04, tl + 0.1, 17, w - 0.1, td - 0.2, 11 * cargo + 1, C.pb, { lift });
    box(x - 0.05, tl + td - 0.05, 17 + lift, w + 0.1, 0.1, 16, C.ljd);
    faceRect("x", tl, tl + td, x + w + 0.04, 24, 27, "#EEF1F8");
    if (fumaca) {
      for (let s = 0; s < 4; s++) {
        const u = (tm * 0.7 + s / 4) % 1;
        const sp = P(x + 0.15, ty + 0.3, 48 + u * 24);
        g.beginPath();
        g.arc(sp[0] - u * 8, sp[1], 3 + u * 5, 0, 6.2832);
        g.fillStyle = `rgba(166,179,210,${(0.5 - u * 0.45).toFixed(2)})`;
        g.fill();
      }
    }
    glow(P(x + 0.1, ty - 0.1, 18), 28, "rgba(255,230,150,.55)", 0.8);
  }
  function pilhaChao(u: number): void {
    if (u <= 0) return;
    const cx = 3.5;
    const cy = 13.2;
    const sizes: [number, number, number][] = [[1.6, 1.3, 7], [1.15, 0.95, 7], [0.7, 0.6, 6], [0.3, 0.28, 4]];
    let z = 0;
    sizes.forEach((s, i) => {
      const f = Math.min(1, Math.max(0, u * 4 - i * 0.6));
      if (f <= 0) return;
      const m = Math.min(1, 0.6 + f * 0.4);
      box(cx - s[0] / 2, cy - s[1] / 2, z, s[0] * m, s[1] * m, s[2] * f, C.pb);
      z += s[2] * f;
    });
  }
  function arquivo(open: boolean, n: number, lampOn: boolean): void {
    const x0 = 18.4;
    const y = 0.3;
    const d = 1.1;
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * 1.0;
      box(x, y, 0, 0.95, d, 40, "#B7C2DD");
      faceRect("y", x + 0.06, x + 0.89, y + d, 4, 12, "#C9D3EA", "rgba(5,8,20,.3)");
      faceRect("y", x + 0.06, x + 0.89, y + d, 15, 24, "#C9D3EA", "rgba(5,8,20,.3)");
      faceRect("y", x + 0.06, x + 0.89, y + d, 27, 36, "#C9D3EA", "rgba(5,8,20,.3)");
      for (let h = 0; h < 3; h++) faceRect("y", x + 0.35, x + 0.6, y + d, 8 + h * 12, 9.2 + h * 12, "#3a456b");
      if (open && i === 1) box(x + 0.08, y + d, 27, 0.79, 0.35, 8, "#A9B6D6");
    }
    const cnt = Math.min(6, Math.floor(Math.log(n + 1) / Math.LN2 / 1.3));
    for (let k = 0; k < cnt; k++) papelChato(x0 + 0.2 + ((k * 0.42) % 2.7), y + 0.55, 41 + (k % 2) * 1.4, C.pp);
    box(x0, y, 40, 2.95, d, 1.5, "#8995B5");
    const lp = P(x0 + 1.5, y + d, 46);
    glow(lp, 42, "rgba(126,217,166,.7)", lampOn ? 1 : 0.45);
    g.fillStyle = C.vdl;
    g.fillRect(lp[0] - 3, lp[1] - 1.5, 6, 3);
  }
  function caixaDevolvidas(n: number, pulso: boolean): void {
    const x = 19.6;
    const y = 6.8;
    const w = 1.8;
    const d = 1.3;
    box(x, y, 0, w, d, 16, C.ljd);
    box(x + 0.06, y + 0.06, 16, w - 0.12, d - 0.12, 0.1, "#6f2f0c");
    faceRect("y", x + 0.12, x + w - 0.12, y + d, 4, 10, C.vm);
    faceRect("y", x + 0.12, x + w - 0.12, y + d, 10.2, 11.2, "#EEF1F8");
    const c = Math.min(5, n);
    for (let i = 0; i < c; i++) papelChato(x + 0.35 + i * 0.28, y + 0.5 + (i % 2) * 0.1, 17 + (i % 3), C.pp);
    glow(P(x + w / 2, y + d / 2, 22), pulso ? 56 : 34, "rgba(224,90,78,.8)", pulso ? 1 : 0.35);
  }
  function pastaAjustadas(pulso: boolean): void {
    const x = 19.6;
    const y = 10.2;
    const w = 1.8;
    const d = 1.3;
    box(x, y, 0, w, d, 12, "#223D80");
    for (let i = 0; i < 3; i++) box(x + 0.1 + i * 0.55, y + 0.12, 12, 0.4, d - 0.24, 14 + (i % 2) * 3, "#5B8AE8");
    glow(P(x + w / 2, y + d / 2, 24), pulso ? 52 : 28, "rgba(91,138,232,.8)", pulso ? 1 : 0.3);
  }
  function balcao(nT: number, nivel: number, tm: number): void {
    const x = 10.2;
    const y = 12.0;
    const w = 3.0;
    const d = 1.2;
    box(x, y, 0, w, d, 24, "#6c4a30");
    box(x - 0.05, y - 0.05, 24, w + 0.1, d + 0.1, 3, C.md);
    faceRect("y", x + 0.1, x + w - 0.1, y + d, 3, 10, "#4b3322");
    faceText("y", x + 0.15, y + d, 15, "ESPERANDO O ESCRITÓRIO", 7.4, "#F2B53F", 800);
    const postCols = [C.am, C.am, "#ff8a3d", C.vm];
    for (let i = 0; i < Math.min(5, nT); i++) {
      const px = x + 0.35 + i * 0.5;
      const py = y + 0.55;
      papelChato(px, py, 27, C.pp);
      papelChato(px + 0.02, py, 28.4, "#d4dbeb");
      box(px - 0.1, py - 0.1, 30, 0.2, 0.2, 1, postCols[nivel] ?? C.am, { edge: "rgba(5,8,20,.3)" });
    }
    if (nivel === 3 && nT > 0 && (reduce || Math.floor(tm * 2) % 2 === 0)) {
      poly([P(x - 0.1, y - 0.1, 0), P(x + w + 0.1, y - 0.1, 0), P(x + w + 0.1, y + d + 0.1, 0), P(x - 0.1, y + d + 0.1, 0)], "rgba(224,90,78,.28)", "rgba(224,90,78,.9)", 2);
    }
    relogioPino(x + w + 0.1, y + 0.5, 58, nivel, tm);
  }
  function sofa(x: number, y: number): void {
    box(x, y, 0, 3.0, 1.2, 10, "#26335E");
    box(x, y + 0.8, 10, 3.0, 0.4, 14, "#2A4A9E");
    box(x + 0.1, y, 10, 1.3, 0.8, 5, "#3A66C8");
    box(x + 1.6, y, 10, 1.3, 0.8, 5, "#3A66C8");
  }
  function cafeteira(x: number, y: number): void {
    mesa(x - 0.45, y - 0.45, 0.9, 0.9, C.md);
    box(x - 0.25, y - 0.22, 14, 0.5, 0.44, 20, "#2b3763");
    box(x - 0.1, y + 0.1, 20, 0.2, 0.12, 3, C.lj);
    box(x - 0.06, y - 0.1, 14, 0.12, 0.12, 6, C.pp);
  }
  function parede(tm: number, n: Numeros, robo: { texto: string; cor: string }, barras: boolean): void {
    const x0 = 10.1;
    const x1 = 19.5;
    const z0 = 34;
    const z1 = 86;
    faceRect("y", x0 - 0.1, x1 + 0.1, 0.0, z0 - 3, z1 + 3, "#0b1226", "rgba(91,138,232,.8)");
    faceRect("y", x0, x1, 0.0, z0, z1, "#0f1a38");
    glow(P((x0 + x1) / 2, 0.3, (z0 + z1) / 2), 200, "rgba(60,107,200,.28)", 0.9);
    faceText("y", x0 + 0.15, 0.0, z1 - 8, "MOVATRUCK · CONFERÊNCIA", 7.5, "#A6B3D2", 600);
    const items: [string, number, string][] = [["FILA", n.fila, "#5B8AE8"], ["VALID.", n.val, "#7ED9A6"], ["DEVOLV.", n.dev, "#E05A4E"], ["AJUST.", n.aj, "#EEF1F8"], ["ESPERA", n.trav, "#F2B53F"]];
    items.forEach((it, i) => {
      const cx = x0 + 0.15 + i * 1.82;
      faceText("y", cx, 0.0, z1 - 21, it[0], 6.2, "#A6B3D2", 600);
      faceText("y", cx, 0.0, z1 - 38, String(it[1]), 17, it[2], 800);
    });
    if (barras) {
      for (let b = 0; b < 26; b++) {
        const hh = 2 + ((Math.sin(b * 1.3 + 2) + 1) * 3.6 + (b === 25 ? Math.sin(tm * 2) * 1.2 + 1.2 : 0));
        faceRect("y", x0 + 0.15 + b * 0.12, x0 + 0.15 + b * 0.12 + 0.08, 0.0, z0 + 4, z0 + 4 + hh, b % 5 === 4 ? "#F2B53F" : "#2A4A9E");
      }
    }
    faceText("y", barras ? x0 + 3.6 : x0 + 0.15, 0.0, z0 + 7, robo.texto, 7.5, robo.cor, 800);
    const cp = P(20.7, 0, 66);
    g.beginPath();
    g.arc(cp[0], cp[1], 14, 0, 6.2832);
    g.fillStyle = "#EEF1F8";
    g.fill();
    g.lineWidth = 2.4;
    g.strokeStyle = "#DF7234";
    g.stroke();
    const ang = tm * 0.5;
    g.strokeStyle = "#10182f";
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(cp[0], cp[1]);
    g.lineTo(cp[0] + Math.sin(ang) * 9, cp[1] - Math.cos(ang) * 9);
    g.stroke();
    g.beginPath();
    g.moveTo(cp[0], cp[1]);
    g.lineTo(cp[0] + Math.sin(ang / 12) * 6, cp[1] - Math.cos(ang / 12) * 6);
    g.stroke();
  }
  function divisoria(): void {
    for (let j = 0; j < GD; j++) {
      if (j === 4 || j === 5) continue;
      box(7.85, j, 0, 0.3, 1, 12, "#26335E");
      box(7.9, j + 0.02, 12, 0.2, 0.96, 30, "#5B8AE8", { a: 0.16, edge: "rgba(160,190,255,.25)" });
    }
    box(7.82, 3.9, 0, 0.36, 0.2, 46, "#1B2540");
    box(7.82, 5.9, 0, 0.36, 0.2, 46, "#1B2540");
  }

  /* ---------- sinais, pacotes, cartões, selos ---------- */
  function p3(a: Pt3, b: Pt3, u: number, lift: number): Pt3 {
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u) + 4 * lift * u * (1 - u)];
  }
  function caboPos(u: number): Pt3 {
    let tot = 0;
    const ls: number[] = [];
    for (let i = 0; i < CABO.length - 1; i++) {
      const a = CABO[i] as Pt3;
      const b = CABO[i + 1] as Pt3;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] - a[2]) / 24);
      ls.push(l);
      tot += l;
    }
    let d = u * tot;
    for (let q = 0; q < ls.length; q++) {
      const lq = ls[q] as number;
      if (d <= lq) {
        const a2 = CABO[q] as Pt3;
        const b2 = CABO[q + 1] as Pt3;
        const f = d / lq;
        return [lerp(a2[0], b2[0], f), lerp(a2[1], b2[1], f), lerp(a2[2], b2[2], f)];
      }
      d -= lq;
    }
    return CABO[CABO.length - 1] as Pt3;
  }
  function pacote(pt: Pt3, col?: "r"): void {
    const p = P(pt[0], pt[1], pt[2]);
    glow(p, 22, col === "r" ? "rgba(224,90,78,.9)" : "rgba(91,138,232,.95)", 1);
    g.beginPath();
    g.arc(p[0], p[1], 4, 0, 6.2832);
    g.fillStyle = col === "r" ? "#ffb1a8" : "#cfe0ff";
    g.fill();
  }
  function trilha(a: Pt3, b: Pt3, u: number, lift: number, col?: "r"): void {
    for (let i = 1; i <= 5; i++) {
      const uu = Math.max(0, u - i * 0.035);
      const pt = p3(a, b, uu, lift);
      const p = P(pt[0], pt[1], pt[2]);
      g.beginPath();
      g.arc(p[0], p[1], 3 - i * 0.4, 0, 6.2832);
      g.fillStyle = `${col === "r" ? "rgba(224,90,78," : "rgba(91,138,232,"}${(0.55 - i * 0.09).toFixed(2)})`;
      g.fill();
    }
  }
  type LinhaCartao = [string, string, "ok" | "no" | "wait" | "ler"];
  function cartao(x: number, y: number, z: number, titulo: string, rows: LinhaCartao[], prog: number, col: string, tm: number, sempre: boolean): void {
    const p = P(x, y, z);
    const w = 170;
    const hgt = 24 + rows.length * 16 + 6;
    const cx = p[0] - w / 2;
    const cy = p[1] - hgt;
    g.save();
    g.fillStyle = "rgba(8,13,28,.92)";
    roundRect(cx, cy, w, hgt, 8);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 1.4;
    g.stroke();
    g.beginPath();
    g.moveTo(p[0] - 6, cy + hgt);
    g.lineTo(p[0], cy + hgt + 7);
    g.lineTo(p[0] + 6, cy + hgt);
    g.fillStyle = "rgba(8,13,28,.92)";
    g.fill();
    g.font = "800 10.5px Archivo, system-ui, sans-serif";
    g.fillStyle = col;
    g.fillText(titulo, cx + 10, cy + 16);
    g.font = '600 10.5px "Public Sans", system-ui, sans-serif';
    rows.forEach((r, i) => {
      const ry = cy + 33 + i * 16;
      const mostra = sempre || prog > (i / rows.length) * 0.86 + 0.04;
      const pronto = sempre || prog > ((i + 1) / rows.length) * 0.86 + 0.04;
      g.fillStyle = "#A6B3D2";
      g.fillText(r[0], cx + 10, ry);
      if (!mostra) return;
      if (!pronto || r[2] === "ler") {
        g.fillStyle = "#5B8AE8";
        g.fillText(r[2] === "ler" ? r[1] : "lendo…", cx + 74, ry);
        return;
      }
      g.fillStyle = r[2] === "ok" ? "#7ED9A6" : r[2] === "no" ? "#ff8f84" : "#F2B53F";
      g.fillText((r[2] === "ok" ? "✓ " : r[2] === "no" ? "✗ " : "? ") + r[1], cx + 74, ry);
    });
    const sy = cy + 22 + ((tm * 40) % (hgt - 26));
    if (prog < 1) {
      g.fillStyle = "rgba(91,138,232,.25)";
      g.fillRect(cx + 6, sy, w - 12, 2);
    }
    g.restore();
  }
  function selo(x: number, y: number, z: number, tipo: "ok" | "no" | "wait", u: number): void {
    const p = P(x, y, z + 10 * u);
    const s = 0.6 + 0.4 * Math.min(1, u * 1.6);
    g.save();
    g.translate(p[0], p[1]);
    g.scale(s, s);
    glow([0, 0], 36, tipo === "ok" ? "rgba(126,217,166,.9)" : tipo === "no" ? "rgba(224,90,78,.9)" : "rgba(242,181,63,.9)", 1);
    g.beginPath();
    g.arc(0, 0, 13, 0, 6.2832);
    g.fillStyle = tipo === "ok" ? "#27A06A" : tipo === "no" ? "#E05A4E" : "#F2B53F";
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "#EEF1F8";
    g.stroke();
    g.fillStyle = tipo === "wait" ? "#1B2540" : "#EEF1F8";
    g.font = "800 17px Archivo, system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText(tipo === "ok" ? "✓" : tipo === "no" ? "✗" : "!", 0, 6);
    g.textAlign = "left";
    g.restore();
  }
  function ondas(x: number, y: number, z: number, tm: number): void {
    const p = P(x, y, z);
    for (let r = 0; r < 3; r++) {
      const u = (tm * 1.4 + r / 3) % 1;
      g.beginPath();
      g.arc(p[0], p[1], 6 + u * 28, -1.25, -0.2);
      g.strokeStyle = `rgba(126,180,255,${(0.9 - u * 0.85).toFixed(2)})`;
      g.lineWidth = 2;
      g.stroke();
    }
  }

  /* ---------- estado ---------- */
  const DEMO_INICIAL: Numeros = { fila: 7, val: 128, dev: 6, aj: 11, trav: 2, age: 195 };
  const st: Numeros = { fila: 0, val: 0, dev: 0, aj: 0, trav: 0, age: 0 };
  const S = {
    modo: "vivo" as Modo,
    pausado: false,
    vel: 1 as 1 | 2,
    forcado: "" as Caso | "",
    relogio: 0, // segundos de cena (anda quando não está pausada)
    // demo
    t: 12.6,
    seqI: 0,
    outcome: "OK" as Caso,
    kind: "OK" as Kind,
    demoFired: {} as Record<string, boolean>,
    skipBefore: 12.6 as number | null,
    simMin: 14 * 60 + 7,
    // vivo
    snap: null as EscritorioSnapshot | null,
    primeira: true,
    chegadas: [] as Chegada[],
    fila: [] as Veredito[],
    ativo: null as Veredito | null,
    vistosCh: new Set<string>(),
    vistosVe: new Set<string>(),
    ageBase: 0,
    ageEm: 0,
    slot: 0,
  };
  let ultimoEnviado = "";
  let rafId = 0;
  let ultimoTick = performance.now();

  function relogioTexto(): string {
    if (S.modo === "demo") {
      const m = S.simMin % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    }
    return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  }
  function log(msg: string, tom: TomLog, gl: string): void {
    cb.onLog({ h: relogioTexto(), msg, tom, gl });
  }
  function notificar(): void {
    const k = `${st.fila}|${st.val}|${st.dev}|${st.aj}|${st.trav}|${Math.round(st.age)}`;
    if (k !== ultimoEnviado) {
      ultimoEnviado = k;
      cb.onNumeros({ ...st });
    }
  }
  function nivelAge(): number {
    const a = st.age;
    return a < 15 ? 0 : a < 120 ? 1 : a < 480 ? 2 : 3;
  }
  function once(f: Record<string, boolean>, k: string, now: number, at: number, fn: () => void, skip: number | null): void {
    if (now >= at && !f[k]) {
      f[k] = true;
      if (skip !== null && at < skip) return;
      fn();
    }
  }

  /* ---------- demo: ciclo fictício ---------- */
  function iniciarCicloDemo(): void {
    S.demoFired = {};
    let pick: Caso = S.forcado || (SEQ[S.seqI++ % SEQ.length] as Caso);
    if (pick === "HUM" && st.trav <= 0) pick = "OK";
    S.outcome = pick;
    S.kind = pick === "HUM" ? "OK" : (pick as Kind);
    st.fila = Math.max(3, Math.min(30, st.fila + (Math.random() < 0.5 ? 1 : -1)));
    S.simMin += 2;
  }
  function demoChegada(): { ta: number; slot: number; aj: boolean } {
    return { ta: S.t, slot: 0, aj: S.kind === "AJ" };
  }
  function demoVeredito(): VView {
    return {
      id: "demo", inicio: 0, tv: S.t, kind: S.kind, seg2: S.kind === "DIV", aviso: S.kind === "DIV", hum: S.outcome === "HUM",
      texto: "", tom: "ok", fired: S.demoFired,
    };
  }

  /* ---------- eventos de log (e, no demo, dos números) ---------- */
  function eventosChegada(f: Record<string, boolean>, ta: number, aj: boolean, demo: boolean, skip: number | null): void {
    if (demo && !aj) once(f, "c1", ta, 1.6, () => log("Caminhão chegou ao ponto de descarga", "info", "•"), skip);
    if (demo && !aj) once(f, "c2", ta, 3.0, () => log("Descarga concluída", "info", "•"), skip);
    once(f, "c3", ta, 3.8, () => log(aj ? "Motorista corrigiu a viagem e reenviou" : demo ? "Motorista lançou a viagem no celular" : "Uma viagem chegou do celular do motorista", "info", "•"), skip);
    once(f, "c4", ta, 5.9, () => log("Sinal passou pela torre", "info", "•"), skip);
    once(f, "c5", ta, 6.8, () => log("Servidor recebeu a viagem", "info", "•"), skip);
    once(f, "c6", ta, 8.9, () => {
      if (demo) st.fila++;
      log("Viagem na mesa de entrada", "info", "•");
    }, skip);
  }
  const tFly = (v: { seg2: boolean }): number => (v.seg2 ? 17.6 : 14.7);
  function eventosVeredito(v: VView, demo: boolean, skip: number | null): void {
    const f = v.fired;
    const tv = v.tv;
    const f1 = tFly(v) + 1.1;
    once(f, "c7", tv, 10.3, () => {
      if (demo) st.fila = Math.max(0, st.fila - 1);
      log("Agente leitor pegou a viagem", "info", "•");
    }, skip);
    once(f, "c8", tv, 12.0, () => log("Leitor lendo o ticket, sem ver o que o motorista digitou", "info", "?"), skip);
    once(f, "c9", tv, 14.3, () => {
      if (v.seg2) log(v.kind === "DIV" ? "Leitor achou divergência: chamando o conferente" : "Leitor ficou em dúvida: chamando o conferente", "wait", "!");
      else if (v.kind === "TRAV") log("Sem como decidir: esperando alguém do escritório", "wait", "!");
      else if (v.kind === "DIV") log("Ticket diverge do lançamento", "no", "✗");
      else log(v.kind === "AJ" ? "Ajuste confere com o ticket" : "Ticket confere com o lançamento", "ok", "✓");
    }, skip);
    if (v.seg2) {
      once(f, "c9b", tv, 16.9, () => {
        if (v.kind === "DIV") log("Conferente leu de novo e confirmou a divergência", "no", "✗");
        else if (v.kind === "TRAV") log("Conferente também ficou em dúvida", "wait", "!");
        else log("Conferente leu de novo e confirmou: ticket confere", "ok", "✓");
      }, skip);
    }
    once(f, "c10", tv, f1, () => {
      if (demo) {
        if (v.kind === "OK") st.val++;
        if (v.kind === "AJ") {
          st.aj++;
          st.dev = Math.max(0, st.dev - 1);
        }
        if (v.kind === "DIV") st.dev++;
        if (v.kind === "TRAV") {
          if (st.trav === 0) st.age = 3;
          st.trav++;
        }
      }
      if (v.kind === "OK" || v.kind === "AJ") log("Viagem validada", "ok", "✓");
      else if (v.kind === "DIV") log(v.aviso ? "Viagem devolvida pra conferir" : "Divergência registrada, sem aviso ao motorista", "no", "✗");
      else log("Viagem parada: esperando alguém do escritório", "wait", "!");
    }, skip);
    if (v.hum) {
      once(f, "c11", tv, 17.4, () => {
        if (st.trav > 0) {
          st.trav--;
          st.val++;
          st.age = st.trav === 0 ? 0 : st.age * 0.6;
          log("Alguém do escritório resolveu uma travada", "ok", "✓");
        }
      }, skip);
    }
    if (v.aviso) once(f, "c12", tv, 20.4, () => log("Aviso chegou ao celular do motorista", "info", "•"), skip);
  }

  /* ---------- poses ---------- */
  function driverSpot(slot: number): Pt {
    return [DRV[0], DRV[1] + (slot === 1 ? 1.3 : slot === 2 ? -1.3 : 0)];
  }
  function leitorPose(v: VView | null): PoseHumano {
    const h = HOME1;
    if (!v || v.tv < 8.9) return { x: h[0], y: h[1], dir: "px", seat: true };
    const tv = v.tv;
    if (tv < 10.2) {
      const u = ease(seg(tv, 8.9, 10.2));
      return { x: lerp(h[0], INBOX[0], u), y: lerp(h[1], INBOX[1], u), dir: u < 0.85 ? "my" : "mx", walk: true };
    }
    if (tv < 10.6) return { x: INBOX[0], y: INBOX[1], dir: "mx", arm: "front" };
    if (tv < 12.0) {
      const u2 = ease(seg(tv, 10.6, 12.0));
      return { x: lerp(INBOX[0], h[0], u2), y: lerp(INBOX[1], h[1], u2), dir: u2 < 0.15 ? "mx" : "py", walk: true, arm: "front" };
    }
    if (tv < 13.8) return { x: h[0], y: h[1], dir: "px", arm: "front" };
    if (tv < 14.7) return { x: h[0], y: h[1], dir: "px", arm: Math.floor(tv * 6) % 2 ? "up" : "front" };
    if (tv < 16.0 && (v.kind === "OK" || v.kind === "AJ") && !v.seg2) return { x: h[0], y: h[1], dir: "px", arm: "up" };
    return { x: h[0], y: h[1], dir: "px" };
  }
  function conferentePose(v: VView | null): PoseHumano {
    const h = HOME2;
    if (v && v.seg2 && v.tv >= 15.4 && v.tv < 16.9) return { x: h[0], y: h[1], dir: "px", arm: "front" };
    if (v && v.seg2 && v.tv >= 16.9 && v.tv < 17.6) return { x: h[0], y: h[1], dir: "px", arm: Math.floor(v.tv * 6) % 2 ? "up" : "front" };
    return { x: h[0], y: h[1], dir: "px", seat: true };
  }
  function motoristaPose(ta: number, slot: number, aj: boolean): PoseHumano | null {
    const spot = driverSpot(slot);
    if (aj) {
      if (ta < 5.0) return { x: spot[0], y: spot[1], dir: "mx", arm: ta > 3.8 ? "up" : null };
    } else {
      if (ta < 3.0) return null;
      if (ta < 3.8) {
        const u = ease(seg(ta, 3.0, 3.8));
        return { x: lerp(4.4, spot[0], u), y: lerp(8.9 + (spot[1] - DRV[1]), spot[1], u), dir: "py", walk: true };
      }
      if (ta < 5.0) return { x: spot[0], y: spot[1], dir: "mx", arm: ta < 4.4 ? "up" : null };
    }
    if (ta < 7.2) {
      const v = ease(seg(ta, 5.0, 7.2));
      return { x: lerp(spot[0], 6.4, v), y: lerp(spot[1], 19, v), dir: "py", walk: true };
    }
    return null;
  }
  function humanoPose(v: VView | null): PoseHumano | null {
    if (!v || !v.hum) return null;
    const tv = v.tv;
    const hx = 11.7;
    const hy = 11.2;
    if (tv < 15.8) return null;
    if (tv < 16.6) {
      const u = ease(seg(tv, 15.8, 16.6));
      return { x: lerp(8.8, hx, u), y: lerp(10.2, hy, u), dir: "py", walk: true };
    }
    if (tv < 17.4) return { x: hx, y: hy, dir: "py", arm: tv < 17.0 ? "up" : "front" };
    if (tv < 18.5) return { x: hx, y: hy, dir: "py", arm: "front" };
    if (tv < 19.4) {
      const w = ease(seg(tv, 18.5, 19.4));
      return { x: lerp(hx, 8.8, w), y: lerp(hy, 10.2, w), dir: "my", walk: true };
    }
    return null;
  }
  function destinoDe(kind: Kind): Pt3 {
    if (kind === "OK") return [19.9, 1.0, 42];
    if (kind === "AJ") return [20.5, 10.8, 18];
    if (kind === "DIV") return [20.5, 7.4, 20];
    return [11.7, 12.6, 28];
  }

  /* ---------- quadro ---------- */
  interface Item {
    k: number;
    f: () => void;
  }
  function frame(): void {
    const tm = S.relogio;
    const demo = S.modo === "demo";
    g = ctx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, LARGURA, ALTURA);
    g.drawImage(bgc, 0, 0, LARGURA * DPR, ALTURA * DPR, 0, 0, LARGURA, ALTURA);
    g.lineJoin = "round";

    // linhas do tempo vigentes
    const chegadas: { ta: number; slot: number; aj: boolean }[] = demo
      ? [demoChegada()]
      : S.chegadas.map((c) => ({ ta: 3.0 + (S.relogio - c.inicio), slot: c.slot, aj: c.aj }));
    const V: VView | null = demo ? demoVeredito() : S.ativo ? { ...S.ativo, tv: 8.9 + (S.relogio - S.ativo.inicio) } : null;
    const kind: Kind = V ? V.kind : "OK";
    const f0 = V ? tFly(V) : 14.7;
    const f1 = f0 + 1.1;
    const ajDemo = demo && S.kind === "AJ";
    const t = demo ? S.t : 0;
    const items: Item[] = [];
    const add = (k: number, fn: () => void): void => {
      items.push({ k, f: fn });
    };
    const robo = roboRotulo(demo);
    parede(tm, st, robo, demo);

    // caminhão: no demo faz a descarga; ao vivo fica estacionado (decoração, sem fingir fato)
    let ty: number | null = null;
    let tilt = 0;
    let cargo = 1;
    let unl = 0;
    if (demo && !ajDemo) {
      unl = seg(t, 1.8, 3.0);
      if (t < 3.8) ty = lerp(19, 8.2, easeOut(seg(t, 0, 1.8)));
      else if (t < 5.8) ty = lerp(8.2, -6, ease(seg(t, 3.8, 5.8)));
      tilt = unl < 1 ? unl : Math.max(0, 1 - seg(t, 3.0, 3.8));
      cargo = 1 - unl;
    } else if (!demo) {
      ty = 8.2;
      unl = 1;
      cargo = 0;
    }
    if (demo ? !ajDemo : true) {
      const tyV = ty;
      add(0.2 + (tyV === null ? 0 : tyV + 2.2) + 3.5, () => {
        if (tyV !== null) caminhao(tyV, tilt, cargo, tm, demo ? t < 2 || (t > 3.8 && t < 5.8) : Math.floor(tm / 5) % 2 === 0);
      });
      add(3.5 + 13.2, () => pilhaChao(unl));
    }
    add(6.5 + 3, () => datacenter(tm, chegadas.some((c) => c.ta > 6.8 && c.ta < 7.4)));
    add(6.2 + 6.5, () => torre(tm, chegadas.some((c) => c.ta > 5.5 && c.ta < 6.2)));
    add(2 + 3, () => posteLuz(5.0, 6.0));
    add(2 + 14, () => posteLuz(5.0, 13.8));
    add(5.5 + 9, () => {
      coneTrafego(4.8, 8.0);
      coneTrafego(4.8, 13.2);
    });
    add(2 + 8, () => {
      box(0.5, 7.4, 0, 1, 0.9, 9, "#8a5a3a");
      box(0.6, 7.5, 9, 0.8, 0.7, 8, "#9A6B43");
      box(0.5, 8.5, 0, 1, 0.9, 9, "#8a5a3a");
    });

    // mesa de entrada e a pilha (a altura vem do número real de jobs na fila)
    const topo = pilhaTopo(st.fila);
    add(11 + 5, () => {
      mesa(10, 4.2, 2.2, 1.6, C.md);
      pilha(st.fila, 11.0, 5.0, 14);
      chegadas.forEach((c) => {
        if (c.ta >= 8.4 && c.ta < 8.9) {
          const uf = seg(c.ta, 8.4, 8.9);
          const bq = uf < 0.75 ? easeOut(uf / 0.75) : 1 - Math.sin(((uf - 0.75) / 0.25) * Math.PI) * 0.1;
          papelChato(10.9, 5.0, lerp(70, topo, bq), C.pp);
        }
      });
      if (V && V.tv >= 10.2 && V.tv < 10.6) papelChato(lerp(11.0, 12.5, seg(V.tv, 10.2, 10.6)), 5.0, lerp(topo, 28, seg(V.tv, 10.2, 10.6)), C.pp);
    });

    const ag = leitorPose(V);
    const lendo = !!V && V.tv >= 11.4 && V.tv < 15.5;
    add(15.2 + 9.0, () => {
      mesa(14.6, 8.2, 2, 1.6, C.md);
      monitor(16.1, 9.0, lendo, "rgba(91,138,232,.6)");
      box(14.8, 8.8, 14, 0.3, 0.5, 0.8, "#cfd8ee");
      box(15.8, 8.35, 14, 0.12, 0.12, 7, "#10182f");
      box(14.7, 8.5, 14, 0.12, 0.12, 3, C.pp);
    });
    add(15.2 + 12.2, () => {
      mesa(14.6, 11.4, 2, 1.6, C.md);
      monitor(16.1, 12.2, !!V && V.seg2 && V.tv >= 15.0 && V.tv < 17.6, "rgba(242,181,63,.55)");
      box(14.8, 12.0, 14, 0.3, 0.5, 0.8, "#cfd8ee");
      box(15.7, 11.55, 14, 0.12, 0.12, 5, C.ljd);
    });

    // o papel principal
    let mp: Pt3 | null = null;
    const papelCor = (): string => {
      if (!V) return C.pp;
      if (V.tv >= 14.3 && V.tv < f1) {
        if (V.seg2 && V.tv < 16.9) return "#ffe0a0";
        return kind === "OK" || kind === "AJ" ? "#a9e8c6" : kind === "DIV" ? "#ffb1a8" : "#ffe0a0";
      }
      return C.pp;
    };
    if (V) {
      const tv = V.tv;
      if (tv >= 10.6 && tv < 12.0) mp = [ag.x + (ag.dir === "mx" ? -0.3 : ag.dir === "py" ? 0.02 : 0.3), ag.y + (ag.dir === "py" ? 0.3 : 0), 24];
      if (tv >= 12.0 && tv < (V.seg2 ? 14.7 : f0)) mp = [15.2, 9.0, 14.8];
      if (V.seg2 && tv >= 14.7 && tv < 15.4) mp = p3([15.2, 9.0, 14.8], [15.2, 12.2, 14.8], ease(seg(tv, 14.7, 15.4)), 20);
      if (V.seg2 && tv >= 15.4 && tv < f0) mp = [15.2, 12.2, 14.8];
      if (tv >= f0 && tv < f1) {
        const ini: Pt3 = V.seg2 ? [15.2, 12.2, 14.8] : [15.2, 9.0, 14.8];
        mp = p3(ini, destinoDe(kind), ease(seg(tv, f0, f1)), kind === "OK" ? 60 : 36);
      }
    }
    const mpF = mp;
    add(20, () => {
      if (mpF) {
        papelChato(mpF[0], mpF[1], mpF[2], papelCor());
        if (ajDemo) box(mpF[0] + 0.02, mpF[1] - 0.15, mpF[2] + 1.4, 0.12, 0.12, 0.8, C.azl);
      }
    });

    // pessoas
    add(ag.x + ag.y, () => {
      tag(ag.x, ag.y, 50, "LEITOR", C.azl);
      human({ ...ag, t: tm, shirt: "#2A4A9E", skin: C.pb, hair: C.g0, badge: true });
    });
    const cf = conferentePose(V);
    add(cf.x + cf.y, () => {
      tag(cf.x, cf.y, 50, "CONFERENTE", C.am);
      human({ ...cf, t: tm, shirt: "#B4501A", skin: C.pa, hair: C.pc });
    });
    chegadas.forEach((c) => {
      const mt = motoristaPose(c.ta, c.slot, c.aj);
      if (!mt) return;
      add(mt.x + mt.y, () => {
        human({ ...mt, t: tm, shirt: "#8A3A12", skin: C.pa, hair: C.pc, cap: true });
        if (mt.arm === "up") {
          const cp = P(mt.x + (mt.dir === "mx" ? -0.1 : 0), mt.y, 35);
          g.fillStyle = "#0b1226";
          g.fillRect(cp[0] - 2.5, cp[1] - 6, 5, 8);
          g.fillStyle = "#9CC0FF";
          g.fillRect(cp[0] - 1.6, cp[1] - 5, 3.2, 6);
          glow([cp[0], cp[1] - 2], 18, "rgba(120,170,255,.8)", 0.9);
        }
      });
    });
    if (V && V.aviso && V.tv > 20.0) {
      const sp = driverSpot(0);
      add(sp[0] + sp[1], () => human({ x: sp[0], y: sp[1], dir: "mx", arm: "up", t: tm, shirt: "#8A3A12", skin: C.pa, hair: C.pc, cap: true }));
    }
    const hm = humanoPose(V);
    if (hm) add(hm.x + hm.y, () => human({ ...hm, t: tm, shirt: "#1d8a5c", skin: C.pc, hair: C.g0 }));

    // móveis restantes
    add(20 + 1.5, () => arquivo(!!V && ((kind === "OK" && V.tv > f0 - 0.3 && V.tv < f0 + 1.2) || (V.hum && V.tv > 18)), st.val, !!V && V.tv > f0 - 0.2 && V.tv < f0 + 1.3));
    add(20.5 + 7.4, () => caixaDevolvidas(st.dev, !!V && kind === "DIV" && V.tv > f1 && V.tv < f1 + 1.5));
    add(20.5 + 10.8, () => pastaAjustadas(!!V && kind === "AJ" && V.tv > f1 && V.tv < f1 + 1.5));
    add(11.7 + 12.6, () => balcao(st.trav, nivelAge(), tm));
    add(9 + 14.4, () => planta(9.4, 14.3));
    add(21 + 14.4, () => planta(21.5, 14.3));
    add(19 + 13.5, () => sofa(17.5, 13.3));
    add(9 + 8.8, () => cafeteira(9.2, 8.9));
    add(21 + 4.6, () => {
      box(21.0, 4.3, 0, 0.5, 0.5, 30, "#9CC0FF", { a: 0.8 });
      box(20.95, 4.25, 30, 0.6, 0.6, 4, "#cfd8ee");
    });
    add(1 + 3, () => arvore(1.0, 3.2));
    add(1 + 14, () => arvore(1.0, 13.6));
    add(7 + 14, () => arvore(7.2, 14.2));

    items.sort((a, b) => a.k - b.k);
    divisoria();
    items.forEach((i) => i.f());

    // sinais e pacotes por cima
    const tTop: Pt3 = [6.2, 6.5, 160];
    const dish: Pt3 = [6.5, 1.7, 62];
    chegadas.forEach((c) => {
      const sp = driverSpot(c.slot);
      const ph: Pt3 = [sp[0] - 0.1, sp[1], 37];
      if (c.ta > 3.8 && c.ta < 5.0) ondas(ph[0], ph[1], 37, tm);
      if (c.ta >= 5.0 && c.ta < 5.9) {
        const u1 = ease(seg(c.ta, 5.0, 5.9));
        trilha(ph, tTop, u1, 40);
        pacote(p3(ph, tTop, u1, 40));
      }
      if (c.ta >= 5.9 && c.ta < 6.8) {
        const u2 = ease(seg(c.ta, 5.9, 6.8));
        trilha(tTop, dish, u2, 30);
        pacote(p3(tTop, dish, u2, 30));
      }
      if (c.ta >= 7.2 && c.ta < 8.4) {
        const u3 = easeOut(seg(c.ta, 7.2, 8.4));
        pacote(caboPos(u3));
        for (let q = 1; q < 6; q++) {
          const cp = caboPos(Math.max(0, u3 - q * 0.03));
          const pp = P(cp[0], cp[1], cp[2]);
          g.beginPath();
          g.arc(pp[0], pp[1], 2.6 - q * 0.3, 0, 6.2832);
          g.fillStyle = `rgba(91,138,232,${0.5 - q * 0.08})`;
          g.fill();
        }
      }
    });
    for (let r = 0; r < 3; r++) {
      const pc = caboPos((tm * 0.18 + r / 3) % 1);
      const pp = P(pc[0], pc[1], pc[2]);
      g.fillStyle = "rgba(91,138,232,.7)";
      g.fillRect(pp[0] - 1, pp[1] - 1, 2, 2);
    }
    if (V && V.aviso) {
      const ob: Pt3 = [20.5, 7.4, 28];
      const sp0 = driverSpot(0);
      const ph0: Pt3 = [sp0[0] - 0.1, sp0[1], 37];
      if (V.tv >= 18.7 && V.tv < 19.6) {
        const u4 = ease(seg(V.tv, 18.7, 19.6));
        trilha(ob, tTop, u4, 50, "r");
        pacote(p3(ob, tTop, u4, 50), "r");
      }
      if (V.tv >= 19.6 && V.tv < 20.4) {
        const u5 = ease(seg(V.tv, 19.6, 20.4));
        trilha(tTop, ph0, u5, 30, "r");
        pacote(p3(tTop, ph0, u5, 30), "r");
      }
      if (V.tv >= 20.0) selo(sp0[0], sp0[1], 52, "no", 1);
    }
    if (V && V.hum && V.tv >= 17.4 && V.tv < 18.5) {
      const hp = p3([11.7, 12.6, 28], [19.9, 1.0, 42], ease(seg(V.tv, 17.4, 18.5)), 70);
      papelChato(hp[0], hp[1], hp[2], "#a9e8c6");
    }

    // cartões e selos
    if (V) {
      const tv = V.tv;
      if (demo) {
        const dv = V.seg2 && kind === "DIV";
        if (tv >= 12.0 && tv < 14.3) {
          const rows1: LinhaCartao[] = [
            ["Peso", dv ? "lido 17,9 t" : "18,4 t", dv ? "no" : "ok"],
            ["Material", "Brita 1", "ok"],
            ["Placa", "conferida", "ok"],
            ["Obra", kind === "TRAV" ? "sem vínculo" : "Obra Centro", kind === "TRAV" ? "wait" : "ok"],
            ["Data", "hoje", "ok"],
          ];
          cartao(17.6, 9.0, 62, "LEITOR · TICKET", rows1, seg(tv, 12.0, 14.0), "#5B8AE8", tm, false);
        }
        if (V.seg2 && tv >= 15.4 && tv < 17.2) {
          const rows2: LinhaCartao[] = [["Peso", "lido 17,9 t", "no"], ["Lançado", "18,4 t", "ok"], ["Diferença", "0,5 t", "no"]];
          cartao(17.6, 12.4, 62, "CONFERENTE · 2ª LEITURA", rows2, seg(tv, 15.4, 16.9), "#F2B53F", tm, false);
        }
      } else {
        // Ao vivo: nada de campo inventado. Só "lendo" e o veredito de verdade.
        if (tv >= 12.0 && tv < 15.5) {
          const pronto = tv >= 13.8;
          const l1: LinhaCartao[] = pronto
            ? [["Resultado", V.seg2 ? "pediu 2ª leitura" : V.texto, V.seg2 ? "wait" : V.tom]]
            : [["Ticket", "lendo o ticket…", "ler"]];
          cartao(17.6, 9.0, 62, "LEITOR · TICKET", l1, pronto ? 1 : 0.5, "#5B8AE8", tm, true);
        }
        if (V.seg2 && tv >= 15.4 && tv < 17.6) {
          const pronto = tv >= 16.9;
          const l2: LinhaCartao[] = pronto ? [["Resultado", V.texto, V.tom]] : [["Ticket", "lendo de novo…", "ler"]];
          cartao(17.6, 12.4, 62, "CONFERENTE · 2ª LEITURA", l2, pronto ? 1 : 0.5, "#F2B53F", tm, true);
        }
      }
      const primeiroSelo: "ok" | "no" | "wait" = V.seg2 ? "wait" : kind === "TRAV" ? "wait" : kind === "DIV" ? "no" : "ok";
      if (tv >= 14.2 && tv < (V.seg2 ? 15.0 : 15.6)) selo(15.2, 9.0, 24, primeiroSelo, easeOut(seg(tv, 14.2, 15.0)));
      if (V.seg2 && tv >= 16.9 && tv < 18.0) selo(15.2, 12.2, 24, kind === "DIV" ? "no" : kind === "TRAV" ? "wait" : "ok", easeOut(seg(tv, 16.9, 17.5)));
    }

    // vinheta
    const vg = g.createRadialGradient(LARGURA / 2, ALTURA / 2, ALTURA * 0.35, LARGURA / 2, ALTURA / 2, ALTURA * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(3,5,14,.38)");
    g.fillStyle = vg;
    g.fillRect(0, 0, LARGURA, ALTURA);
  }
  function pilhaTopo(n: number): number {
    return 14 + degrausDaPilha(n) * 1.6;
  }
  function roboRotulo(demo: boolean): { texto: string; cor: string } {
    if (demo) return { texto: "DEMO · DADOS DE EXEMPLO", cor: "#F2B53F" };
    const r = S.snap?.robo;
    if (!r) return { texto: "AGUARDANDO DADOS REAIS", cor: "#A6B3D2" };
    if (!r.ativo) return { texto: "AGENTE DESLIGADO", cor: "#A6B3D2" };
    if (r.modoSombra) return { texto: "AGENTE EM MODO SOMBRA", cor: "#F2B53F" };
    return { texto: "AGENTE ATIVO · MODO REAL", cor: "#7ED9A6" };
  }

  /* ---------- ao vivo: do snapshot às animações ---------- */
  function veredictoParaKind(v: EscritorioSnapshot["veredictos"][number]): { kind: Kind; texto: string; tom: "ok" | "no" | "wait"; aviso: boolean } | null {
    if (v.veredito === "NAO_APLICAVEL") return null;
    const aviso = v.acao === "AVISOU_MOTORISTA";
    if (v.veredito === "BATE") return { kind: "OK", texto: "Confere", tom: "ok", aviso: false };
    if (aviso) return { kind: "DIV", texto: v.veredito === "ILEGIVEL" ? "Foto ilegível" : "Diverge", tom: "no", aviso: true };
    if (v.veredito === "DIVERGE" && v.acao !== "FILA_REVISAO") return { kind: "DIV", texto: "Diverge", tom: "no", aviso: false };
    return { kind: "TRAV", texto: v.veredito === "ILEGIVEL" ? "Foto ilegível" : "Em dúvida", tom: "wait", aviso: false };
  }
  function limitar(set: Set<string>): void {
    while (set.size > 300) {
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
    S.ageBase = s.travadaMaisAntigaMin ?? 0;
    S.ageEm = performance.now();
    st.age = st.trav > 0 ? S.ageBase : 0;
  }
  function ingerir(s: EscritorioSnapshot): void {
    aplicarNumeros(s);
    const novosCh = s.chegadas.filter((c) => !S.vistosCh.has(c.id));
    const novosVe = s.veredictos.filter((v) => !S.vistosVe.has(v.id)).sort((a, b) => a.em.localeCompare(b.em));
    s.chegadas.forEach((c) => S.vistosCh.add(c.id));
    s.veredictos.forEach((v) => S.vistosVe.add(v.id));
    limitar(S.vistosCh);
    limitar(S.vistosVe);
    // Primeira carga: só preenche os números, nunca reanima o histórico.
    if (S.primeira) {
      S.primeira = false;
      return;
    }
    // Sem movimento (preferência do sistema): os números já mudaram, e basta.
    if (reduce) return;
    novosCh.forEach((c) => {
      if (S.chegadas.length >= MAX_CHEGADAS) return;
      const usados = new Set(S.chegadas.map((x) => x.slot));
      const slot = [0, 1, 2].find((n) => !usados.has(n)) ?? 0;
      S.chegadas.push({ id: c.id, inicio: S.relogio, slot, aj: false, fired: {} });
    });
    novosVe.forEach((v) => {
      const m = veredictoParaKind(v);
      if (!m) return;
      if (S.fila.length + (S.ativo ? 1 : 0) >= MAX_FILA_VEREDITOS) return;
      S.fila.push({ id: v.id, inicio: 0, kind: m.kind, seg2: v.segundaLeitura, aviso: m.aviso, hum: false, texto: m.texto, tom: m.tom, fired: {} });
    });
  }

  /* ---------- relógio e laço ---------- */
  function avancar(dt: number): void {
    S.relogio += dt;
    if (S.modo === "demo") {
      S.t += dt;
      st.age += (dt / 60) * 240; // relógio acelerado (4 min por segundo)
      if (st.trav <= 0) st.age = 0;
      if (S.t >= T) {
        S.t -= T;
        iniciarCicloDemo();
      }
      return;
    }
    if (st.trav > 0) st.age = S.ageBase + (performance.now() - S.ageEm) / 60000;
    // chegadas: terminam em ta > 9
    S.chegadas = S.chegadas.filter((c) => 3.0 + (S.relogio - c.inicio) < 9.0);
    // veredito: um por vez
    if (S.ativo) {
      const fim = S.ativo.aviso ? 21.2 : tFly(S.ativo) + 1.1 + 0.8;
      if (8.9 + (S.relogio - S.ativo.inicio) > fim) S.ativo = null;
    }
    if (!S.ativo) {
      const prox = S.fila.shift();
      if (prox) {
        prox.inicio = S.relogio;
        S.ativo = prox;
      }
    }
  }
  function eventosDoQuadro(): void {
    if (S.modo === "demo") {
      const c = demoChegada();
      eventosChegada(S.demoFired, c.ta, c.aj, true, S.skipBefore);
      eventosVeredito(demoVeredito(), true, S.skipBefore);
      return;
    }
    S.chegadas.forEach((c) => eventosChegada(c.fired, 3.0 + (S.relogio - c.inicio), c.aj, false, null));
    if (S.ativo) eventosVeredito({ ...S.ativo, tv: 8.9 + (S.relogio - S.ativo.inicio) }, false, null);
  }
  function loop(now: number): void {
    const dt = Math.min(0.1, (now - ultimoTick) / 1000);
    ultimoTick = now;
    if (!S.pausado && !document.hidden) avancar(dt * (S.modo === "demo" ? S.vel : 1));
    eventosDoQuadro();
    S.skipBefore = null;
    frame();
    notificar();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- API pública ---------- */
  function resetarVivo(): void {
    S.chegadas = [];
    S.fila = [];
    S.ativo = null;
    S.vistosCh = new Set();
    S.vistosVe = new Set();
    S.primeira = true;
  }
  function resetarDemo(): void {
    Object.assign(st, DEMO_INICIAL);
    S.t = 12.6;
    S.skipBefore = S.t;
    S.outcome = "OK";
    S.kind = "OK";
    S.demoFired = {};
    S.seqI = 0;
  }

  fundo();
  if (reduce) S.pausado = true;
  rafId = requestAnimationFrame(loop);

  return {
    setModo(m) {
      if (S.modo === m) return;
      S.modo = m;
      if (m === "demo") {
        resetarDemo();
      } else {
        Object.assign(st, { fila: 0, val: 0, dev: 0, aj: 0, trav: 0, age: 0 });
        resetarVivo();
        if (S.snap) ingerir(S.snap);
      }
      ultimoEnviado = "";
      notificar();
    },
    setSnapshot(s) {
      S.snap = s;
      if (S.modo === "vivo" && s) ingerir(s);
    },
    setCaso(c) {
      S.forcado = c;
      if (S.modo === "demo" && c) {
        S.t = 0;
        iniciarCicloDemo();
        S.skipBefore = null;
        S.pausado = false;
      }
    },
    setPausado(p) {
      S.pausado = p;
    },
    setVelocidade(v) {
      S.vel = v;
    },
    destruir() {
      cancelAnimationFrame(rafId);
    },
  };
}
