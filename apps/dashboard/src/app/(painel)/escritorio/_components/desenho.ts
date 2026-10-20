/**
 * A arte do Escritório de Agentes: primitivas isométricas e tudo que se desenha
 * (obra, sinal, escritório, pessoas, caminhão). Sem estado de cena: quem decide
 * O QUE desenhar e QUANDO é o `cena.ts`. Aqui só se sabe COMO desenhar.
 *
 * Três zonas no mesmo canvas lógico de 1280x480, cada uma com a sua origem da
 * projeção: OBRA (esquerda), SINAL (faixa do meio) e ESCRITÓRIO (direita).
 */

export const LARGURA = 1280;
export const ALTURA = 480;

export type Pt = [number, number];
export type Pt3 = [number, number, number];
export type Dir = "px" | "py" | "mx" | "my";
export type Braco = "up" | "up2" | "front" | "both" | null | undefined;

/** Origem da projeção de cada zona: [x, y, k]. */
export interface Zona {
  x: number;
  y: number;
  k: number;
}
export const ZO: Zona = { x: 284, y: 150, k: 0.8 };
export const ZS: Zona = { x: 640, y: 210, k: 0.8 };
export const ZE: Zona = { x: 995, y: 196, k: 0.95 };
/** Divisões verticais do canvas lógico. */
export const OBRA_FIM = 528;
export const SINAL_FIM = 752;

/** Posição na cena (tiles) → % do canvas, pros rótulos em HTML por cima. */
export function pctNaCena(z: Zona, x: number, y: number, alt = 0): { left: number; top: number } {
  const px = z.x + (x - y) * 24 * z.k;
  const py = z.y + (x + y) * 12 * z.k - alt * z.k;
  return { left: (px / LARGURA) * 100, top: (py / ALTURA) * 100 };
}

export const C = {
  g0: "#0E1526", g1: "#1B2540", g2: "#2C3A63", az: "#2A4A9E", azl: "#5B8AE8", cz: "#A6B3D2", pp: "#EEF1F8",
  lj: "#DF7234", ljd: "#B4501A", am: "#F2B53F", vd: "#27A06A", vdl: "#7ED9A6", vm: "#E05A4E",
  pa: "#F0C7A0", pb: "#C98F63", pc: "#8A5A3A", md: "#9A6B43", bk: "#07090F", brita: "#B9A27A",
};

export interface OpcHumano {
  x: number;
  y: number;
  dir: Dir;
  t: number;
  shirt: string;
  skin: string;
  hair: string;
  walk?: boolean;
  arm?: Braco;
  seat?: boolean;
  badge?: boolean;
  cap?: boolean;
  vest?: boolean;
  helmet?: boolean;
  prancheta?: boolean;
  z?: number;
}
export interface OpcCaminhao {
  pos: number;
  cen: number;
  ori: "x" | "y";
  tilt: number;
  cargo: number;
  tm: number;
  sat?: number;
  alpha?: number;
  lights?: boolean;
  smoke?: boolean;
}
export interface EstadoBolha {
  col?: string;
  glowA?: number;
  glowC?: string;
  tela?: string;
  glyph?: string;
}
export type LinhaCartao = [string, string, "ok" | "no" | "wait" | "neu"];

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const TAU = 6.2832;
const FONTE = 'Archivo, "Arial Narrow", system-ui, sans-serif';
const FONTE_CORPO = '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

function hash(i: number, j: number): number {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export function criarDesenho(reduce: boolean) {
  let OX = 0;
  let OY = 0;
  let K = 0.8;
  let ZK = 1;
  let SCL = 1;
  let g: CanvasRenderingContext2D;
  const setO = (z: Zona): void => {
    OX = z.x;
    OY = z.y;
    K = z.k;
  };

  /* ---------- projeção e primitivas ---------- */
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
  const satc: Record<string, string> = {};
  /** Dessatura uma cor (k=1 igual, k=0 cinza). Tom de obra e figurante. */
  function sat(hex: string, k: number): string {
    const key = `${hex}s${k}`;
    const hit = satc[key];
    if (hit) return hit;
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16;
    const gg = (n >> 8) & 255;
    const b = n & 255;
    const l = 0.3 * r + 0.59 * gg + 0.11 * b;
    const m = (c: number): number => Math.max(0, Math.min(255, Math.round(l + (c - l) * k)));
    const h2 = (v: number): string => (v < 16 ? "0" : "") + v.toString(16);
    return (satc[key] = `#${h2(m(r))}${h2(m(gg))}${h2(m(b))}`);
  }
  const ob = (hex: string): string => sat(hex, 0.85);

  function poly(pts: Pt[], fill: string | null, stroke?: string | null, lw?: number): void {
    const first = pts[0];
    if (!first) return;
    g.beginPath();
    g.moveTo(first[0], first[1]);
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i] as Pt;
      g.lineTo(q[0], q[1]);
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
  function box(x: number, y: number, z: number, w: number, d: number, h: number, col: string, o?: { lift?: number; a?: number; edge?: string | null }): void {
    const lf = o?.lift ?? 0;
    const x1 = x + w;
    const y1 = y + d;
    const zt = z + h;
    const L = [P(x, y1, z + lf), P(x1, y1, z + lf), P(x1, y1, zt + lf), P(x, y1, zt + lf)];
    const R = [P(x1, y, z), P(x1, y1, z + lf), P(x1, y1, zt + lf), P(x1, y, zt)];
    const Tp = [P(x, y, zt), P(x1, y, zt), P(x1, y1, zt + lf), P(x, y1, zt + lf)];
    const ed = o?.edge === undefined ? "rgba(5,8,20,.22)" : o.edge;
    if (o?.a !== undefined) g.globalAlpha = o.a;
    poly(L, sh(col, 0.92), ed);
    poly(R, sh(col, 0.66), ed);
    poly(Tp, sh(col, 1.14), ed);
    if (o?.a !== undefined) g.globalAlpha = 1;
  }
  function glow(p: Pt, r: number, col: string, a?: number): void {
    const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.save();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = (a === undefined ? 1 : a) * g.globalAlpha;
    g.fillStyle = gr;
    g.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
    g.restore();
  }
  function shadowFoot(x: number, y: number, w: number, d: number, off = 0.3): void {
    poly([P(x + off * 0.5, y + off * 0.5, 0), P(x + w + off, y + off * 0.5, 0), P(x + w + off, y + d + off, 0), P(x + off * 0.5, y + d + off, 0)], "rgba(4,7,18,.30)");
  }
  function faceText(face: "x" | "y", x: number, y: number, z: number, text: string, px: number, col: string, weight = 600): void {
    const p = P(x, y, z);
    g.save();
    g.translate(p[0], p[1]);
    if (face === "y") g.transform(1, 0.5, 0, 1, 0, 0);
    else g.transform(1, -0.5, 0, 1, 0, 0);
    g.font = `${weight} ${px * K}px ${FONTE}`;
    g.fillStyle = col;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
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
  function groundText(text: string, x: number, y: number, size: number, col: string): void {
    const p = P(x, y, 0);
    g.save();
    g.translate(p[0], p[1]);
    g.transform(24 * K, 12 * K, -24 * K, 12 * K, 0, 0);
    g.font = `800 ${size}px ${FONTE}`;
    g.fillStyle = col;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 0, 0);
    g.restore();
  }
  const gq = (x0: number, y0: number, x1: number, y1: number, col: string | null, stroke?: string | null, lw?: number): void =>
    poly([P(x0, y0, 0), P(x1, y0, 0), P(x1, y1, 0), P(x0, y1, 0)], col, stroke, lw);
  function ellipse(p: Pt, rx: number, ry: number, fill: string): void {
    g.beginPath();
    g.ellipse(p[0], p[1], rx, ry, 0, 0, TAU);
    g.fillStyle = fill;
    g.fill();
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
  /** Etiqueta em coordenada de tela. */
  function tagS(sx: number, sy: number, txt: string, col: string, bg?: string): void {
    g.font = `700 10.5px ${FONTE}`;
    const w = g.measureText(txt).width + 12;
    g.fillStyle = bg ?? "rgba(10,15,30,.92)";
    roundRect(sx - w / 2, sy - 8, w, 15, 4);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#EEF1F8";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillText(txt, sx, sy + 3);
    g.textAlign = "left";
  }
  const tag = (x: number, y: number, z: number, txt: string, col: string, bg?: string): void => {
    const p = P(x, y, z);
    tagS(p[0], p[1], txt, col, bg);
  };

  /* ---------- pontos de ligação entre as zonas (tela) ---------- */
  const PT = { bub: [0, 0] as Pt, tor: [0, 0] as Pt, dish: [0, 0] as Pt, slot: [0, 0] as Pt };
  let CAB: Pt[] = [];
  let CABL: number[] = [];
  let CABT = 1;
  function calcularPontos(): void {
    setO(ZO);
    PT.bub = P(9.5, 1.0, 38);
    setO(ZS);
    PT.tor = P(2.77, 6.6, 158);
    PT.dish = P(4.75, 0.35, 76);
    CAB = [P(5.1, 1.23, 0), P(7.05, 1.23, 0)];
    setO(ZE);
    PT.slot = P(0, 7.5, 9);
    CAB.push(P(0, 7.5, 0));
    CABL = [];
    CABT = 0;
    for (let i = 0; i < CAB.length - 1; i++) {
      const a = CAB[i] as Pt;
      const b = CAB[i + 1] as Pt;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      CABL.push(l);
      CABT += l;
    }
  }
  /** 0 = servidor, 1 = tomada na parede do escritório. */
  function cabPos(u: number): Pt {
    let d = clamp01(u) * CABT;
    for (let q = 0; q < CABL.length; q++) {
      const lq = CABL[q] as number;
      if (d <= lq) {
        const f = d / lq;
        const a = CAB[q] as Pt;
        const b = CAB[q + 1] as Pt;
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - 3];
      }
      d -= lq;
    }
    const e = CAB[CAB.length - 1] as Pt;
    return [e[0], e[1] - 3];
  }

  /* ---------- camadas estáticas ---------- */
  function clipZona(x0: number, x1: number): void {
    g.save();
    roundRect(x0, 0, x1 - x0, ALTURA, 10);
    g.clip();
  }
  function ceu(): void {
    const sk = g.createLinearGradient(0, 0, 0, 112);
    sk.addColorStop(0, "#2B3C6B");
    sk.addColorStop(0.55, "#8C7A78");
    sk.addColorStop(1, "#D9A25F");
    g.fillStyle = sk;
    g.fillRect(0, 0, OBRA_FIM, 114);
    glow([430, 100], 120, "rgba(255,200,120,.55)", 0.8);
    g.fillStyle = "#243158";
    g.beginPath();
    g.moveTo(0, 114);
    g.lineTo(0, 90);
    g.bezierCurveTo(40, 70, 90, 96, 140, 88);
    g.bezierCurveTo(190, 78, 230, 100, 290, 92);
    g.bezierCurveTo(350, 84, 400, 70, 460, 86);
    g.bezierCurveTo(490, 92, 510, 84, 528, 90);
    g.lineTo(528, 114);
    g.closePath();
    g.fill();
    // guindaste distante
    g.strokeStyle = "#1b2547";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(88, 112);
    g.lineTo(88, 52);
    g.moveTo(80, 112);
    g.lineTo(80, 52);
    g.moveTo(80, 52);
    g.lineTo(88, 52);
    g.stroke();
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(54, 52);
    g.lineTo(138, 52);
    g.stroke();
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(84, 52);
    g.lineTo(84, 40);
    g.lineTo(54, 52);
    g.moveTo(84, 40);
    g.lineTo(130, 52);
    g.moveTo(54, 52);
    g.lineTo(54, 66);
    g.stroke();
    g.fillStyle = "#1b2547";
    g.fillRect(52, 64, 5, 7);
    g.fillStyle = "#ff6b5c";
    g.fillRect(83, 37, 3, 3);
  }
  function desenharS0(): void {
    g.fillStyle = "#070B17";
    g.fillRect(0, 0, LARGURA, ALTURA);
    // OBRA: céu, morros, terreno distante, rodovia dos fundos
    g.save();
    roundRect(0, 0, OBRA_FIM, ALTURA, 10);
    g.clip();
    ceu();
    const tg = g.createLinearGradient(0, 112, 0, 300);
    tg.addColorStop(0, "#8E7350");
    tg.addColorStop(1, "#8A6A46");
    g.fillStyle = tg;
    g.fillRect(0, 112, OBRA_FIM, ALTURA - 112);
    g.fillStyle = "rgba(217,162,95,.25)";
    g.fillRect(0, 112, OBRA_FIM, 6);
    ([[22, 124], [48, 120], [66, 127], [165, 119], [196, 123], [235, 118], [270, 122]] as Pt[]).forEach((a) => {
      g.fillStyle = "#4a5a3a";
      g.beginPath();
      g.ellipse(a[0], a[1], 9, 8, 0, 0, TAU);
      g.fill();
      g.fillStyle = "#3d4a30";
      g.fillRect(a[0] - 1, a[1] + 4, 2, 6);
    });
    // rodovia dos fundos
    setO(ZO);
    gq(-14, -4.4, 26, -2.6, "#3A4256");
    for (let i = -14; i < 24; i += 2) gq(i, -3.55, i + 1, -3.45, "#E8D9A0");
    gq(-14, -4.4, 26, -4.34, "#59627a");
    gq(-14, -2.66, 26, -2.6, "#59627a");
    g.restore();
    // re-pinta o céu sobre a rodovia que passa do horizonte
    g.save();
    roundRect(0, 0, OBRA_FIM, 114, 10);
    g.clip();
    ceu();
    g.restore();

    // SINAL: faixa neutra
    const sg = g.createLinearGradient(0, 0, 0, ALTURA);
    sg.addColorStop(0, "#0B1226");
    sg.addColorStop(1, "#070B17");
    g.fillStyle = sg;
    g.fillRect(OBRA_FIM, 0, SINAL_FIM - OBRA_FIM, ALTURA);
    g.fillStyle = "#2C3A63";
    for (let gx = 536; gx < SINAL_FIM; gx += 16) for (let gy = 30; gy < ALTURA; gy += 16) g.fillRect(gx, gy, 1.4, 1.4);

    // ESCRITÓRIO: fundo
    g.save();
    roundRect(SINAL_FIM, 0, LARGURA - SINAL_FIM, ALTURA, 10);
    g.clip();
    const og = g.createLinearGradient(0, 0, 0, ALTURA);
    og.addColorStop(0, "#0C1329");
    og.addColorStop(1, "#080D1B");
    g.fillStyle = og;
    g.fillRect(SINAL_FIM, 0, LARGURA - SINAL_FIM, ALTURA);
    g.restore();
  }

  function desenharS1(): void {
    /* ===== OBRA: chão, pista, vaga, tapume ===== */
    g.save();
    roundRect(0, 0, OBRA_FIM, ALTURA, 10);
    g.clip();
    setO(ZO);
    for (let i = 0; i < 22; i++) {
      for (let j = 0; j < 30; j++) {
        const hh = hash(i, j);
        let base = ["#A5845A", "#A18157", "#A98A5F", "#9C7C54"][Math.floor(hh * 4) % 4] as string;
        if (hash(i + 7, j + 3) > 0.93) base = "#977850";
        gq(i, j, i + 1, j + 1, ob(base), ob(base), 0.5);
      }
    }
    for (let s = 0; s < 120; s++) {
      const p = P(hash(s, 3) * 20, hash(s, 9) * 28, 0);
      g.fillStyle = s % 3 ? "rgba(80,58,34,.22)" : "rgba(185,162,122,.28)";
      g.fillRect(p[0], p[1], 2, 1.2);
    }
    // pista de fila (x 1.0–2.6), de y=3.2 pra baixo
    gq(1.0, 3.2, 2.6, 30, "#3A4256");
    gq(0.94, 3.2, 1.0, 30, "#59627a");
    gq(2.6, 3.2, 2.66, 30, "#59627a");
    for (let k = 4; k < 30; k += 1.6) gq(1.76, k, 1.84, k + 0.8, "#E8D9A0");
    // acesso e vaga
    gq(3.6, -4.6, 6.4, 30, "#3A4256");
    gq(3.54, -4.6, 3.6, 30, "#59627a");
    gq(6.4, -4.6, 6.46, 30, "#59627a");
    for (let m = -4; m < 30; m += 1.8) if (m < 3.8 || m > 11.4) gq(4.96, m, 5.04, m + 0.9, "#E8D9A0");
    gq(3.7, 4.2, 6.3, 10.9, "#4a5268");
    poly([P(3.7, 4.2, 0), P(6.3, 4.2, 0), P(6.3, 10.9, 0), P(3.7, 10.9, 0)], null, "#E8D9A0", 2);
    groundText("VAGA", 5.0, 11.9, 1.0, "#E8D9A0");
    [9.0, 13.4, 17.8].forEach((y, n) => {
      groundText(`F${n + 1}`, 1.8, y + 4.0, 0.8, "rgba(232,217,160,.8)");
      gq(1.1, y + 4.55, 2.5, y + 4.6, "rgba(232,217,160,.55)");
    });
    gq(6.8, 2.8, 9.2, 6.2, ob("#8F7550"));
    // tapume com portão em x 3.6–6.4
    const pl = 0.7;
    for (let a = 0; a < 30; a++) {
      box(-0.2, a * pl, 0, 0.2, pl, 32, ob(a % 2 ? "#EEF1F8" : "#DF7234"));
      if (a * pl > 22) break;
    }
    for (let b = 0; b < 40; b++) {
      const bx = b * pl;
      if (bx + pl > 3.55 && bx < 6.45) continue;
      box(bx, -0.2, 0, pl, 0.2, 32, ob(b % 2 ? "#EEF1F8" : "#DF7234"));
    }
    box(3.35, -0.3, 0, 0.25, 0.4, 44, "#2C3A63");
    box(6.4, -0.3, 0, 0.25, 0.4, 44, "#2C3A63");
    faceRect("y", 3.35, 3.6, 0.1, 40, 44, C.am);
    g.restore();
    // luz quente sobre a obra
    g.save();
    roundRect(0, 0, OBRA_FIM, ALTURA, 10);
    g.clip();
    const wl = g.createLinearGradient(528, 100, 0, 480);
    wl.addColorStop(0, "rgba(255,190,110,.10)");
    wl.addColorStop(1, "rgba(255,190,110,0)");
    g.fillStyle = wl;
    g.fillRect(0, 0, OBRA_FIM, ALTURA);
    g.restore();

    /* ===== SINAL: bases e duto ===== */
    setO(ZS);
    gq(1.7, 5.3, 4.0, 7.9, "#121b38", "#2C3A63", 1);
    gq(2.0, 5.6, 3.7, 7.6, null, "rgba(91,138,232,.35)", 1);
    gq(1.9, -1.4, 5.5, 1.6, "#121b38", "#2C3A63", 1);
    shadowFoot(2.4, -0.77, 2.7, 2.0, 0.5);
    // duto subterrâneo (vai até a parede do escritório)
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    CAB.forEach((c, i) => (i ? g.lineTo(c[0], c[1]) : g.moveTo(c[0], c[1])));
    g.strokeStyle = "#05080f";
    g.lineWidth = 9;
    g.stroke();
    g.strokeStyle = "#1B2A52";
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = "#2A4A9E";
    g.lineWidth = 2;
    g.stroke();

    /* ===== ESCRITÓRIO: laje, piso, paredes ===== */
    setO(ZE);
    const GW = 12;
    const GD = 10;
    poly([P(0, GD, 0), P(GW, GD, 0), P(GW, GD, -10), P(0, GD, -10)], "#0B1226");
    poly([P(GW, 0, 0), P(GW, GD, 0), P(GW, GD, -10), P(GW, 0, -10)], "#080D1D");
    poly([P(0, GD, 0), P(GW, GD, 0), P(GW, GD, -3), P(0, GD, -3)], "#243158");
    for (let ii = 0; ii < GW; ii++) {
      for (let jj = 0; jj < GD; jj++) {
        let col = (ii + jj) % 2 ? "#41538A" : "#3A4A7E";
        if (ii >= 3 && ii <= 7 && jj >= 0 && jj <= 7) col = (ii + jj) % 2 ? "#334173" : "#2F3C6C";
        gq(ii, jj, ii + 1, jj + 1, col, "rgba(255,255,255,.035)", 0.6);
      }
    }
    gq(3.1, 0.1, 7.9, 7.9, null, "rgba(223,114,52,.55)", 1.4);
    box(0, -0.4, 0, GW, 0.4, 96, "#1E2A4D", { edge: "rgba(5,8,20,.3)" });
    box(-0.4, 0, 0, 0.4, GD, 96, "#1E2A4D", { edge: "rgba(5,8,20,.3)" });
    faceRect("y", 0, GW, 0, 0, 10, "#141C36");
    faceRect("y", 0, GW, 0, 10, 11, "rgba(223,114,52,.8)");
    faceRect("x", 0, GD, 0, 0, 10, "#141C36");
    faceRect("x", 0, GD, 0, 10, 11, "rgba(223,114,52,.8)");
    faceRect("x", 2.6, 4.6, 0, 40, 84, "#35508F", "rgba(255,255,255,.25)");
    faceRect("x", 2.68, 4.52, 0, 44, 80, "#5B8AE8");
    faceRect("x", 3.58, 3.62, 0, 40, 84, "#35508F");
    poly([P(0, 2.6, 0), P(0, 4.6, 0), P(1.8, 5.4, 0), P(1.8, 3.4, 0)], "rgba(120,160,255,.08)");
    faceRect("x", 7.1, 7.9, 0, 0, 16, "#0A0F1E", "#5B8AE8");
    faceRect("x", 7.2, 7.8, 0, 2, 12, "#16316b");
    ([[1.5, 6, 2, 2, 0.3], [4, 5, 2, 2, 0.3], [4, 2, 2, 2, 0.3], [8, 0.2, 3, 1.1, 0.4], [8.6, 3, 1.4, 1.4, 0.3], [8.6, 5.4, 1.4, 1.4, 0.3], [6.8, 7.6, 4.2, 2, 0.5], [0.9, 8.7, 3, 1.2, 0.4], [0.7, 3.6, 1.0, 0.9, 0.3]] as [number, number, number, number, number][]).forEach(
      (s) => shadowFoot(s[0], s[1], s[2], s[3], s[4]),
    );
  }

  /* ---------- pessoas ---------- */
  function humano(o: OpcHumano): void {
    const z = ZK;
    ZK = 1.05;
    corpo(o);
    ZK = z;
  }
  function corpo(o: OpcHumano): void {
    const { x, y, dir } = o;
    let z0 = o.z ?? 0;
    const ax = dir === "px" || dir === "mx";
    const fx = dir === "px" ? 1 : dir === "mx" ? -1 : 0;
    const fy = dir === "py" ? 1 : dir === "my" ? -1 : 0;
    const sw = o.walk ? Math.sin(o.t * 10) : 0;
    const bob = o.walk ? Math.abs(sw) * 1.6 : 0;
    ellipse(P(x, y, z0), 10, 4.5, "rgba(4,7,18,.38)");
    const lo = 0.07;
    let zs = 0;
    if (o.seat) {
      zs = -3;
      [-1, 1].forEach((sd) => {
        const lx = ax ? 0 : sd * lo;
        const ly = ax ? sd * lo : 0;
        box(x + lx - 0.045 + fx * 0.1, y + ly - 0.045 + fy * 0.1, z0 + 8, 0.09 + Math.abs(fx) * 0.16, 0.09 + Math.abs(fy) * 0.16, 3, "#232F58");
        box(x + lx - 0.045 + fx * 0.25, y + ly - 0.045 + fy * 0.25, z0, 0.09, 0.09, 8, "#232F58");
        box(x + lx - 0.055 + fx * 0.25, y + ly - 0.055 + fy * 0.25, z0, 0.11, 0.11, 2.5, C.bk);
      });
    } else {
      const l1: Pt = ax ? [x + fx * sw * 0.12 - 0.045, y - lo - 0.045] : [x - lo - 0.045, y + fy * sw * 0.12 - 0.045];
      const l2: Pt = ax ? [x - fx * sw * 0.12 - 0.045, y + lo - 0.045] : [x + lo - 0.045, y - fy * sw * 0.12 - 0.045];
      [l1, l2].sort((a, b) => a[0] + a[1] - (b[0] + b[1])).forEach((l) => {
        box(l[0], l[1], z0, 0.09, 0.09, 11, "#232F58");
        box(l[0] - 0.01, l[1] - 0.01, z0, 0.11, 0.11, 3, C.bk);
      });
    }
    z0 += zs;
    const tw = ax ? 0.14 : 0.27;
    const td = ax ? 0.27 : 0.14;
    box(x - tw / 2, y - td / 2, z0 + 11 + bob, tw, td, 14, o.shirt);
    if (o.vest) {
      box(x - tw / 2 - 0.014, y - td / 2 - 0.014, z0 + 12 + bob, tw + 0.028, td + 0.028, 12.5, "#FFC93C", { edge: "rgba(5,8,20,.3)" });
      box(x - tw / 2 - 0.02, y - td / 2 - 0.02, z0 + 15 + bob, tw + 0.04, td + 0.04, 1.7, "#EEF1F8", { edge: null });
      box(x - tw / 2 - 0.02, y - td / 2 - 0.02, z0 + 20 + bob, tw + 0.04, td + 0.04, 1.7, "#EEF1F8", { edge: null });
    }
    const arm = o.arm;
    const arm1 = (side: number): void => {
      const ox = ax ? 0 : side * (tw / 2 + 0.035);
      const oy = ax ? side * (td / 2 + 0.035) : 0;
      const up = (arm === "up" && side === 1) || arm === "up2";
      const front = (arm === "front" && side === 1) || arm === "both";
      if (up) {
        box(x + ox - 0.035, y + oy - 0.035, z0 + 15 + bob, 0.07, 0.07, 16, o.shirt);
        box(x + ox - 0.04, y + oy - 0.04, z0 + 29 + bob, 0.08, 0.08, 3, o.skin);
      } else if (front) {
        box(x + ox - 0.035 + fx * 0.09, y + oy - 0.035 + fy * 0.09, z0 + 17 + bob, 0.07 + Math.abs(fx) * 0.16, 0.07 + Math.abs(fy) * 0.16, 4, o.shirt);
        box(x + ox - 0.04 + fx * 0.26, y + oy - 0.04 + fy * 0.26, z0 + 17 + bob, 0.08, 0.08, 4, o.skin);
      } else box(x + ox - 0.035, y + oy - 0.035, z0 + 13 + bob, 0.07, 0.07, 12, o.shirt);
    };
    [-1, 1].sort((a, b) => (ax ? a - b : b - a)).forEach(arm1);
    if (o.badge) {
      const bp = ax ? P(x + fx * (tw / 2 + 0.01), y + 0.05, z0 + 20 + bob) : P(x + 0.05, y + fy * (td / 2 + 0.01), z0 + 20 + bob);
      if (fx > 0 || fy > 0) {
        g.fillStyle = C.lj;
        g.fillRect(bp[0] - 1.5, bp[1] - 1.5, 3.5, 3.5);
      }
    }
    box(x - 0.1, y - 0.1, z0 + 25 + bob, 0.2, 0.2, 9, o.skin);
    box(x - 0.108, y - 0.108, z0 + 31 + bob, 0.216, 0.216, 4.5, o.hair);
    if (o.cap) {
      box(x - 0.112, y - 0.112, z0 + 32 + bob, 0.224, 0.224, 3, C.lj);
      box(x + fx * 0.12 - 0.08, y + fy * 0.12 - 0.08, z0 + 32 + bob, 0.16, 0.16, 1.2, C.ljd);
    }
    if (o.helmet) {
      box(x - 0.125, y - 0.125, z0 + 31.5 + bob, 0.25, 0.25, 5.5, "#EEF1F8");
      box(x - 0.14, y - 0.14, z0 + 31.5 + bob, 0.28, 0.28, 1.2, "#d4dbeb");
    }
    g.fillStyle = C.bk;
    if (fx > 0) {
      const e1 = P(x + 0.1, y - 0.05, z0 + 28.5 + bob);
      const e2 = P(x + 0.1, y + 0.05, z0 + 28.5 + bob);
      g.fillRect(e1[0] - 1, e1[1] - 1, 2, 2.4);
      g.fillRect(e2[0] - 1, e2[1] - 1, 2, 2.4);
    }
    if (fy > 0) {
      const f1 = P(x - 0.05, y + 0.1, z0 + 28.5 + bob);
      const f2 = P(x + 0.05, y + 0.1, z0 + 28.5 + bob);
      g.fillRect(f1[0] - 1, f1[1] - 1, 2, 2.4);
      g.fillRect(f2[0] - 1, f2[1] - 1, 2, 2.4);
    }
    if (o.prancheta) {
      const hx = x + fx * 0.3 + (ax ? 0 : 0.12);
      const hy = y + fy * 0.3 + (ax ? 0.12 : 0);
      box(hx - 0.13, hy - 0.17, z0 + 18 + bob, 0.26, 0.34, 1.2, "#6E5336");
      box(hx - 0.11, hy - 0.15, z0 + 19.2 + bob, 0.22, 0.3, 0.5, "#EEF1F8");
    }
  }

  /* ---------- caminhão ---------- */
  function caminhao(o: OpcCaminhao): void {
    const zk = ZK;
    ZK = 1.15;
    const s = o.sat ?? 1;
    const lift = o.tilt * 52;
    const w = 1.5;
    const cabL = 1.15;
    const bs = 1.25;
    const bl = 3.55;
    const ori = o.ori;
    const cc = (h: string): string => (s === 1 ? h : sat(h, s));
    const B = (l0: number, c0: number, z: number, ll: number, cw: number, h: number, col: string, op?: { lift?: number; a?: number; edge?: string | null }): void => {
      if (ori === "y") box(o.cen - w / 2 + c0, o.pos + l0, z, cw, ll, h, cc(col), op);
      else box(o.pos - l0 - ll, o.cen - w / 2 + c0, z, ll, cw, h, cc(col), op);
    };
    const SF = (l0: number, l1: number, z0: number, z1: number, col: string, st?: string): void => {
      if (ori === "y") faceRect("x", o.pos + l0, o.pos + l1, o.cen + w / 2 + 0.005, z0, z1, cc(col), st);
      else faceRect("y", o.pos - l1, o.pos - l0, o.cen + w / 2 + 0.005, z0, z1, cc(col), st);
    };
    const gp = (l: number, c: number, z: number): Pt => (ori === "y" ? P(o.cen - w / 2 + c, o.pos + l, z) : P(o.pos - l, o.cen - w / 2 + c, z));
    g.save();
    if (o.alpha !== undefined) g.globalAlpha = o.alpha;
    poly([gp(-0.05, 0, 0), gp(-0.05, w, 0), gp(bs + bl + 0.2, w, 0), gp(bs + bl + 0.2, 0, 0)], "rgba(4,7,18,.32)");
    [0.4, 2.15, 2.9, 4.2].forEach((l) => {
      B(l - 0.17, -0.04, 0, 0.34, 0.2, 11, "#0b1020");
      B(l - 0.17, w - 0.16, 0, 0.34, 0.2, 11, "#0b1020");
    });
    B(0.1, 0.1, 8, cabL + 0.15 + bl, w - 0.2, 5, "#10182f");
    B(0, 0, 11, cabL, w, 17, C.lj);
    B(0.05, 0, 28, cabL - 0.1, w, 15, C.lj);
    SF(0.12, 0.62, 31, 41, "#9CC0FF", "rgba(255,255,255,.3)");
    SF(0.7, 1.02, 14, 26, C.ljd);
    B(-0.1, 0.05, 11, 0.12, w - 0.1, 9, "#10182f");
    B(-0.02, 0.2, 12, 0.06, 0.3, 4, C.am);
    B(bs - 0.04, -0.04, 13, bl, w + 0.08, 4, "#7a3510", { lift });
    B(bs - 0.04, -0.04, 17, bl, 0.1, 16, C.lj, { lift });
    B(bs - 0.04, w - 0.06, 17, bl, 0.1, 16, C.lj, { lift });
    B(bs - 0.04, -0.04, 17, 0.1, w + 0.08, 16, C.ljd);
    if (o.cargo > 0.02) B(bs + 0.06, 0.04, 17, bl - 0.2, w - 0.1, 11 * o.cargo + 1, C.brita, { lift });
    B(bs + bl - 0.1, -0.05, 17 + lift, 0.1, w + 0.1, 16, C.ljd);
    if (o.tilt < 0.05) {
      SF(bs, bs + bl, 24, 27, "#EEF1F8");
      if (ori === "y") faceRect("y", o.cen - 0.5, o.cen + 0.5, o.pos + bs + bl, 20, 23, "#E05A4E");
    }
    if (o.lights) {
      glow(gp(-0.1, 0.3, 17), 30, "rgba(255,230,150,.55)", 0.9);
      glow(gp(-0.1, 1.2, 17), 22, "rgba(255,230,150,.4)", 0.8);
    }
    if (o.smoke && !reduce) {
      for (let k = 0; k < 4; k++) {
        const u = (o.tm * 0.7 + k / 4) % 1;
        const sp = gp(0.9, w - 0.1, 46 + u * 22);
        g.beginPath();
        g.arc(sp[0] - u * 8, sp[1], 2.4 + u * 4, 0, TAU);
        g.fillStyle = `rgba(166,179,210,${(0.5 - u * 0.45).toFixed(2)})`;
        g.fill();
      }
    }
    g.restore();
    ZK = zk;
  }

  /* ---------- objetos da OBRA ---------- */
  function guarita(): void {
    const x = 7;
    const y = 3;
    const w = 2;
    const d = 2;
    shadowFoot(x, y, w, d, 0.5);
    box(x, y, 0, w, d, 34, ob("#C9D3EA"));
    box(x - 0.2, y - 0.2, 34, w + 0.4, d + 0.4, 4, ob("#DF7234"));
    faceRect("y", x + 0.15, x + 0.95, y + d, 12, 27, "#F6D98B", "rgba(60,40,10,.5)");
    faceRect("x", y + 0.3, y + 1.3, x + w, 12, 27, "#F6D98B", "rgba(60,40,10,.5)");
    faceRect("y", x + 1.25, x + 1.8, y + d, 0, 25, ob("#6E5336"), "rgba(0,0,0,.3)");
    faceText("y", x + 0.12, y + d + 0.01, 31, "CONFERÊNCIA", 5.6, "#07090F", 800);
    glow(P(x + 0.55, y + d, 20), 36, "rgba(255,214,120,.55)", 0.9);
    glow(P(x + w, y + 0.8, 20), 30, "rgba(255,214,120,.4)", 0.8);
    const lp = P(x + 1.6, y + d + 0.18, 33);
    g.fillStyle = "#ffe9a8";
    g.fillRect(lp[0] - 2, lp[1] - 1, 4, 3);
    glow(lp, 26, "rgba(255,220,130,.6)", 0.8);
  }
  function mesinha(): void {
    [[9.2, 4.3], [10.0, 4.3], [9.2, 4.9], [10.0, 4.9]].forEach((p) => box(p[0] as number, p[1] as number, 0, 0.1, 0.1, 10, "#3a2a22"));
    box(9.1, 4.2, 10, 1.1, 0.9, 2, ob(C.md));
    box(9.3, 4.4, 12, 0.4, 0.5, 0.6, "#EEF1F8");
    box(9.8, 4.5, 12, 0.25, 0.3, 3, "#DF7234");
  }
  function monte(m: number): void {
    const s = 0.22 + 0.78 * clamp01(m);
    const cx = 5.0;
    const cy = 10.95;
    let z = 0;
    shadowFoot(cx - 1.15 * s, cy - 0.95 * s, 2.3 * s, 1.9 * s, 0.3);
    const aHex = (hex: string, f: number): string => {
      const n = parseInt(hex.slice(1), 16);
      const h2 = (v: number): string => (v < 16 ? "0" : "") + Math.min(255, Math.round(v * f)).toString(16);
      return `#${h2(n >> 16)}${h2((n >> 8) & 255)}${h2(n & 255)}`;
    };
    ([[2.3, 1.9, 9, 0.96], [1.7, 1.4, 8, 1.04], [1.15, 0.95, 7, 1.1], [0.6, 0.5, 5, 1.2]] as [number, number, number, number][]).forEach((a) => {
      box(cx - (a[0] * s) / 2, cy - (a[1] * s) / 2, z, a[0] * s, a[1] * s, a[2] * s, aHex(ob(C.brita), a[3]), { edge: "rgba(60,45,20,.25)" });
      z += a[2] * s;
    });
  }
  function betoneira(tm: number): void {
    const x = 0.9;
    const y = 0.5;
    shadowFoot(x, y, 1.8, 1.4, 0.4);
    box(x + 0.1, y + 0.3, 0, 1.5, 0.9, 4, "#4a3a2a");
    box(x + 0.2, y + 0.35, 4, 0.12, 0.8, 12, "#2C3A63");
    box(x + 1.2, y + 0.35, 4, 0.12, 0.8, 12, "#2C3A63");
    const p = P(x + 0.9, y + 0.75, 24);
    g.save();
    g.translate(p[0], p[1]);
    g.rotate(-0.55);
    g.beginPath();
    g.ellipse(0, 0, 11, 15, 0, 0, TAU);
    g.fillStyle = ob("#DF7234");
    g.fill();
    g.strokeStyle = "rgba(0,0,0,.35)";
    g.lineWidth = 1;
    g.stroke();
    g.clip();
    g.strokeStyle = "rgba(238,241,248,.75)";
    g.lineWidth = 2.4;
    const off = (tm * 14) % 10;
    for (let i = -3; i < 5; i++) {
      g.beginPath();
      g.moveTo(-14, -16 + i * 10 + off);
      g.lineTo(14, -8 + i * 10 + off);
      g.stroke();
    }
    g.restore();
    g.beginPath();
    g.ellipse(p[0] + 3, p[1] - 12, 5, 3, -0.55, 0, TAU);
    g.fillStyle = "#6a2f0e";
    g.fill();
  }
  function coneTrafego(x: number, y: number): void {
    box(x - 0.12, y - 0.12, 0, 0.24, 0.24, 2, "#10182f");
    box(x - 0.08, y - 0.08, 2, 0.16, 0.16, 10, C.lj);
    box(x - 0.05, y - 0.05, 8, 0.1, 0.1, 2, C.pp);
  }
  function cones(): void {
    ([[3.45, 11.4], [6.55, 11.4], [3.45, 4.0], [6.55, 4.0]] as Pt[]).forEach((c) => coneTrafego(c[0], c[1]));
  }
  function container(): void {
    const x = 9.2;
    const y = 12.4;
    shadowFoot(x, y, 2.6, 1.2, 0.4);
    box(x, y, 0, 2.6, 1.2, 30, ob("#2A4A9E"));
    box(x - 0.03, y - 0.03, 30, 2.66, 1.26, 2, ob("#1B2540"));
    for (let i = 0; i < 6; i++) faceRect("y", x + 0.12 + i * 0.4, x + 0.12 + i * 0.4 + 0.22, y + 1.2, 3, 27, ob("#24409A"));
    faceRect("y", x + 0.2, x + 1.0, y + 1.2, 12, 24, "#F6D98B", "rgba(60,40,10,.5)");
    faceText("x", y + 0.15, x + 2.6, 24, "MOVATRUCK", 5, "#EEF1F8", 800);
  }
  function tubos(): void {
    const x = 9.6;
    const y = 5.9;
    shadowFoot(x, y, 1.3, 1.1, 0.3);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) box(x + c * 0.4 + r * 0.2, y, r * 6, 0.36, 1.1, 5.6, ob("#6a7596"));
  }
  function torreLuz(): void {
    const x = 10.2;
    const y = 3.0;
    box(x - 0.06, y - 0.06, 0, 0.12, 0.12, 54, "#10182f");
    box(x - 0.3, y - 0.2, 54, 0.6, 0.4, 6, "#1B2540");
    glow(P(x, y + 0.2, 55), 40, "rgba(255,224,150,.5)", 0.8);
  }
  function palete(): void {
    box(9.3, 7.4, 0, 1.4, 1.0, 3, "#6E5336");
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) box(9.35 + i * 0.45, 7.45 + j * 0.45, 3, 0.4, 0.4, 4, ob("#B9A27A"));
    box(9.45, 7.5, 7, 0.4, 0.4, 4, ob("#B9A27A"));
    box(10.0, 7.9, 7, 0.4, 0.4, 4, ob("#B9A27A"));
    ([[9.6, 9.0], [10.2, 9.3]] as Pt[]).forEach((b) => {
      box(b[0], b[1], 0, 0.4, 0.4, 16, ob("#DF7234"));
      box(b[0] - 0.01, b[1] - 0.01, 6, 0.42, 0.42, 1.2, ob("#EEF1F8"));
    });
  }
  /** ph < 0: parada (ocioso). 0..1: ciclo de escavação. */
  function retro(tm: number, ph: number): void {
    const x = 7.2;
    const y = 10.2;
    shadowFoot(x, y, 2.0, 1.2, 0.4);
    ([[x + 0.2, y - 0.12], [x + 1.4, y - 0.12], [x + 0.2, y + 1.0], [x + 1.4, y + 1.0]] as Pt[]).forEach((w) => box(w[0], w[1], 0, 0.4, 0.14, 10, "#10182f"));
    box(x, y, 3, 2.0, 1.2, 8, ob("#E0A52F"));
    box(x + 1.15, y + 0.1, 11, 0.8, 0.9, 22, ob("#E0A52F"));
    faceRect("x", y + 0.2, y + 0.9, x + 1.95, 18, 30, "#9CC0FF", "rgba(255,255,255,.3)");
    box(x + 1.1, y + 0.05, 33, 0.9, 1.0, 2, "#10182f");
    const pv = P(x + 0.1, y + 0.6, 20);
    const R = P(x - 0.75, y + 0.6, 20);
    const D = P(x - 1.45, y + 0.6, 6);
    let bk: Pt;
    if (ph < 0) bk = [R[0] + (reduce ? 0 : Math.sin(tm * 0.8) * 0.8), R[1] + (reduce ? 0 : Math.sin(tm * 0.6) * 1.2)];
    else if (ph < 0.35) {
      const e = ph / 0.35;
      bk = [lerp(R[0], D[0], e), lerp(R[1], D[1], e)];
    } else if (ph < 0.6) {
      const e2 = (ph - 0.35) / 0.25;
      bk = [D[0] + 6 * e2, D[1] + 3 * e2];
    } else {
      const e3 = (ph - 0.6) / 0.4;
      bk = [D[0] + 6 + (R[0] - D[0] - 6) * e3, D[1] + 3 + (R[1] - D[1] - 3) * e3 - 6 * Math.sin(e3 * Math.PI)];
    }
    const el: Pt = [(pv[0] + bk[0]) / 2 - 2, Math.min(pv[1], bk[1]) - 18];
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#8f6a1c";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(pv[0], pv[1]);
    g.lineTo(el[0], el[1]);
    g.lineTo(bk[0], bk[1]);
    g.stroke();
    g.strokeStyle = ob("#E0A52F");
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#4a3a2a";
    g.beginPath();
    g.moveTo(bk[0] - 6, bk[1] - 3);
    g.lineTo(bk[0] + 4, bk[1] - 5);
    g.lineTo(bk[0] + 5, bk[1] + 5);
    g.lineTo(bk[0] - 7, bk[1] + 4);
    g.closePath();
    g.fill();
    // poeira quando a caçamba toca o chão
    if (ph >= 0.3 && ph < 0.7 && !reduce) {
      const u = (ph - 0.3) / 0.4;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(D[0] + 2 + k * 5 - u * 4, D[1] + 4 - u * 10 - k * 2, 2.5 + u * 5, 0, TAU);
        g.fillStyle = `rgba(190,165,125,${(0.34 - u * 0.3).toFixed(2)})`;
        g.fill();
      }
    }
  }
  function bolha(st: EstadoBolha, tm: number): void {
    const bx = 9.5;
    const by = 1.0;
    const gp = P(bx, by, 0);
    ellipse([gp[0], gp[1] + 1], 14, 6, "rgba(4,7,18,.35)");
    g.beginPath();
    g.ellipse(gp[0], gp[1], 12, 5.5, 0, 0, TAU);
    g.strokeStyle = st.col ?? "rgba(166,179,210,.5)";
    g.lineWidth = 1.6;
    g.stroke();
    const p = P(bx, by, 36 + (reduce ? 0 : Math.sin(tm * 2) * 1.6));
    if ((st.glowA ?? 0) > 0) glow(p, 34, st.glowC ?? "rgba(91,138,232,.8)", st.glowA);
    g.fillStyle = "rgba(10,15,30,.94)";
    roundRect(p[0] - 17, p[1] - 22, 34, 44, 8);
    g.fill();
    g.strokeStyle = st.col ?? "#A6B3D2";
    g.lineWidth = 1.6;
    g.stroke();
    g.beginPath();
    g.moveTo(p[0] - 4, p[1] + 21);
    g.lineTo(p[0], p[1] + 28);
    g.lineTo(p[0] + 4, p[1] + 21);
    g.fillStyle = "rgba(10,15,30,.94)";
    g.fill();
    g.fillStyle = st.tela ?? "#1B2A52";
    roundRect(p[0] - 11, p[1] - 17, 22, 30, 3);
    g.fill();
    g.fillStyle = "#EEF1F8";
    g.font = `800 17px ${FONTE}`;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    if (st.glyph) g.fillText(st.glyph, p[0], p[1] + 5);
    else {
      g.fillStyle = "rgba(166,179,210,.55)";
      g.fillRect(p[0] - 6, p[1] - 10, 12, 2);
      g.fillRect(p[0] - 6, p[1] - 5, 9, 2);
      g.fillRect(p[0] - 6, p[1], 11, 2);
    }
    g.textAlign = "left";
    g.fillStyle = "#0b1226";
    g.fillRect(p[0] - 3, p[1] + 14, 6, 2);
  }
  function nuvens(tm: number, lista: [number, number, number][]): void {
    lista.forEach((c) => {
      const cx = ((c[0] + tm * 3 * c[2]) % 680) - 80;
      g.fillStyle = "rgba(255,230,200,.35)";
      g.beginPath();
      g.ellipse(cx, c[1], 34, 7, 0, 0, TAU);
      g.ellipse(cx + 16, c[1] - 5, 20, 7, 0, 0, TAU);
      g.ellipse(cx - 14, c[1] + 1, 18, 5, 0, 0, TAU);
      g.fill();
    });
  }

  /* ---------- objetos do SINAL ---------- */
  function torre(tm: number, flash: boolean): void {
    const bx = 2.77;
    const by = 6.6;
    const tp = 150;
    const hw = 0.34;
    const cs: Pt[] = [[bx - hw, by - hw], [bx + hw, by - hw], [bx + hw, by + hw], [bx - hw, by + hw]];
    const topc: Pt[] = [[bx - 0.05, by - 0.05], [bx + 0.05, by - 0.05], [bx + 0.05, by + 0.05], [bx - 0.05, by + 0.05]];
    g.strokeStyle = "#A6B3D2";
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const c = cs[i] as Pt;
      const t2 = topc[i] as Pt;
      const a = P(c[0], c[1], 0);
      const b = P(t2[0], t2[1], tp);
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
    const on = flash || reduce || Math.floor(tm) % 2 === 0;
    const bp = P(bx, by, tp + 12);
    g.beginPath();
    g.arc(bp[0], bp[1], 3.2, 0, TAU);
    g.fillStyle = on ? "#ff6b5c" : "#6a2a28";
    g.fill();
    if (on) glow(bp, flash ? 46 : 22, "rgba(255,90,76,.8)", flash ? 1 : 0.7);
  }
  function servidor(tm: number, ledP: number, spark: number): void {
    const x0 = 2.4;
    const y0 = -0.77;
    const d = 2.0;
    const rw = 0.85;
    for (let r = 0; r < 3; r++) {
      const x = x0 + r * 0.93;
      box(x, y0, 0, rw, d, 62, "#26335E");
      box(x - 0.04, y0 - 0.04, 62, rw + 0.08, d + 0.08, 3, "#3a4b82");
      faceRect("y", x + 0.07, x + rw - 0.07, y0 + d, 6, 56, "#141c38", "rgba(5,8,20,.4)");
      for (let k = 0; k < 7; k++) {
        const zz = 10 + k * 6.6;
        faceRect("y", x + 0.12, x + rw - 0.12, y0 + d, zz, zz + 4.2, "#1d2850", "rgba(255,255,255,.07)");
        const lit = ledP >= 0 ? (ledP * 3 - r) * 7 > k : false;
        const v = Math.floor(tm * 3 + k * 1.3 + r) % 3;
        const lp = P(x + rw - 0.2, y0 + d, zz + 2.1);
        g.fillStyle = lit ? "#BFE3FF" : v === 0 ? C.vdl : v === 1 ? C.azl : "#3a4b82";
        g.fillRect(lp[0] - 1.4, lp[1] - 1, 2.8, 2.2);
        if (lit) glow(lp, 9, "rgba(160,210,255,.8)", 0.9);
      }
    }
    faceText("y", x0 + 0.18, y0 + d + 0.005, 66, "SERVIDOR", 7, "#EEF1F8", 800);
    const dp = P(x0 + 2.35, y0 + 1.0, 72);
    g.save();
    g.translate(dp[0], dp[1]);
    g.rotate(-0.4);
    g.beginPath();
    g.ellipse(0, 0, 14, 8.5, 0, 0, TAU);
    g.fillStyle = "#d0d8ec";
    g.fill();
    g.strokeStyle = "#7f8cb0";
    g.lineWidth = 1.2;
    g.stroke();
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(5, -11);
    g.strokeStyle = "#A6B3D2";
    g.stroke();
    g.restore();
    box(x0 + 2.3, y0 + 0.95, 62, 0.1, 0.1, 10, "#A6B3D2");
    if (spark > 0) {
      glow(dp, 60, "rgba(120,170,255,.9)", spark);
      for (let q = 0; q < 5; q++) {
        const ang = q * 1.3 + tm * 30;
        g.strokeStyle = `rgba(200,225,255,${spark})`;
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(dp[0] + 4, dp[1] - 10);
        g.lineTo(dp[0] + 4 + Math.cos(ang) * 11, dp[1] - 10 + Math.sin(ang) * 11);
        g.stroke();
      }
    }
    glow(P(x0 + 2.7, y0 + d, 28), 60, "rgba(60,107,200,.28)", 0.7);
  }

  /* ---------- objetos do ESCRITÓRIO ---------- */
  function mesa(x: number, y: number, w: number, d: number, col?: string): void {
    ([[x + 0.08, y + 0.08], [x + w - 0.2, y + 0.08], [x + 0.08, y + d - 0.2], [x + w - 0.2, y + d - 0.2]] as Pt[]).forEach((l) => box(l[0], l[1], 0, 0.12, 0.12, 10, "#3a2a22"));
    box(x, y, 10, w, d, 4, col ?? C.md);
  }
  function papelChato(x: number, y: number, z: number, col?: string, a?: number): void {
    box(x - 0.15, y - 0.19, z, 0.3, 0.38, 1.4, col ?? C.pp, { a });
  }
  /** Plaquetas (etiqueta + número) ficam por cima de tudo: enfileiradas e desenhadas no fim. */
  let plaqPend: [number, number, number, string, string][] = [];
  const plaq = (x: number, y: number, z: number, txt: string, col: string): void => {
    plaqPend.push([x, y, z, txt, col]);
  };
  function descarregarPlaquetas(): void {
    plaqPend.forEach((q) => {
      const p = P(q[0], q[1], q[2]);
      g.font = `800 11px ${FONTE}`;
      const w = g.measureText(q[3]).width + 14;
      g.fillStyle = "#EEF1F8";
      roundRect(p[0] - w / 2, p[1] - 8, w, 15, 3);
      g.fill();
      g.strokeStyle = q[4];
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "#0A0F1E";
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      g.fillText(q[3], p[0], p[1] + 4);
      g.textAlign = "left";
    });
    plaqPend = [];
  }
  /**
   * Papéis de verdade: até 12, um por unidade; acima disso, blocos agrupados
   * (1 bloco = vários papéis) com altura sublinear. O número exato vai na plaqueta.
   */
  function pilhaGrupo(x0: number, y0: number, w: number, d: number, z0: number, n: number, o?: { col?: string; max?: number }): number {
    if (n <= 0) return z0;
    if (n <= 12) {
      for (let i = 0; i < n; i++) papelChato(x0 + w / 2 + (((i * 7) % 3) - 1) * 0.018, y0 + d / 2 + (((i * 5) % 3) - 1) * 0.018, z0 + i * 1.4, i % 2 ? C.pp : "#d4dbeb");
      return z0 + n * 1.4;
    }
    const per = n <= 40 ? 3 : n <= 120 ? 6 : 15;
    const blocks = Math.min(o?.max ?? 30, Math.ceil(n / per));
    const cols = Math.max(1, Math.floor(w / 0.4));
    const rows = Math.max(1, Math.floor(d / 0.5));
    const cells = cols * rows;
    const lv = Math.ceil(blocks / cells);
    let topz = z0;
    const order: Pt[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) order.push([c, r]);
    order.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    const drawn: Pt3[] = [];
    for (let L = 0; L < lv; L++) {
      for (let k = 0; k < cells && L * cells + k < blocks; k++) {
        const oc = order[k] as Pt;
        drawn.push([oc[0], oc[1], L]);
      }
    }
    drawn.sort((a, b) => a[0] + a[1] + a[2] * 0.01 - (b[0] + b[1] + b[2] * 0.01));
    drawn.forEach((q) => {
      const bx = x0 + (w - cols * 0.4) / 2 + q[0] * 0.4 + 0.03 + (((q[0] * 5 + q[1] * 3) % 3) - 1) * 0.012;
      const by = y0 + (d - rows * 0.5) / 2 + q[1] * 0.5 + 0.03;
      const bz = z0 + q[2] * 3.4;
      box(bx, by, bz, 0.34, 0.44, 3.2, (q[0] + q[1] + q[2]) % 2 ? "#EEF1F8" : "#dfe5f3");
      box(bx - 0.012, by + 0.12, bz + 1.0, 0.364, 0.2, 0.8, o?.col ?? "#5B8AE8", { edge: null });
      topz = Math.max(topz, bz + 3.2);
    });
    return topz;
  }
  /** Altura do topo da pilha de `n` papéis sobre `z0` (pra animar o papel que chega e o que sai). */
  function topoPilha(z0: number, n: number): number {
    if (n <= 0) return z0;
    if (n <= 12) return z0 + n * 1.4;
    const per = n <= 40 ? 3 : n <= 120 ? 6 : 15;
    const blocks = Math.min(20, Math.ceil(n / per));
    return z0 + Math.ceil(blocks / 12) * 3.4;
  }
  function monitor(x: number, y: number, on: boolean, glowOn?: string): void {
    box(x - 0.05, y - 0.02, 14, 0.1, 0.08, 3, C.g0);
    box(x - 0.42, y - 0.04, 17, 0.84, 0.07, 15, "#0b1226");
    if (on) {
      glow(P(x, y, 26), 34, glowOn ?? "rgba(91,138,232,.55)", 0.7);
      box(x - 0.38, y - 0.045, 29.5, 0.76, 0.02, 0.6, "#A0C8FF", { edge: null });
    }
  }
  /** Cadeira giratória: recua e gira um pouco quando a pessoa levanta. */
  function cadeira(x: number, y: number, push: number): void {
    const cx = x + push * 0.22;
    const cy = y - 0.3 - push * 0.6;
    box(cx - 0.03, cy - 0.03, 0, 0.06, 0.06, 7, "#10182f");
    box(cx - 0.22, cy - 0.22, 0, 0.44, 0.06, 1.6, "#10182f");
    box(cx - 0.06, cy - 0.22, 0, 0.06, 0.44, 1.6, "#10182f");
    box(cx - 0.22, cy - 0.22, 7, 0.44, 0.44, 3, "#1B2540");
    box(cx - 0.32 - push * 0.08, cy - 0.3 - push * 0.05, 10, 0.64, 0.1, 15, "#2A4A9E");
  }
  function relogioPino(x: number, y: number, z: number, nivel: number, tm: number): void {
    const rim = [C.vd, C.am, C.lj, C.vm][nivel] ?? C.vd;
    const p = P(x, y, z);
    ellipse([p[0], p[1] + 13], 7, 2.6, "rgba(4,7,18,.3)");
    g.fillStyle = "#10182f";
    g.fillRect(p[0] - 1.4, p[1] + 7, 2.8, 7);
    g.beginPath();
    g.arc(p[0], p[1], 12, 0, TAU);
    g.fillStyle = rim;
    g.fill();
    g.beginPath();
    g.arc(p[0], p[1], 9.6, 0, TAU);
    g.fillStyle = "#EEF1F8";
    g.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.fillStyle = "#10182f";
      g.fillRect(p[0] + Math.sin(a) * 7.8 - 0.6, p[1] - Math.cos(a) * 7.8 - 0.6, 1.2, 1.2);
    }
    const ang = tm * (nivel > 0 ? 1.4 : 0.5);
    g.strokeStyle = "#10182f";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + Math.sin(ang) * 7.4, p[1] - Math.cos(ang) * 7.4);
    g.stroke();
    g.lineWidth = 1.9;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(p[0] + Math.sin(ang / 12) * 4.6, p[1] - Math.cos(ang / 12) * 4.6);
    g.stroke();
    if (nivel >= 1) glow(p, 24, nivel === 3 ? "rgba(224,90,78,.55)" : nivel === 2 ? "rgba(223,114,52,.4)" : "rgba(242,181,63,.3)", 0.8);
  }
  function planta(x: number, y: number): void {
    box(x - 0.18, y - 0.18, 0, 0.36, 0.36, 10, C.ljd);
    box(x - 0.06, y - 0.06, 10, 0.12, 0.12, 8, "#1f7a4f");
    box(x - 0.22, y - 0.22, 17, 0.44, 0.44, 8, C.vd);
    box(x - 0.15, y - 0.15, 24, 0.3, 0.3, 7, C.vdl);
    box(x - 0.3, y - 0.1, 15, 0.18, 0.2, 6, C.vd);
    box(x + 0.12, y - 0.12, 14, 0.2, 0.2, 6, C.vd);
  }
  /** Arquivo de 3 gavetas: a de cima abre quando alguém guarda um papel. */
  function arquivo(openIdx: number, openP: number, n: number, lampOn: boolean, rotulo: string): void {
    const x0 = 8;
    const y = 0.2;
    const d = 1.1;
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * 1.0;
      const op = i === openIdx ? openP : 0;
      box(x, y, 0, 0.95, d, 40, "#B7C2DD");
      ([[4, 12], [15, 24], [27, 36]] as Pt[]).forEach((r, ri) => {
        if (ri === 2 && op > 0) return;
        faceRect("y", x + 0.06, x + 0.89, y + d, r[0], r[1], "#C9D3EA", "rgba(5,8,20,.3)");
      });
      for (let h = 0; h < 2; h++) faceRect("y", x + 0.35, x + 0.6, y + d, 8 + h * 11, 9.2 + h * 11, "#3a456b");
      if (op > 0) {
        box(x + 0.08, y + d - 0.02, 26, 0.79, 0.6 * op, 9, "#A9B6D6");
        box(x + 0.12, y + d + 0.05, 34.5, 0.71, 0.5 * op, 1, "#8995B5");
        for (let f = 0; f < 6; f++) box(x + 0.15 + f * 0.11, y + d + 0.06, 29, 0.07, 0.45 * op, 6, f % 2 ? "#7ED9A6" : "#5B8AE8", { edge: null });
      } else faceRect("y", x + 0.35, x + 0.6, y + d, 30, 31.2, "#3a456b");
    }
    box(x0, y, 40, 2.95, d, 1.5, "#8995B5");
    pilhaGrupo(x0 + 0.1, y + 0.05, 2.75, d - 0.1, 41.5, n, { col: "#27A06A", max: 14 });
    plaq(x0 + 1.45, y + 0.4, 58, rotulo, "#27A06A");
    glow(P(x0 + 1.5, y + d, 33), 38, "rgba(126,217,166,.7)", lampOn ? 1 : 0.35);
  }
  function caixaDevolvidas(n: number, pulso: boolean, rotulo: string): void {
    const x = 8.4;
    const y = 5.0;
    const w = 1.9;
    const d = 1.5;
    box(x, y, 0, w, d, 10, C.ljd);
    faceRect("y", x + 0.12, x + w - 0.12, y + d, 3, 7, C.vm);
    faceRect("y", x + 0.12, x + w - 0.12, y + d, 7.2, 8.2, "#EEF1F8");
    pilhaGrupo(x + 0.1, y + 0.1, w - 0.2, d - 0.2, 10.1, n, { col: "#E05A4E", max: 30 });
    plaq(x + w * 0.5, y + d + 0.1, 4, rotulo, "#E05A4E");
    glow(P(x + w / 2, y + d / 2, 14), pulso ? 56 : 30, "rgba(224,90,78,.8)", pulso ? 1 : 0.3);
  }
  function pastaAjustadas(n: number, pulso: boolean, rotulo: string): void {
    const x = 8.6;
    const y = 2.9;
    const w = 1.5;
    const d = 1.2;
    box(x, y, 0, w, d, 6, "#223D80");
    pilhaGrupo(x + 0.08, y + 0.08, w - 0.16, d - 0.16, 6.1, n, { col: "#5B8AE8" });
    plaq(x + w * 0.5, y + d + 0.1, 2, rotulo, "#5B8AE8");
    glow(P(x + w / 2, y + d / 2, 12), pulso ? 50 : 24, "rgba(91,138,232,.8)", pulso ? 1 : 0.25);
  }
  /** Bandeja neutra: o que o agente não aprovou nem parou (segue o fluxo normal). Sem número. */
  function bandejaNeutra(n: number, rotulo: string): void {
    const x = 0.7;
    const y = 3.6;
    const w = 1.0;
    const d = 0.9;
    box(x, y, 0, w, d, 5, "#6b7aa6");
    box(x + 0.06, y + 0.06, 5, w - 0.12, d - 0.12, 0.1, "#1a2036", { edge: null });
    pilhaGrupo(x + 0.1, y + 0.1, w - 0.2, d - 0.2, 5.2, n, { col: "#8190B5" });
    plaq(x + w * 0.5 + 0.2, y + d + 0.7, 2, rotulo, "#8190B5");
  }
  /** O balcão de travadas: o objeto mais importante da cena. Post-its por travada (até 6). */
  function balcao(nT: number, nivel: number, tm: number, anel: boolean, rotulo: string): void {
    const x = 6.8;
    const y = 8.0;
    const w = 4.2;
    const d = 1.9;
    const hot = nT > 0;
    glow(P(x + w / 2, y + d / 2, 6), 150, hot ? "rgba(242,181,63,.34)" : "rgba(242,181,63,.14)", hot ? 0.95 : 0.7);
    box(x, y, 0, w, d, 17, "#7a5236");
    box(x - 0.06, y - 0.06, 17, w + 0.12, d + 0.12, 3, "#B88455");
    faceRect("y", x + 0.1, x + w - 0.1, y + d, 2.5, 13.5, "#4b3322");
    const postCols = [C.am, C.am, "#ff8a3d", C.vm];
    const post = postCols[nivel] ?? C.am;
    for (let i = 0; i < Math.min(6, nT); i++) {
      const px = x + 0.5 + i * 0.55;
      const py = y + 0.85;
      papelChato(px, py, 20, C.pp);
      papelChato(px + 0.02, py, 21.4, "#d4dbeb");
      box(px - 0.11, py - 0.11, 23, 0.22, 0.22, 1.1, post, { edge: "rgba(5,8,20,.3)" });
    }
    if (nT > 6) {
      // acima de 6 papéis: um bloco único agrupado ao lado (a plaqueta guarda o número exato)
      pilhaGrupo(x + 3.4, y + 0.5, 0.6, 0.9, 20, nT - 6, { col: post, max: 6 });
    }
    if (hot && anel && (reduce || Math.floor(tm * 2) % 2 === 0)) {
      poly([P(x - 0.15, y - 0.15, 0), P(x + w + 0.15, y - 0.15, 0), P(x + w + 0.15, y + d + 0.15, 0), P(x - 0.15, y + d + 0.15, 0)], "rgba(242,181,63,.18)", "rgba(242,181,63,.95)", 2);
    }
    plaq(x + w * 0.5, y + d + 0.1, 7, rotulo, "#F2B53F");
    relogioPino(x + 0.45, y + 0.5, 40, nivel, tm);
  }
  function cafeteira(x: number, y: number): void {
    mesa(x - 0.45, y - 0.45, 0.9, 0.9, C.md);
    box(x - 0.25, y - 0.22, 14, 0.5, 0.44, 20, "#2b3763");
    box(x - 0.1, y + 0.1, 20, 0.2, 0.12, 3, C.lj);
    box(x - 0.06, y - 0.1, 14, 0.12, 0.12, 6, C.pp);
  }
  /** Painel da parede: título, barras e o estado do robô (texto real, nunca inventado). */
  function parede(tm: number, ativo: boolean, robo: { texto: string; cor: string }): void {
    setO(ZE);
    const x0 = 0.6;
    const x1 = 7.3;
    const z0 = 34;
    const z1 = 84;
    faceRect("y", x0 - 0.1, x1 + 0.1, 0, z0 - 3, z1 + 3, "#0b1226", "rgba(91,138,232,.8)");
    faceRect("y", x0, x1, 0, z0, z1, "#0f1a38");
    glow(P((x0 + x1) / 2, 0.3, (z0 + z1) / 2), 150, "rgba(60,107,200,.26)", 0.9);
    faceText("y", x0 + 0.2, 0, z1 - 10, "MOVATRUCK · CONFERÊNCIA", 7, "#A6B3D2", 600);
    faceText("y", x0 + 0.2, 0, z0 + 8, robo.texto, 6.6, robo.cor, 800);
    for (let b = 0; b < 30; b++) {
      const hh = 3 + ((Math.sin(b * 1.3 + 2) + 1) * 4.2 + (b === 29 && !reduce ? Math.sin(tm * 2) * 1.2 + 1.2 : 0));
      faceRect("y", x0 + 0.2 + b * 0.2, x0 + 0.2 + b * 0.2 + 0.13, 0, z0 + 19, z0 + 19 + hh * (ativo ? 1.2 : 0.8), b % 5 === 4 ? "#F2B53F" : "#2A4A9E");
    }
    const cp = P(11.4, 0, 70);
    g.beginPath();
    g.arc(cp[0], cp[1], 12, 0, TAU);
    g.fillStyle = "#EEF1F8";
    g.fill();
    g.lineWidth = 2.2;
    g.strokeStyle = "#DF7234";
    g.stroke();
    const ang = tm * 0.5;
    g.strokeStyle = "#10182f";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cp[0], cp[1]);
    g.lineTo(cp[0] + Math.sin(ang) * 8, cp[1] - Math.cos(ang) * 8);
    g.stroke();
    g.beginPath();
    g.moveTo(cp[0], cp[1]);
    g.lineTo(cp[0] + Math.sin(ang / 12) * 5, cp[1] - Math.cos(ang / 12) * 5);
    g.stroke();
  }

  /* ---------- sinais e cartões (coordenadas de tela) ---------- */
  const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  const arcPt = (a: Pt, b: Pt, u: number, lift: number): Pt => [lerp(a[0], b[0], u), lerp(b[1], a[1], 1 - u) - 4 * lift * u * (1 - u)];
  const COLS: Record<string, [string, string]> = { b: ["rgba(91,138,232,", "#cfe0ff"], r: ["rgba(224,90,78,", "#ffb1a8"] };
  function pacoteS(p: Pt, col: string, real: boolean, glyph?: string | null): void {
    const cs = COLS[col] ?? (COLS.b as [string, string]);
    glow(p, real ? 32 : 18, cs[0] + (real ? ".95)" : ".6)"), 1);
    g.beginPath();
    g.arc(p[0], p[1], real ? 5 : 3.6, 0, TAU);
    if (real) {
      g.fillStyle = cs[1];
      g.fill();
    } else {
      g.strokeStyle = cs[1];
      g.lineWidth = 1.4;
      g.stroke();
    }
    if (glyph) {
      g.fillStyle = "#EEF1F8";
      g.font = `800 12px ${FONTE}`;
      g.textAlign = "center";
      g.fillText(glyph, p[0] + 9, p[1] - 6);
      g.textAlign = "left";
    }
  }
  function trilhaArc(a: Pt, b: Pt, u: number, lift: number, col: string, real: boolean): void {
    const cs = COLS[col] ?? (COLS.b as [string, string]);
    for (let i = 1; i <= 6; i++) {
      const uu = Math.max(0, u - i * 0.035);
      const p = arcPt(a, b, uu, lift);
      g.beginPath();
      g.arc(p[0], p[1], Math.max(0.6, 3 - i * 0.4), 0, TAU);
      g.fillStyle = `${cs[0]}${((real ? 0.55 : 0.3) - i * 0.06).toFixed(2)})`;
      g.fill();
    }
  }
  function ondasS(p: Pt, tm: number, rmax: number, col?: string): void {
    for (let r = 0; r < 3; r++) {
      const u = (tm * 1.4 + r / 3) % 1;
      g.beginPath();
      g.arc(p[0], p[1], 6 + u * rmax, -1.15, 1.15);
      g.strokeStyle = `${col ?? "rgba(126,180,255,"}${(0.9 - u * 0.85).toFixed(2)})`;
      g.lineWidth = 2;
      g.stroke();
    }
  }
  function selo(p: Pt, tipo: "ok" | "no" | "wait" | "neu", u: number): void {
    const s = 0.6 + 0.4 * Math.min(1, u * 1.6);
    g.save();
    g.translate(p[0], p[1] - 8 * u);
    g.scale(s, s);
    glow([0, 0], 32, tipo === "ok" ? "rgba(126,217,166,.9)" : tipo === "no" ? "rgba(224,90,78,.9)" : tipo === "neu" ? "rgba(160,175,210,.7)" : "rgba(242,181,63,.9)", 1);
    g.beginPath();
    g.arc(0, 0, 12, 0, TAU);
    g.fillStyle = tipo === "ok" ? "#27A06A" : tipo === "no" ? "#E05A4E" : tipo === "neu" ? "#5d6b94" : "#F2B53F";
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "#EEF1F8";
    g.stroke();
    g.fillStyle = tipo === "wait" ? "#1B2540" : "#EEF1F8";
    g.font = `800 16px ${FONTE}`;
    g.textAlign = "center";
    g.fillText(tipo === "ok" ? "✓" : tipo === "no" ? "✗" : tipo === "neu" ? "–" : "!", 0, 5.5);
    g.textAlign = "left";
    g.restore();
  }
  function cartao(x: number, y: number, w: number, titulo: string, rows: LinhaCartao[], prog: number, col: string, tm: number, ancora?: Pt, pronto?: boolean): void {
    const hgt = 24 + rows.length * 15 + 6;
    g.save();
    g.fillStyle = "rgba(8,13,28,.94)";
    roundRect(x, y, w, hgt, 8);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 1.4;
    g.stroke();
    if (ancora) {
      g.strokeStyle = col;
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + w / 2, y + hgt);
      g.lineTo(ancora[0], ancora[1]);
      g.stroke();
      g.setLineDash([]);
    }
    g.font = `800 10px ${FONTE}`;
    g.fillStyle = col;
    g.fillText(titulo, x + 9, y + 15);
    g.font = `600 10px ${FONTE_CORPO}`;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as LinhaCartao;
      const ry = y + 31 + i * 15;
      const mostra = pronto || prog > (i / rows.length) * 0.86 + 0.04;
      const feito = pronto || prog > ((i + 1) / rows.length) * 0.86 + 0.04;
      g.fillStyle = "#A6B3D2";
      g.fillText(r[0], x + 9, ry);
      if (!mostra) continue;
      if (!feito) {
        g.fillStyle = "#5B8AE8";
        g.fillText("lendo…", x + 62, ry);
        continue;
      }
      g.fillStyle = r[2] === "ok" ? "#7ED9A6" : r[2] === "no" ? "#ff8f84" : r[2] === "neu" ? "#A6B3D2" : "#F2B53F";
      g.fillText((r[2] === "ok" ? "✓ " : r[2] === "no" ? "✗ " : r[2] === "neu" ? "• " : "? ") + r[1], x + 62, ry);
    }
    if (prog < 1 && !pronto) {
      g.fillStyle = "rgba(91,138,232,.25)";
      g.fillRect(x + 5, y + 20 + ((tm * 40) % (hgt - 24)), w - 10, 2);
    }
    g.restore();
  }
  /** Close-up do ticket de descarga na obra; signP >= 0 traça a assinatura, < 0 mostra "?" (aguardando). */
  function ticketCard(p: Pt, signP: number): void {
    const w = 74;
    const h = 54;
    const x = p[0] - w / 2;
    const y = p[1] - h - 14;
    g.save();
    g.fillStyle = "#F4F1E6";
    roundRect(x, y, w, h, 4);
    g.fill();
    g.strokeStyle = "#07090F";
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#B4501A";
    g.fillRect(x, y, w, 9);
    g.fillStyle = "#EEF1F8";
    g.font = `800 6.5px ${FONTE}`;
    g.fillText("TICKET DE DESCARGA", x + 4, y + 7);
    g.fillStyle = "#3a456b";
    g.font = `600 6px ${FONTE_CORPO}`;
    g.fillText("Material: Brita 1", x + 4, y + 18);
    g.fillText("Peso líquido: 18,4 t", x + 4, y + 26);
    g.strokeStyle = "#9aa3bd";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x + 4, y + 46);
    g.lineTo(x + 46, y + 46);
    g.stroke();
    g.fillStyle = "#7a849f";
    g.fillText("assinatura", x + 4, y + 52);
    if (signP >= 0) {
      g.strokeStyle = "#2A4A9E";
      g.lineWidth = 1.5;
      g.lineCap = "round";
      g.beginPath();
      const pts: Pt[] = [[6, 44], [11, 36], [14, 44], [19, 35], [23, 43], [29, 37], [34, 44], [40, 38]];
      const n = Math.max(1, Math.floor(signP * (pts.length - 1)) + 1);
      for (let i = 0; i < n && i < pts.length; i++) {
        const q = pts[i] as Pt;
        if (i) g.lineTo(x + q[0], y + q[1]);
        else g.moveTo(x + q[0], y + q[1]);
      }
      g.stroke();
      if (signP > 0.92) {
        g.beginPath();
        g.arc(x + w - 13, y + 38, 8, 0, TAU);
        g.fillStyle = "#27A06A";
        g.fill();
        g.fillStyle = "#EEF1F8";
        g.font = `800 11px ${FONTE}`;
        g.textAlign = "center";
        g.fillText("✓", x + w - 13, y + 42);
        g.textAlign = "left";
      }
    } else {
      g.fillStyle = "#F2B53F";
      g.fillRect(x + w - 16, y + 30, 10, 10);
      g.fillStyle = "#1B2540";
      g.font = `800 8px ${FONTE}`;
      g.fillText("?", x + w - 13.5, y + 38);
    }
    g.restore();
  }
  /** O carimbo desce, bate (flash + sombra) e sobe. `f` = 0..1 da ação. */
  function carimbo(p: Pt3, f: number, col: string): void {
    const z = f < 0.2 ? lerp(18, 34, f / 0.2) : f < 0.4 ? lerp(34, 16.8, ease((f - 0.2) / 0.2)) : lerp(16.8, 30, ease(clamp01((f - 0.4) / 0.35)));
    if (z < 24) poly([P(p[0] - 0.16, p[1] - 0.2, 15), P(p[0] + 0.16, p[1] - 0.2, 15), P(p[0] + 0.16, p[1] + 0.2, 15), P(p[0] - 0.16, p[1] + 0.2, 15)], "rgba(4,7,18,.35)");
    box(p[0] - 0.1, p[1] - 0.1, z, 0.2, 0.2, 2.4, col);
    box(p[0] - 0.04, p[1] - 0.04, z + 2.4, 0.08, 0.08, 5, "#10182f");
    box(p[0] - 0.08, p[1] - 0.08, z + 7.4, 0.16, 0.16, 1.6, "#10182f");
    if (f >= 0.4 && f < 0.55) {
      const hp0 = P(p[0], p[1], 16);
      glow(hp0, 26, "rgba(255,255,255,.9)", 0.9);
      g.beginPath();
      g.ellipse(hp0[0], hp0[1], 12 + (f % 1) * 4, 6, 0, 0, TAU);
      g.strokeStyle = "rgba(255,255,255,.7)";
      g.lineWidth = 1.4;
      g.stroke();
    }
  }
  /** A marca do carimbo flutuando sobre o papel (texto + cor), some devagar. */
  function marcaCarimbo(p: Pt, texto: string, col: string, age: number, dx = 34): void {
    const sc = age < 0.15 ? 1.7 - (age / 0.15) * 0.7 : 1;
    const al = age > 1.7 ? 1 - (age - 1.7) / 0.5 : 1;
    g.save();
    g.translate(p[0] + dx, p[1] - 18);
    g.rotate(-0.12);
    g.scale(sc, sc);
    g.globalAlpha = al;
    g.font = `800 11px ${FONTE}`;
    const tw2 = g.measureText(texto).width + 14;
    g.fillStyle = "rgba(8,13,28,.82)";
    roundRect(-tw2 / 2, -10, tw2, 20, 3);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 0.8;
    roundRect(-tw2 / 2 + 3, -7, tw2 - 6, 14, 2);
    g.stroke();
    g.fillStyle = col;
    g.textAlign = "center";
    g.fillText(texto, 0, 4);
    g.restore();
  }
  function balaoReticencias(p: Pt, tm: number): void {
    g.fillStyle = "rgba(10,15,30,.92)";
    roundRect(p[0] - 14, p[1] - 14, 28, 17, 6);
    g.fill();
    g.strokeStyle = "#F2B53F";
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = "#F2B53F";
    const dd = reduce ? 2 : Math.floor(tm * 3) % 3;
    for (let q = 0; q < 3; q++) {
      g.globalAlpha = q <= dd ? 1 : 0.35;
      g.fillRect(p[0] - 8 + q * 7, p[1] - 6, 3, 3);
    }
    g.globalAlpha = 1;
  }
  function celular(p: Pt, lanca: boolean): void {
    g.fillStyle = "#0b1226";
    g.fillRect(p[0] - 3, p[1] - 7, 6, 10);
    g.fillStyle = lanca ? "#27A06A" : "#9CC0FF";
    g.fillRect(p[0] - 2, p[1] - 6, 4, 7);
    glow([p[0], p[1] - 2], 16, lanca ? "rgba(39,160,106,.8)" : "rgba(120,170,255,.8)", 0.9);
  }

  /* ---------- API ---------- */
  function criarCamada(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.round(LARGURA * SCL);
    c.height = Math.round(ALTURA * SCL);
    return c;
  }
  function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const x = c.getContext("2d");
    if (!x) throw new Error("canvas 2d indisponível");
    return x;
  }
  /** Recria as duas camadas estáticas na resolução `scl` (pixels por unidade lógica). */
  function camadas(scl: number): { s0: HTMLCanvasElement; s1: HTMLCanvasElement } {
    SCL = scl;
    calcularPontos();
    const s0 = criarCamada();
    g = ctx2d(s0);
    g.setTransform(SCL, 0, 0, SCL, 0, 0);
    desenharS0();
    const s1 = criarCamada();
    g = ctx2d(s1);
    g.setTransform(SCL, 0, 0, SCL, 0, 0);
    desenharS1();
    return { s0, s1 };
  }
  function usar(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
    g = ctx;
    g.setTransform(SCL, 0, 0, SCL, 0, 0);
    g.lineJoin = "round";
    return g;
  }

  return {
    camadas, usar, setO, P, PT, cabPos, scl: () => SCL,
    // primitivas
    box, poly, glow, ellipse, roundRect, tagS, tag, faceRect, gq, sh, sat,
    // obra
    caminhao, humano, guarita, mesinha, monte, betoneira, cones, container, tubos, torreLuz, palete, retro, bolha, nuvens, coneTrafego,
    // sinal
    torre, servidor, pacoteS, trilhaArc, ondasS, selo, cartao, ticketCard, arcPt, COLS,
    // escritório
    mesa, papelChato, pilhaGrupo, topoPilha, monitor, cadeira, planta, arquivo, caixaDevolvidas, pastaAjustadas, bandejaNeutra, balcao,
    cafeteira, parede, carimbo, marcaCarimbo, balaoReticencias, celular, descarregarPlaquetas, clipZona, plaquetaPendente: plaq,
  };
}

export type Desenho = ReturnType<typeof criarDesenho>;
