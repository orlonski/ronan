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
