import { describe, expect, it } from "vitest";
import {
  ACESSOS_APP,
  ACESSOS_APP_CHAVES,
  ACESSOS_APP_GRUPOS,
  diferencasDoPerfil,
} from "@ronan/shared-types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * O CATÁLOGO DE ACESSOS DO APP e a conta de exceções.
 *
 * ⚠️ O catálogo é a espinha: o painel monta a tela a partir dele e o perfil
 * guarda os valores. Se uma chave daqui não existir como coluna no `Motorista`
 * ou no `PerfilAcessoApp`, o perfil grava um campo que ninguém lê — e o
 * escritório liga um interruptor que não faz nada, que é pior que não ter o
 * interruptor.
 */

const SCHEMA = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");

function colunasDe(model: string): Set<string> {
  const bloco = SCHEMA.split(`model ${model} {`)[1]?.split("\n}")[0] ?? "";
  return new Set([...bloco.matchAll(/^\s{2}(\w+)\s+/gm)].map((m) => m[1]!));
}

describe("catálogo de acessos do app", () => {
  it("toda chave existe como coluna no Motorista", () => {
    const cols = colunasDe("Motorista");
    expect(ACESSOS_APP_CHAVES.filter((c) => !cols.has(c))).toEqual([]);
  });

  it("toda chave existe como coluna no perfil", () => {
    // Senão o perfil não consegue guardar o valor que promete aplicar.
    const cols = colunasDe("PerfilAcessoApp");
    expect(ACESSOS_APP_CHAVES.filter((c) => !cols.has(c))).toEqual([]);
  });

  it("e o perfil não carrega acesso que o catálogo não conhece", () => {
    /**
     * ⚠️ O outro lado, e é o que evita interruptor fantasma: coluna `pode*` no
     * perfil sem entrada no catálogo nunca aparece na tela — ninguém liga, e o
     * dado fica lá parecendo que alguém decidiu alguma coisa.
     */
    const doPerfil = [...colunasDe("PerfilAcessoApp")].filter((c) => c.startsWith("pode"));
    const conhecidas = new Set<string>(ACESSOS_APP_CHAVES);
    expect(doPerfil.filter((c) => !conhecidas.has(c))).toEqual([]);
  });

  it("todo acesso tem rótulo, efeito e grupo válido", () => {
    for (const a of ACESSOS_APP) {
      expect(a.label.length, a.chave).toBeGreaterThan(3);
      // O "efeito" é o que a tela mostra embaixo do rótulo: sem ele, o
      // escritório decide no escuro o que muda no celular do motorista.
      expect(a.efeito.length, a.chave).toBeGreaterThan(15);
      expect(ACESSOS_APP_GRUPOS).toContain(a.grupo);
    }
  });

  it("o que custa dinheiro está marcado", () => {
    // O painel antigo entregava a leitura de ticket por IA LIGADA por omissão:
    // o operador acendia um custo recorrente sem ver. A marca é o que permite a
    // tela avisar.
    const ocr = ACESSOS_APP.find((a) => a.chave === "podeUsarOcrTicket");
    expect(ocr?.custa).toBe(true);
  });
});

describe("diferenças do perfil", () => {
  const todos = Object.fromEntries(ACESSOS_APP_CHAVES.map((c) => [c, true]));
  const nenhum = Object.fromEntries(ACESSOS_APP_CHAVES.map((c) => [c, false]));

  it("igual ao perfil não tem diferença nenhuma", () => {
    expect(diferencasDoPerfil(todos, todos)).toEqual([]);
  });

  it("sem perfil não existe diferença — não há de quê divergir", () => {
    expect(diferencasDoPerfil(todos, null)).toEqual([]);
  });

  it("aponta o acesso A MAIS, com o rótulo de gente", () => {
    const pessoa = { ...nenhum, podeUsarOcrTicket: true };
    const d = diferencasDoPerfil(pessoa, nenhum);
    expect(d).toHaveLength(1);
    expect(d[0]!.chave).toBe("podeUsarOcrTicket");
    expect(d[0]!.label).toBe("Ler o ticket por foto");
    expect(d[0]!.pessoa).toBe(true);
    expect(d[0]!.perfil).toBe(false);
  });

  it("e o acesso A MENOS, que é o que some sem ninguém perceber", () => {
    const pessoa = { ...todos, podeChat: false };
    const d = diferencasDoPerfil(pessoa, todos);
    expect(d.map((x) => x.chave)).toEqual(["podeChat"]);
    expect(d[0]!.pessoa).toBe(false);
  });

  it("campo ausente conta como desligado, não como igual", () => {
    // Cadastro antigo pode não ter a coluna no objeto que chegou na tela.
    expect(diferencasDoPerfil({}, { ...nenhum, podeChat: true })).toHaveLength(1);
  });
});
