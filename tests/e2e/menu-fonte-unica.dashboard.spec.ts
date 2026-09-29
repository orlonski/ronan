import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  destinosDaBarra,
  ehPaginaRaiz,
  filtrarMenu,
  GRUPOS,
  normalizarBusca,
  rotaPai,
  SEMENTE_BARRA,
  tituloDaRota,
  type ContextoMenu,
} from "../../apps/dashboard/src/lib/menu";

/**
 * O menu do painel tem UMA fonte (lib/menu.ts): sidebar, folha "Mais" e barra inferior leem
 * dela. Estes testes não abrem navegador — travam a regra de quem vê o quê, com papéis e módulos
 * variados, contra um ORÁCULO escrito à parte (o filtro que morava inline em sidebar.tsx antes da
 * extração). Se alguém "melhorar" o filtro de um lado só, o teste acusa.
 */

/** O filtro antigo da sidebar, copiado literalmente do commit anterior à extração. */
function oraculoDaSidebarAntiga({ temPermissao, temModulo, plataforma }: ContextoMenu) {
  return GRUPOS.filter((g) => !g.soPlataforma || plataforma)
    .map((g) => ({
      titulo: g.titulo,
      hrefs: g.itens.flatMap((i) => {
        if (!i.perm || (temPermissao(i.perm) && temModulo(i.perm))) return [i.href];
        const aba = (i.ou ?? []).find((o) => !o.perm || (temPermissao(o.perm) && temModulo(o.perm)));
        if (aba) return [aba.href];
        return [];
      }),
    }))
    .filter((g) => g.hrefs.length > 0);
}

const TODAS = Array.from(
  new Set(GRUPOS.flatMap((g) => g.itens.flatMap((i) => [i.perm, ...(i.ou ?? []).map((o) => o.perm)]).filter((p): p is string => !!p))),
);

/** PRNG determinístico (mulberry32): mesmos papéis a cada execução. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctx(permissoes: Iterable<string>, opts: { semModulo?: (chave: string) => boolean; plataforma?: boolean } = {}): ContextoMenu {
  const set = new Set(permissoes);
  return {
    temPermissao: (c) => set.has(c),
    temModulo: (c) => !(opts.semModulo?.(c) ?? false),
    plataforma: opts.plataforma ?? false,
  };
}

function cenarios(): { nome: string; c: ContextoMenu }[] {
  const lista: { nome: string; c: ContextoMenu }[] = [
    { nome: "administrador de tudo", c: ctx(TODAS, { plataforma: true }) },
    { nome: "administrador da empresa (sem plataforma)", c: ctx(TODAS) },
    { nome: "ninguém", c: ctx([]) },
    { nome: "só viagens.ver", c: ctx(["viagens.ver"]) },
    { nome: "só a aba de conferir tickets (cai na aba)", c: ctx(["conferencia-ticket.ver"]) },
    { nome: "operador (viagens|motoristas|veículos|locais)", c: ctx(TODAS.filter((p) => /^(viagens|motoristas|veiculos|locais)/.test(p))) },
    { nome: "tudo menos o módulo do ponto", c: ctx(TODAS, { semModulo: (c) => /^(ponto|fechamento-ponto|correcoes-ponto|funcionarios|jornadas|config-ponto|espelho-ponto)/.test(c) }) },
    { nome: "tudo, sem nenhum módulo além do núcleo", c: ctx(TODAS, { semModulo: () => true }) },
  ];
  const rnd = prng(20260929);
  for (let n = 0; n < 200; n++) {
    const p = TODAS.filter(() => rnd() < 0.3);
    const fora = new Set(TODAS.filter(() => rnd() < 0.15));
    lista.push({ nome: `sorteio ${n}`, c: ctx(p, { semModulo: (c) => fora.has(c), plataforma: rnd() < 0.3 }) });
  }
  return lista;
}

test.describe("menu: uma fonte só", () => {
  test("filtrarMenu devolve exatamente o que a sidebar antiga mostrava", () => {
    for (const { nome, c } of cenarios()) {
      const novo = filtrarMenu(c).grupos.map((g) => ({ titulo: g.titulo, hrefs: g.itens.map((i) => i.href) }));
      expect(novo, nome).toEqual(oraculoDaSidebarAntiga(c));
    }
  });

  test("cada item visível tem permissão+módulo (ou uma aba com); cada item escondido não tem nenhum", () => {
    for (const { nome, c } of cenarios()) {
      const ok = (perm?: string) => !perm || (c.temPermissao(perm) && c.temModulo(perm));
      const visiveis = new Set(filtrarMenu(c).grupos.flatMap((g) => g.itens.map((i) => i.base)));
      for (const g of GRUPOS) {
        for (const i of g.itens) {
          const pode = ok(i.perm) || (i.ou ?? []).some((o) => ok(o.perm));
          const grupoLiberado = !g.soPlataforma || c.plataforma;
          expect(visiveis.has(i.href), `${nome}: ${i.label}`).toBe(pode && grupoLiberado);
        }
      }
    }
  });

  test("grupo da plataforma some inteiro pra quem não é da plataforma", () => {
    const m = filtrarMenu(ctx(TODAS));
    expect(m.grupos.some((g) => g.soPlataforma)).toBe(false);
    expect(filtrarMenu(ctx(TODAS, { plataforma: true })).grupos.some((g) => g.soPlataforma)).toBe(true);
  });

  test("no topo: Dashboard e Começar sempre; Relatórios só com permissão e módulo", () => {
    expect(filtrarMenu(ctx([])).topo.map((i) => i.href)).toEqual(["/", "/comecar"]);
    expect(filtrarMenu(ctx(["relatorios.ver"])).topo.map((i) => i.href)).toEqual(["/", "/comecar", "/relatorios"]);
    expect(filtrarMenu(ctx(["relatorios.ver"], { semModulo: () => true })).topo.map((i) => i.href)).toEqual(["/", "/comecar"]);
  });
});

test.describe("barra inferior do celular", () => {
  const destinos = (c: ContextoMenu) => destinosDaBarra(filtrarMenu(c)).map((d) => d.href);

  test("administrador: Início, Viagens, Ao vivo, Motoristas", () => {
    expect(destinos(ctx(TODAS))).toEqual(["/", "/viagens", "/viagens-andamento", "/motoristas"]);
  });

  test("quem não vê um destino ganha o próximo candidato", () => {
    const semAoVivo = TODAS.filter((p) => p !== "ao-vivo.ver");
    expect(destinos(ctx(semAoVivo))).toEqual(["/", "/viagens", "/motoristas", "/torre"]);
    const semViagens = TODAS.filter((p) => !/^viagens\./.test(p));
    // sem viagens.ver ainda sobra a aba (conferências etc.): o destino abre nela
    expect(destinos(ctx(semViagens))).toHaveLength(4);
    // operador: sem torre nem pedidos, o candidato seguinte é Veículos
    expect(destinos(ctx(TODAS.filter((p) => /^(viagens|motoristas|veiculos|locais)/.test(p))))).toEqual(["/", "/viagens", "/motoristas", "/veiculos"]);
  });

  test("ninguém vê nada além do Início (não inventa destino)", () => {
    expect(destinos(ctx([]))).toEqual(["/"]);
  });

  test("destino cujo módulo não foi contratado some da barra", () => {
    const d = destinos(ctx(TODAS, { semModulo: (c) => c === "ao-vivo.ver" }));
    expect(d).not.toContain("/viagens-andamento");
    expect(d).toHaveLength(4);
  });

  test("todo destino da barra está no menu visível e nunca passa de 4", () => {
    for (const { nome, c } of cenarios()) {
      const m = filtrarMenu(c);
      const visiveis = new Set([...m.topo, ...m.grupos.flatMap((g) => g.itens)].map((i) => i.href));
      const d = destinosDaBarra(m);
      expect(d.length, nome).toBeLessThanOrEqual(4);
      for (const i of d) expect(visiveis.has(i.href), `${nome}: ${i.href}`).toBe(true);
    }
  });

  test("a semente só tem rotas que existem no menu e no app", () => {
    const noMenu = new Set(["/", ...GRUPOS.flatMap((g) => g.itens.map((i) => i.href))]);
    const app = path.resolve(__dirname, "../../apps/dashboard/src/app/(painel)");
    for (const s of SEMENTE_BARRA) {
      expect(noMenu.has(s.href), s.href).toBe(true);
      const pagina = s.href === "/" ? path.join(app, "page.tsx") : path.join(app, s.href, "page.tsx");
      expect(fs.existsSync(pagina), pagina).toBe(true);
    }
  });
});

test.describe("cabeçalho do celular: raiz x filha, título e voltar", () => {
  test("páginas raiz", () => {
    for (const p of ["/", "/viagens", "/motoristas", "/viagens-andamento", "/comecar", "/relatorios", "/inbox", "/ponto/competencia", "/configuracoes/km-atipico", "/configuracoes/empresa", "/conferencias", "/modalidades", "/motoristas/"]) {
      expect(ehPaginaRaiz(p), p).toBe(true);
    }
  });
  test("páginas filhas", () => {
    for (const p of ["/motoristas/abc", "/motoristas/abc/editar", "/motoristas/novo", "/viagens/123", "/locais/em-validacao", "/relatorios/viagens"]) {
      expect(ehPaginaRaiz(p), p).toBe(false);
    }
  });
  test("todo item do menu (e aba) é raiz", () => {
    for (const g of GRUPOS) for (const i of g.itens) for (const h of [i.href, ...(i.ou ?? []).map((o) => o.href)]) expect(ehPaginaRaiz(h), h).toBe(true);
  });
  test("título de fallback vem do menu (prefixo mais longo)", () => {
    expect(tituloDaRota("/motoristas/abc")).toBe("Motoristas");
    expect(tituloDaRota("/motoristas/abc/editar")).toBe("Motoristas");
    expect(tituloDaRota("/viagens-andamento")).toBe("Ao vivo");
    expect(tituloDaRota("/viagens/9")).toBe("Viagens");
    expect(tituloDaRota("/ponto/funcionarios/1")).toBe("Quem bate ponto");
    expect(tituloDaRota("/nao-existe/1")).toBeNull();
  });
  test("rota pai", () => {
    expect(rotaPai("/motoristas/abc/editar")).toBe("/motoristas/abc");
    expect(rotaPai("/motoristas/abc")).toBe("/motoristas");
    expect(rotaPai("/motoristas")).toBe("/");
  });
});

test("busca de tela ignora acento e caixa", () => {
  expect(normalizarBusca("  Lançamentos ")).toBe("lancamentos");
  expect(normalizarBusca("VEÍCULOS")).toBe("veiculos");
});
