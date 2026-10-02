import { describe, expect, it } from "vitest";
import { SELECT_VIAGEM_PUBLICA } from "./viagem-publica";

/**
 * O comprovante público não leva R$ (decisão do dono, 01/10/2026). A trava é
 * no SELECT: o que não é lido do banco não tem como vazar no payload.
 */
describe("comprovante público sem dinheiro", () => {
  it("o select não lê nenhum campo de valor", () => {
    const chaves = JSON.stringify(SELECT_VIAGEM_PUBLICA);
    expect(chaves).not.toMatch(/valor|pedagio|preco|frete/i);
  });
});
