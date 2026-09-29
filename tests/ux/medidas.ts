import type { Page } from "@playwright/test";

/**
 * Medidas de UX de uma página do painel, só leitura (não clica, não digita).
 * Vem do harness de auditoria de responsividade; aqui só o que entra no orçamento.
 *
 * Os campos "só mobile" vêm `null` nos viewports de desktop: alvo de toque, fonte pequena e
 * input < 16px (zoom automático do iOS) não são problema de mouse.
 */
export interface Medidas {
  vw: number;
  vh: number;
  /** scrollWidth do documento - largura da janela. > 0 = a página rola de lado. */
  overflowHorizontalPx: number;
  /** Elementos (folhas) cujo lado direito passa da borda do <main>/janela e não estão em área rolável. */
  elementosQueEstouram: number;
  /** main.scrollWidth - main.clientWidth: conteúdo cortado pelo <main>. */
  conteudoCortadoPx: number;
  /** Alvos de toque menores que 44x44 (só mobile). */
  alvosMenor44: number | null;
  alvosTotal: number | null;
  /** Menor fonte de texto visível, em px (só mobile). */
  menorFontePx: number | null;
  /** Quantos textos visíveis têm fonte < 14px (só mobile). */
  textosMenor14: number | null;
  /** input/select/textarea com font-size computado < 16px (só mobile). */
  inputsMenor16: number | null;
  /** Largura ocupada pelo conteúdo dentro do <main> (px) e sua razão sobre a janela. */
  larguraUtilPx: number;
  larguraUtilRazao: number;
  /** O <meta viewport> trava o zoom (user-scalable=no ou maximum-scale). */
  viewportBloqueiaZoom: boolean;
  /** Existe um <aside> visível na tela (menu lateral). */
  menuLateralVisivel: boolean;
  /** Pistas pra mensagem de falha; NÃO entram no orçamento. */
  detalhes: {
    estouram: { seletor: string; estouraPx: number; texto: string }[];
    alvosPequenos: { seletor: string; w: number; h: number; texto: string }[];
    fontesPequenas: { px: number; seletor: string; texto: string }[];
    inputsPequenos: { seletor: string; px: number }[];
    viewportMeta: string | null;
  };
}

/** Roda dentro da página (serializada pelo Playwright): não pode fechar sobre nada de fora. */
function medirNaPagina(opts: { mobile: boolean }) {
  const { mobile } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const de = document.documentElement;
  const main = document.getElementById("conteudo");
  const mainRect = main ? main.getBoundingClientRect() : null;
  const cs = (el: Element) => getComputedStyle(el);
  const rectOf = (el: Element) => el.getBoundingClientRect();
  const vis = (el: Element) => {
    const c = cs(el);
    if (c.display === "none" || c.visibility === "hidden") return false;
    const r = rectOf(el);
    return r.width > 0 && r.height > 0;
  };
  const skipTag = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "BR", "PATH", "DEFS", "CLIPPATH", "G", "USE"]);
  const inPortalDev = (el: Element) => !!el.closest("nextjs-portal, [data-nextjs-toast], next-route-announcer");
  const sel = (el: Element) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    if (cls) s += "." + cls;
    return s.slice(0, 90);
  };
  const txt = (el: Element) =>
    ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const round = (n: number) => Math.round(n * 10) / 10;
  const all = Array.from(document.body.querySelectorAll("*")).filter((e) => !skipTag.has(e.tagName.toUpperCase()) && !inPortalDev(e));

  const isClipper = (p: Element) => {
    if (p === document.body || p === de || p.id === "conteudo") return false;
    const o = cs(p).overflowX;
    return o === "auto" || o === "scroll" || o === "hidden" || o === "clip";
  };
  const hasClipperAncestor = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (isClipper(p)) return true;
    return false;
  };
  const inFixed = (el: Element) => {
    for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) if (cs(p).position === "fixed") return true;
    return false;
  };

  // overflow horizontal
  const docScrollW = Math.max(de.scrollWidth, document.body.scrollWidth);
  const overflowHorizontalPx = Math.max(0, docScrollW - vw);
  const conteudoCortadoPx = main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0;
  const offenders: { el: Element; r: DOMRect; over: number }[] = [];
  for (const el of all) {
    const r = rectOf(el);
    if (r.width < 2 || r.height < 2) continue;
    const limit = main && mainRect && main.contains(el) && el !== main ? mainRect.right : vw;
    if (r.right <= limit + 1) continue;
    if (!vis(el) || hasClipperAncestor(el) || inFixed(el)) continue;
    offenders.push({ el, r, over: r.right - limit });
  }
  const leaves = offenders.filter((o) => !offenders.some((p) => p !== o && o.el.contains(p.el)));
  leaves.sort((a, b) => b.over - a.over);

  // alvos de toque / fontes / inputs (mobile)
  let alvosTotal = 0;
  let alvosMenor44 = 0;
  const alvosPequenos: { seletor: string; w: number; h: number; texto: string }[] = [];
  let menorFontePx = Infinity;
  let textosMenor14 = 0;
  const fontesPequenas: { px: number; seletor: string; texto: string }[] = [];
  let inputsMenor16 = 0;
  const inputsPequenos: { seletor: string; px: number }[] = [];
  if (mobile) {
    const interactiveSel =
      'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=radio], [role=combobox], [role=option], [tabindex]:not([tabindex="-1"])';
    for (const el of Array.from(document.body.querySelectorAll(interactiveSel))) {
      if (inPortalDev(el) || !vis(el)) continue;
      const r = rectOf(el);
      if (r.width <= 1 || r.height <= 1) continue; // sr-only
      if (el.tagName === "A" && cs(el).display === "inline") continue; // link no meio do texto
      let alvo: Element = el;
      const inp = el as HTMLInputElement;
      if (el.tagName === "INPUT" && (inp.type === "checkbox" || inp.type === "radio") && el.closest("label")) alvo = el.closest("label") as Element;
      const ar = rectOf(alvo);
      alvosTotal++;
      if (ar.width < 44 || ar.height < 44) {
        alvosMenor44++;
        if (alvosPequenos.length < 6) alvosPequenos.push({ seletor: sel(el), w: round(ar.width), h: round(ar.height), texto: txt(el) });
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const contados = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || contados.has(el) || skipTag.has(el.tagName.toUpperCase()) || inPortalDev(el)) continue;
      contados.add(el);
      if (!vis(el)) continue;
      const r = rectOf(el);
      if (r.width <= 1 || r.height <= 1) continue;
      const fs = parseFloat(cs(el).fontSize);
      if (fs < menorFontePx) menorFontePx = fs;
      if (fs < 14) {
        textosMenor14++;
        if (fontesPequenas.length < 6) fontesPequenas.push({ px: fs, seletor: sel(el), texto: (n.nodeValue || "").trim().slice(0, 40) });
      }
    }
    const inputSel =
      'input:not([type]), input[type=text], input[type=search], input[type=email], input[type=tel], input[type=url], input[type=number], input[type=password], input[type=date], input[type=datetime-local], input[type=time], input[type=month], select, textarea, [contenteditable=true]';
    for (const e of Array.from(document.body.querySelectorAll(inputSel))) {
      if (inPortalDev(e) || !vis(e)) continue;
      const px = parseFloat(cs(e).fontSize);
      if (px < 16) {
        inputsMenor16++;
        if (inputsPequenos.length < 5) inputsPequenos.push({ seletor: sel(e), px });
      }
    }
  }

  // largura útil do conteúdo (retângulo do texto, não da caixa: div w-full com 1 palavra não conta)
  let larguraUtilPx = 0;
  if (main && mainRect) {
    let minL = Infinity;
    let maxR = -Infinity;
    for (const el of Array.from(main.querySelectorAll("*"))) {
      if (skipTag.has(el.tagName.toUpperCase()) || !vis(el) || inFixed(el)) continue;
      const tag = el.tagName.toUpperCase();
      const temTexto = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.nodeValue || "").trim());
      const proprio = ["IMG", "SVG", "CANVAS", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "VIDEO"].includes(tag) || temTexto;
      if (!proprio) continue;
      let r: DOMRect = rectOf(el);
      if (tag !== "IMG" && tag !== "CANVAS" && temTexto) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rr = range.getBoundingClientRect();
        if (rr.width > 0) r = rr;
      }
      if (r.width < 1) continue;
      minL = Math.min(minL, r.left);
      maxR = Math.max(maxR, r.right);
    }
    const st = cs(main);
    const padL = parseFloat(st.paddingLeft);
    const padR = parseFloat(st.paddingRight);
    larguraUtilPx = maxR > minL ? Math.min(maxR, mainRect.right - padR) - Math.max(minL, mainRect.left + padL) : 0;
    larguraUtilPx = Math.max(0, larguraUtilPx);
  }

  const vpMeta = document.querySelector('meta[name="viewport"]');
  const vpContent = vpMeta ? vpMeta.getAttribute("content") : null;
  const bloqueiaZoom = !!vpContent && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=/i.test(vpContent);
  const asides = Array.from(document.querySelectorAll("aside")).filter((a) => vis(a) && rectOf(a).left >= 0 && rectOf(a).right > 0);

  return {
    vw,
    vh,
    overflowHorizontalPx: round(overflowHorizontalPx),
    elementosQueEstouram: leaves.length,
    conteudoCortadoPx: round(conteudoCortadoPx),
    alvosMenor44: mobile ? alvosMenor44 : null,
    alvosTotal: mobile ? alvosTotal : null,
    menorFontePx: mobile && isFinite(menorFontePx) ? round(menorFontePx) : null,
    textosMenor14: mobile ? textosMenor14 : null,
    inputsMenor16: mobile ? inputsMenor16 : null,
    larguraUtilPx: round(larguraUtilPx),
    larguraUtilRazao: Math.round((larguraUtilPx / vw) * 1000) / 1000,
    viewportBloqueiaZoom: bloqueiaZoom,
    menuLateralVisivel: asides.length > 0,
    detalhes: {
      estouram: leaves.slice(0, 5).map((o) => ({ seletor: sel(o.el), estouraPx: round(o.over), texto: txt(o.el) })),
      alvosPequenos,
      fontesPequenas,
      inputsPequenos,
      viewportMeta: vpContent,
    },
  };
}

/**
 * Mede a página atual. `mobile` default: viewport de até 500px de largura.
 * Chame depois de a tela terminar de carregar (ver `esperarTelaPronta` em ./ambiente).
 */
export async function medir(page: Page, opts: { mobile?: boolean } = {}): Promise<Medidas> {
  const largura = page.viewportSize()?.width ?? 1280;
  const mobile = opts.mobile ?? largura <= 500;
  return page.evaluate(medirNaPagina, { mobile });
}
