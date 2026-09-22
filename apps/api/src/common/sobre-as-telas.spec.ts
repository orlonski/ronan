import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "PARA QUE SERVE ESTA TELA" não pode falar de tela que não existe.
 *
 * ⚠️ A explicação promete duas coisas: que esta rota é uma tela de verdade, e
 * que o atalho "procurando X? é em Y" leva a algum lugar. Texto que aponta pra
 * rota morta é pior que ausência de texto — manda a pessoa procurar o que não
 * existe, com a autoridade de quem estava ensinando.
 *
 * É a mesma regra do QA do Instagram, que barrou cinco peças que pareciam
 * verdade e não eram: nada vai pro ar sem existir no código.
 */

const DASH = resolve(__dirname, "../../../dashboard/src");
const catalogo = readFileSync(`${DASH}/lib/sobre-as-telas.ts`, "utf8");
const sidebar = readFileSync(`${DASH}/components/sidebar.tsx`, "utf8");

/** As rotas do menu — é a lista do que a pessoa consegue alcançar clicando. */
const rotasDoMenu = new Set(
  [...sidebar.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]!),
);

/** As chaves do catálogo: `"/rota": {` no primeiro nível. */
const explicadas = [...catalogo.matchAll(/^\s{2}"(\/[^"]*)":\s*\{/gm)].map((m) => m[1]!);

/** Os destinos do "procurando X? é em Y". */
const atalhos = [...catalogo.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]!);

describe("catálogo de explicações", () => {
  it("o teste está mesmo lendo os dois arquivos", () => {
    // Sem isto, um regex que para de casar vira suíte verde sobre nada.
    expect(rotasDoMenu.size).toBeGreaterThan(40);
    expect(explicadas.length).toBeGreaterThan(0);
  });

  it("toda tela explicada existe no menu", () => {
    expect(explicadas.filter((r) => !rotasDoMenu.has(r))).toEqual([]);
  });

  it("todo atalho 'procurando X? é em Y' leva a uma tela do menu", () => {
    expect(atalhos.filter((r) => !rotasDoMenu.has(r))).toEqual([]);
  });

  it("tela explicada que só redireciona precisa cobrir o destino", () => {
    /**
     * ⚠️ O casamento é por rota exata, então explicação escrita pra uma rota
     * que só faz `redirect()` é texto que NUNCA aparece — e ninguém descobre,
     * porque o arquivo fica perfeito e o teste antigo (a rota existe no menu?)
     * passa. Foi o caso de `/relatorios`, que manda pra `/relatorios/viagens`.
     *
     * Quem redireciona tem que declarar o destino em `tambemEm`.
     */
    const perdidas: string[] = [];
    for (const rota of explicadas) {
      const pagina = `${DASH}/app/(painel)${rota === "/" ? "" : rota}/page.tsx`;
      let codigo: string;
      try {
        codigo = readFileSync(pagina, "utf8");
      } catch {
        continue; // rota sem página própria (grupo de rotas) — não é este teste
      }
      const destino = codigo.match(/^\s*redirect\("([^"]+)"/m)?.[1];
      if (!destino) continue;
      const bloco = catalogo.split(`"${rota}": {`)[1]?.split(/^\s{2}"\//m)[0] ?? "";
      if (!bloco.includes(`"${destino}"`)) perdidas.push(`${rota} → ${destino}`);
    }
    expect(perdidas).toEqual([]);
  });

  it("o atalho chama a tela pelo nome que o menu usa HOJE", () => {
    /**
     * ⚠️ O `vaEm` é o rótulo que a pessoa vai procurar na barra lateral. Ele
     * foi copiado do menu na hora de escrever — e cópia envelhece: renomeie um
     * item e a explicação passa a mandar procurar uma palavra que não existe
     * mais, com a confiança de quem está ensinando.
     *
     * É o mesmo defeito que já aconteceu entre o menu e a matriz de papéis, e
     * lá ninguém percebeu até contar 25 divergências.
     */
    const rotulos = new Map(
      [...sidebar.matchAll(/href:\s*"(\/[^"]*)",\s*label:\s*"([^"]+)"/g)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
    const errados = [
      ...catalogo.matchAll(/vaEm:\s*"([^"]+)",\s*href:\s*"(\/[^"]*)"/g),
    ]
      .filter(([, vaEm, href]) => rotulos.has(href!) && rotulos.get(href!) !== vaEm)
      .map(([, vaEm, href]) => `${href}: explicação diz "${vaEm}", menu diz "${rotulos.get(href!)}"`);
    expect(errados).toEqual([]);
  });

  it("ninguém se manda pra si mesmo", () => {
    // "Procurando outra coisa? vá pra esta mesma tela" é o tipo de erro que
    // só aparece lendo, porque o código fica perfeitamente válido.
    const blocos = catalogo.split(/^\s{2}"(?=\/)/m).slice(1);
    const circulares = blocos
      .map((b) => ({ rota: "/" + b.split('"')[0], destino: b.match(/href:\s*"(\/[^"]*)"/)?.[1] }))
      .filter((x) => x.destino && x.destino === x.rota)
      .map((x) => x.rota);
    expect(circulares).toEqual([]);
  });
});
