import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RECURSOS_LABEL } from "@ronan/shared-types";

/**
 * O MENU E A MATRIZ DE PAPÉIS TÊM QUE FALAR A MESMA LÍNGUA.
 *
 * ⚠️ Quem monta um papel em `/configuracoes/permissoes` marca uma linha pelo
 * NOME. Se esse nome não for o que está no menu, ele libera "Fechamentos" e o
 * colega procura "Planilhas dos clientes" a tarde inteira. Chegaram a existir
 * 22 recursos assim — e mais da metade nasceu numa reorganização do menu que
 * renomeou os itens e deixou o catálogo para trás. Foi barato renomear
 * justamente porque nada cobrava a outra ponta.
 *
 * A regra é frouxa de propósito: o rótulo da matriz precisa CONTER o do menu,
 * não ser igual. Assim "Conferência de ticket (IA)" continua podendo explicar
 * mais do que o menu explica, sem virar outro nome.
 *
 * ⚠️ Este teste mora em `apps/api` porque é o único pacote com runner. Ele lê
 * o arquivo do dashboard pelo caminho — se o menu mudar de lugar, aqui quebra,
 * e quebrar é o comportamento certo: um invariante que se desliga sozinho
 * quando alguém move um arquivo não protege nada.
 */

const SIDEBAR = resolve(__dirname, "../../../dashboard/src/components/sidebar.tsx");

const ABAS = resolve(__dirname, "../../../dashboard/src/components/abas-da-tela.tsx");
const PERMISSOES_DASH = resolve(__dirname, "../../../dashboard/src/lib/permissoes.ts");

/**
 * Recursos que alimentam MAIS DE UMA tela, onde o rótulo da matriz descreve o
 * conjunto em vez de repetir um dos nomes. Entrar aqui é decisão, não desvio.
 *
 * Vazio desde 23/09/2026: `programacao`, `viagens` e `cte` estavam aqui e cada
 * tela ganhou a sua chave (ver "uma tela, uma permissão" abaixo).
 */
const VARIAS_TELAS = new Set<string>([]);

/**
 * Pares de rotas que PODEM dividir o recurso, porque são a mesma tela com
 * outro endereço. Cada entrada precisa do porquê — "dá trabalho separar" não é
 * motivo: foi exatamente assim que Torre e Programação ficaram presas juntas.
 */
const MESMA_TELA: { rotas: [string, string]; porque: string }[] = [];

/** Todo lugar do menu (item, aba do `ou` e aba da tela) → recurso da permissão. */
function lugaresDoMenu(): { href: string; recurso: string; onde: string }[] {
  const lugares: { href: string; recurso: string; onde: string }[] = [];
  const sidebar = readFileSync(SIDEBAR, "utf8");
  // Item com rótulo e as abas do `ou` (href sem label): o `perm` que vem logo
  // depois do href é o dele.
  for (const m of sidebar.matchAll(/href:\s*"([^"]+)"(?:,\s*label:\s*"[^"]+")?(?:,\s*icon:\s*\w+)?,\s*perm:\s*"([^".]+)\./g)) {
    lugares.push({ href: m[1]!, recurso: m[2]!, onde: "sidebar" });
  }
  // Itens escritos em várias linhas (href, label, icon e perm um por linha).
  for (const m of sidebar.matchAll(/href:\s*"([^"]+)",\s*\n\s*label:\s*"[^"]+",\s*\n\s*icon:\s*\w+,\s*\n\s*perm:\s*"([^".]+)\./g)) {
    lugares.push({ href: m[1]!, recurso: m[2]!, onde: "sidebar" });
  }
  const abas = readFileSync(ABAS, "utf8");
  for (const m of abas.matchAll(/href:\s*"([^"]+)",\s*label:\s*"[^"]+",\s*perm:\s*"([^".]+)\./g)) {
    lugares.push({ href: m[1]!, recurso: m[2]!, onde: "abas" });
  }
  return lugares;
}

function itensDoMenu(): { label: string; recurso: string }[] {
  const codigo = readFileSync(SIDEBAR, "utf8");
  return [...codigo.matchAll(/href:\s*"[^"]+",\s*label:\s*"([^"]+)",[^}]*?perm:\s*"([^".]+)\./g)].map(
    (m) => ({ label: m[1]!, recurso: m[2]! }),
  );
}

describe("menu e matriz de permissões", () => {
  it("o menu não aponta pra recurso que não existe no catálogo", () => {
    const orfaos = itensDoMenu()
      .filter((i) => !RECURSOS_LABEL[i.recurso])
      .map((i) => `${i.label} → ${i.recurso}`);
    expect(orfaos).toEqual([]);
  });

  it("quem procura pelo nome do menu acha a linha na matriz", () => {
    const perdidos = itensDoMenu()
      .filter((i) => !VARIAS_TELAS.has(i.recurso))
      .filter((i) => !(RECURSOS_LABEL[i.recurso] ?? "").toLowerCase().includes(i.label.toLowerCase()))
      .map((i) => `${i.recurso}: matriz diz "${RECURSOS_LABEL[i.recurso]}", menu diz "${i.label}"`);
    expect(perdidos).toEqual([]);
  });

  /**
   * UMA TELA, UMA PERMISSÃO.
   *
   * Decisão do dono (23/09/2026): todo item do menu e toda aba têm chave
   * própria, pra o escritório poder liberar uma tela sem a outra. Antes, Torre
   * de controle, a aba "Quando avisar" e Programação do dia eram `programacao`;
   * Ao vivo e Viagens eram `viagens`; CT-e emitidos e o Emissor de CT-e eram
   * `cte` — dar uma entregava a outra, e a matriz não tinha como separar.
   */
  it("nenhum item ou aba do menu divide o recurso de permissão com outra tela", () => {
    const porRecurso = new Map<string, Set<string>>();
    for (const l of lugaresDoMenu()) {
      porRecurso.set(l.recurso, (porRecurso.get(l.recurso) ?? new Set()).add(l.href));
    }
    const permitido = (a: string, b: string) =>
      MESMA_TELA.some(({ rotas: [x, y] }) => (x === a && y === b) || (x === b && y === a));
    const divididos: string[] = [];
    for (const [recurso, hrefs] of porRecurso) {
      const lista = [...hrefs];
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          if (!permitido(lista[i]!, lista[j]!)) divididos.push(`${recurso}: ${lista[i]} e ${lista[j]}`);
        }
      }
    }
    expect(divididos).toEqual([]);
  });

  it("a rota de cada item e aba pede a MESMA chave que o menu mostra", () => {
    // Sem isto, o menu pode mostrar a tela por `torre.ver` e o TelaGuard barrar
    // por `programacao.ver` — ou o contrário, abrir por URL pra quem o menu esconde.
    const rotas = [...readFileSync(PERMISSOES_DASH, "utf8").matchAll(/prefixo:\s*"([^"]+)",\s*perm:\s*"([^"]+)"/g)].map(
      (m) => ({ prefixo: m[1]!, perm: m[2]! }),
    );
    const permDaRota = (href: string) =>
      rotas.find((r) => href === r.prefixo || href.startsWith(`${r.prefixo}/`))?.perm.split(".")[0];
    const divergentes = lugaresDoMenu()
      .filter((l) => permDaRota(l.href) !== l.recurso)
      .map((l) => `${l.href}: ${l.onde} diz ${l.recurso}, ROTA_PERM diz ${permDaRota(l.href)}`);
    expect(divergentes).toEqual([]);
  });

  it("o invariante de uma-tela-uma-permissão está mesmo lendo menu e abas", () => {
    const lugares = lugaresDoMenu();
    expect(lugares.filter((l) => l.onde === "sidebar").length).toBeGreaterThan(50);
    expect(lugares.filter((l) => l.onde === "abas").length).toBeGreaterThan(20);
    // As três telas que motivaram a regra têm que estar sendo lidas.
    for (const href of ["/torre", "/configuracoes/torre", "/programacao", "/viagens-andamento", "/cte", "/configuracoes/cte"]) {
      expect(lugares.some((l) => l.href === href)).toBe(true);
    }
  });

  it("o teste está mesmo lendo o menu (senão ele passaria vazio pra sempre)", () => {
    // Um regex que para de casar vira suíte verde sobre nada. O número não
    // precisa ser exato; precisa ser grande o bastante pra provar que leu.
    expect(itensDoMenu().length).toBeGreaterThan(35);
  });
});
