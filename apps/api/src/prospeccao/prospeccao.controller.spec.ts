import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { RequestMethod } from "@nestjs/common";
import { ProspeccaoController } from "./prospeccao.controller";

/**
 * Guarda contra rota que some sem ninguém perceber.
 *
 * Uma rota apagada NÃO quebra o typecheck (o método do service continua
 * existindo, só fica sem quem o chame) e não quebra teste de regra pura. O
 * sintoma aparece em produção, como "Cannot POST /admin/prospeccao/...", depois
 * de alguém clicar no botão.
 *
 * Foi exatamente o que aconteceu com `importar-rntrc`: uma edição no bloco de
 * rotas levou junto a rota vizinha, e os 589 testes seguiram verdes.
 */

const METODO: Record<number, string> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PUT]: "PUT",
};

/** Lê do metadata do Nest o que o controller realmente expõe. */
function rotasDe(controller: new (...args: never[]) => unknown): Set<string> {
  const proto = controller.prototype as Record<string, unknown>;
  const rotas = new Set<string>();

  for (const nome of Object.getOwnPropertyNames(proto)) {
    if (nome === "constructor") continue;
    const handler = proto[nome];
    if (typeof handler !== "function") continue;

    const caminho = Reflect.getMetadata("path", handler) as string | undefined;
    const metodo = Reflect.getMetadata("method", handler) as number | undefined;
    if (caminho === undefined || metodo === undefined) continue;

    rotas.add(`${METODO[metodo] ?? metodo} ${caminho}`);
  }

  return rotas;
}

describe("ProspeccaoController — as rotas que a tela chama", () => {
  const rotas = rotasDe(ProspeccaoController);

  // Cada uma corresponde a um botão ou a uma tela. Sumir qualquer uma é bug em
  // produção — se alguma sair de propósito, tire daqui na mesma mudança.
  const esperadas = [
    "GET resumo",
    "GET leads",
    "GET leads/:id",
    "PATCH leads/:id",
    "POST leads/:id/interacoes",
    "POST importar-rntrc",
    "POST enriquecer",
    "POST recalcular-scores",
    "POST opt-out",
  ];

  for (const rota of esperadas) {
    it(`expõe ${rota}`, () => {
      expect(rotas).toContain(rota);
    });
  }

  it("não expõe nada além do declarado aqui", () => {
    expect([...rotas].sort()).toEqual([...esperadas].sort());
  });
});
