import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CATALOGO_PERMISSOES,
  RECURSOS_LABEL,
  SECAO_SEM_ITEM_NO_MENU,
  agruparRecursosPorMenu,
  type MenuDescricao,
} from "@ronan/shared-types";

/**
 * A MATRIZ DE PAPÉIS SE AGRUPA PELO MENU — e nenhum recurso pode sumir dela.
 *
 * A matriz (/configuracoes/permissoes) monta as seções com
 * `agruparRecursosPorMenu(estruturaDoMenu(), …)`. Um recurso que não saísse em
 * seção nenhuma seria uma chave impossível de marcar; um que saísse duas vezes
 * seria dois checkboxes da mesma chave, e o "Marcar todos" de uma seção mexeria
 * na outra.
 *
 * ⚠️ `estruturaDoMenu()` mora no sidebar.tsx, que importa Next e lucide — não
 * dá pra importá-lo daqui (e o tsc do apps/api recusa arquivo fora do rootDir).
 * Por isso o menu é LIDO do arquivo como texto, igual ao menu-matriz.spec.ts, e
 * a função de agrupamento vem do shared-types, que é pura.
 */

const SIDEBAR = resolve(__dirname, "../../../dashboard/src/components/sidebar.tsx");

/** Reconstrói grupos → itens → abas a partir do texto de GRUPOS. */
function menuDoSidebar(): MenuDescricao {
  const codigo = readFileSync(SIDEBAR, "utf8");
  const inicio = codigo.indexOf("const GRUPOS: Grupo[] = [");
  const fim = codigo.indexOf("\n];", inicio);
  const trecho = codigo.slice(inicio, fim);

  const relatorios = /const RELATORIOS_ITEM = \{[^}]*href:\s*"([^"]+)",\s*label:\s*"([^"]+)",[^}]*perm:\s*"([^"]+)"/.exec(codigo);
  const menu: MenuDescricao = relatorios
    ? [{ titulo: relatorios[2]!, itens: [{ href: relatorios[1]!, label: relatorios[2]!, perm: relatorios[3]!, abas: [] }] }]
    : [];

  // Varre os tokens em ordem: `titulo` abre grupo, `href`+`label` abre item,
  // `href` sem label abre aba (do `ou`), `perm` pertence ao último aberto.
  const token = /titulo:\s*"([^"]+)"|href:\s*"([^"]+)"(?:,\s*label:\s*"([^"]+)")?|perm:\s*"([^"]+)"|soPlataforma:\s*true/g;
  let ultimo: { perm?: string } | null = null;
  for (const m of trecho.matchAll(token)) {
    const grupo = menu[menu.length - 1];
    if (m[1]) {
      menu.push({ titulo: m[1], itens: [] });
      ultimo = null;
    } else if (m[2] && m[3]) {
      const item: MenuDescricao[number]["itens"][number] = { href: m[2], label: m[3], abas: [] };
      grupo!.itens.push(item);
      ultimo = item;
    } else if (m[2]) {
      const aba: { href: string; perm?: string } = { href: m[2] };
      grupo!.itens[grupo!.itens.length - 1]!.abas.push(aba);
      ultimo = aba;
    } else if (m[4]) {
      if (ultimo) ultimo.perm = m[4];
    } else {
      grupo!.soPlataforma = true;
    }
  }
  return menu;
}

const RECURSOS = [...new Set(CATALOGO_PERMISSOES.map((p) => p.chave.split(".")[0]!))];

function recursosDasSecoes(secoes: ReturnType<typeof agruparRecursosPorMenu>): string[] {
  return secoes.flatMap((s) => s.linhas.map((l) => l.recurso));
}

describe("matriz de papéis agrupada pelo menu", () => {
  it("o teste está mesmo lendo o menu (senão passaria vazio pra sempre)", () => {
    const menu = menuDoSidebar();
    expect(menu.length).toBeGreaterThan(6);
    expect(menu.flatMap((g) => g.itens).length).toBeGreaterThan(35);
    expect(menu.flatMap((g) => g.itens.flatMap((i) => i.abas)).length).toBeGreaterThan(10);
    expect(menu.some((g) => g.soPlataforma)).toBe(true);
  });

  for (const plataforma of [true, false]) {
    it(`todo recurso do catálogo aparece na matriz, e nenhum some (plataforma=${plataforma})`, () => {
      const menu = menuDoSidebar().filter((g) => !g.soPlataforma || plataforma);
      const secoes = agruparRecursosPorMenu(menu, RECURSOS, { recurso: (r) => RECURSOS_LABEL[r] });
      const vistos = recursosDasSecoes(secoes);
      expect([...new Set(vistos)].sort()).toEqual([...RECURSOS].sort());
      // Fora do menu, cada recurso no máximo uma vez.
      const sobras = secoes.find((s) => s.titulo === SECAO_SEM_ITEM_NO_MENU)?.linhas.map((l) => l.recurso) ?? [];
      expect(sobras.length).toBe(new Set(sobras).size);
      expect(secoes.filter((s) => s.linhas.length === 0)).toEqual([]);
    });
  }

  it("aba vira sub-linha do item, com o rótulo \"Item › Aba\"", () => {
    const secoes = agruparRecursosPorMenu(menuDoSidebar(), RECURSOS, {
      aba: (href) => (href === "/modalidades" ? "Modalidades" : undefined),
    });
    const frota = secoes.find((s) => s.titulo === "Frota e pessoas")!;
    const i = frota.linhas.findIndex((l) => l.recurso === "motoristas");
    expect(frota.linhas[i]!.rotulo).toBe("Motoristas");
    expect(frota.linhas[i + 1]).toMatchObject({ recurso: "modalidades", rotulo: "Motoristas › Modalidades", aba: true });
  });

  it("todo item do menu vira linha, mesmo dividindo a permissão com outro", () => {
    // O menu real não divide mais chave (ver menu-matriz.spec.ts), mas o
    // agrupamento continua cobrindo o caso: se um dia voltar, as duas telas
    // aparecem, cada uma no seu lugar, apontando uma pra outra — em vez de uma
    // sumir, que foi o que fez o dono não achar a Torre.
    const menu: MenuDescricao = [
      { titulo: "A", itens: [{ label: "Um", href: "/um", perm: "x.ver", abas: [] }] },
      { titulo: "B", itens: [{ label: "Dois", href: "/dois", perm: "x.ver", abas: [] }] },
    ];
    const linhas = agruparRecursosPorMenu(menu, ["x"]).flatMap((s) => s.linhas);
    expect(linhas.map((l) => [l.rotulo, l.tambemEm])).toEqual([
      ["Um", ["B › Dois"]],
      ["Dois", ["A › Um"]],
    ]);
  });

  it("aba que repete a chave do próprio item não vira linha (é a mesma tela)", () => {
    const menu: MenuDescricao = [
      { titulo: "A", itens: [{ label: "Um", href: "/um", perm: "x.ver", abas: [{ href: "/um/cfg", perm: "x.editar" }] }] },
    ];
    const linhas = agruparRecursosPorMenu(menu, ["x"]).flatMap((s) => s.linhas);
    expect(linhas.map((l) => l.rotulo)).toEqual(["Um"]);
  });

  it("no menu real, nenhuma linha anota \"mesma permissão de…\"", () => {
    const linhas = agruparRecursosPorMenu(menuDoSidebar(), RECURSOS).flatMap((s) => s.linhas);
    expect(linhas.filter((l) => l.tambemEm.length > 0).map((l) => `${l.rotulo} ↔ ${l.tambemEm.join(", ")}`)).toEqual([]);
    // As telas separadas em 23/09/2026 têm, cada uma, a sua linha.
    const rec = (rotulo: string) => linhas.find((l) => l.rotulo === rotulo)?.recurso;
    expect(rec("Torre de controle")).toBe("torre");
    expect(rec("Programação do dia")).toBe("programacao");
    expect(rec("Ao vivo")).toBe("ao-vivo");
    expect(rec("Viagens")).toBe("viagens");
    expect(rec("CT-e emitidos")).toBe("cte");
    expect(linhas.find((l) => l.recurso === "config-torre")?.aba).toBe(true);
    expect(linhas.find((l) => l.recurso === "config-cte")?.aba).toBe(true);
  });

  it("recurso fora do catálogo desta pessoa não vira linha; o que o menu não alcança vai pro fim", () => {
    const menu: MenuDescricao = [
      { titulo: "A", itens: [{ label: "Um", href: "/um", perm: "um.ver", abas: [{ href: "/x", perm: "fora.ver" }] }] },
    ];
    const secoes = agruparRecursosPorMenu(menu, ["solto", "um"]);
    expect(secoes.map((s) => [s.titulo, s.linhas.map((l) => l.recurso)])).toEqual([
      ["A", ["um"]],
      [SECAO_SEM_ITEM_NO_MENU, ["solto"]],
    ]);
  });
});
