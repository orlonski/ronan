import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { TODAS_AS_CHAVES } from "@ronan/shared-types";

/**
 * NENHUMA TELA NASCE SEM PERMISSÃO.
 *
 * A API já trava na subida (modulos.boot-check: endpoint de admin/* sem
 * @RequerPermissao derruba o boot). O painel não tinha trava: `permDaRota`
 * liberava o que não estava em ROTA_PERM, e tela nova esquecida abria pra
 * todo mundo. Desde 23/09/2026 o TelaGuard barra o que não conhece, e este
 * spec garante que isso nunca aconteça por esquecimento: toda tela do painel,
 * todo item e toda aba do menu têm permissão mapeada — ou estão em
 * ROTAS_ABERTAS, com o porquê escrito.
 *
 * Lê os arquivos do dashboard como texto (mesmo jeito do menu-matriz.spec):
 * o tsc da API não compila código do Next.
 */

const DASH = resolve(__dirname, "../../../dashboard/src");
const PAINEL = join(DASH, "app/(painel)");
const permissoes = readFileSync(join(DASH, "lib/permissoes.ts"), "utf8");
const sidebar = readFileSync(join(DASH, "components/sidebar.tsx"), "utf8");
const abas = readFileSync(join(DASH, "components/abas-da-tela.tsx"), "utf8");

const inicioAbertas = permissoes.indexOf("export const ROTAS_ABERTAS");
const trechoRotaPerm = permissoes.slice(permissoes.indexOf("const ROTA_PERM"), inicioAbertas);
const trechoAbertas = permissoes.slice(inicioAbertas, permissoes.indexOf("export function rotaAberta"));

const rotaPerm = [...trechoRotaPerm.matchAll(/prefixo:\s*"([^"]+)",\s*perm:\s*"([^"]+)"/g)].map((m) => ({
  prefixo: m[1]!,
  perm: m[2]!,
}));
const abertas = [...trechoAbertas.matchAll(/rota:\s*"([^"]+)"/g)].map((m) => m[1]!);

/** Todas as telas do painel: cada pasta com page.tsx vira uma rota. */
function telasDoPainel(dir = PAINEL, base = ""): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (!statSync(caminho).isDirectory()) {
      if (nome === "page.tsx") out.push(base || "/");
      continue;
    }
    // Grupo de rotas "(x)" não entra na URL.
    const seg = /^\(.*\)$/.test(nome) ? "" : `/${nome}`;
    out.push(...telasDoPainel(caminho, base + seg));
  }
  return out;
}

const coberta = (rota: string) =>
  rotaPerm.some((r) => rota === r.prefixo || rota.startsWith(`${r.prefixo}/`)) ||
  abertas.some((a) => rota === a || (a !== "/" && rota.startsWith(`${a}/`)));

const chavesExistem = new Set(TODAS_AS_CHAVES);

describe("toda tela do painel tem permissão (ou é aberta de propósito)", () => {
  const telas = telasDoPainel();

  it("o teste está mesmo lendo os arquivos (senão passaria vazio)", () => {
    expect(telas.length).toBeGreaterThan(80);
    expect(rotaPerm.length).toBeGreaterThan(50);
    expect(abertas).toContain("/");
  });

  it("toda tela está em ROTA_PERM ou em ROTAS_ABERTAS", () => {
    expect(telas.filter((t) => !coberta(t))).toEqual([]);
  });

  it("toda permissão de ROTA_PERM existe no catálogo", () => {
    expect(rotaPerm.filter((r) => !chavesExistem.has(r.perm)).map((r) => `${r.prefixo} → ${r.perm}`)).toEqual([]);
  });

  it("todo item e toda aba do menu levam a uma rota com permissão (ou aberta)", () => {
    const hrefsMenu = [...sidebar.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]!);
    const hrefsAbas = [...abas.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]!);
    expect([...hrefsMenu, ...hrefsAbas].filter((h) => !coberta(h))).toEqual([]);
  });

  it("toda aba declara permissão que existe no catálogo (null só em rota aberta)", () => {
    const erradas: string[] = [];
    for (const m of abas.matchAll(/href:\s*"(\/[^"]*)",\s*label:\s*"[^"]*",\s*perm:\s*(null|"([^"]+)")/g)) {
      const [, href, cru, perm] = m;
      if (cru === "null") {
        if (!abertas.includes(href!)) erradas.push(`${href} sem permissão e fora de ROTAS_ABERTAS`);
      } else if (!chavesExistem.has(perm!)) {
        erradas.push(`${href} → ${perm} não existe no catálogo`);
      }
    }
    expect(erradas).toEqual([]);
  });
});
