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

/**
 * Recursos que alimentam MAIS DE UMA tela, onde o rótulo da matriz descreve o
 * conjunto em vez de repetir um dos nomes. Entrar aqui é decisão, não desvio.
 */
const VARIAS_TELAS = new Set(["programacao", "viagens", "cte"]);

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

  it("o teste está mesmo lendo o menu (senão ele passaria vazio pra sempre)", () => {
    // Um regex que para de casar vira suíte verde sobre nada. O número não
    // precisa ser exato; precisa ser grande o bastante pra provar que leu.
    expect(itensDoMenu().length).toBeGreaterThan(40);
  });
});
