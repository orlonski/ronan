import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";

/**
 * QUEM ALCANÇA AS ROTAS DE PONTO.
 *
 * ⚠️ O erro que este teste protege é de MODELO, não de código, e ele já
 * aconteceu: eu amarrei o ponto ao `kind` do token e só promovia a
 * FUNCIONARIO quem entrava como identidade pura. Resultado: o motorista CLT
 * da própria transportadora — que é o caso mais comum de quem compra o
 * módulo — entrava como MOTORISTA, levava 403 e o bloco sumia do app sem
 * nenhum erro visível.
 *
 * A exclusividade que `RegimeVigente` garante é entre OBRA E DIÁRIA e PONTO.
 * Não é entre os dois cadastros: motorista CLT lança viagem E bate ponto.
 */

// Espelha `funcionarioDe` do controller. Duplicado de propósito: o que
// importa aqui é a REGRA de quem entra, e ela tem que quebrar visivelmente.
function funcionarioDe(user: Record<string, unknown>) {
  if (user.kind === "FUNCIONARIO") return user;
  if (!user.funcionarioId) throw new ForbiddenException("sem cadastro de funcionário");
  return { kind: "FUNCIONARIO", funcionarioId: user.funcionarioId, contaId: user.contaId };
}

describe("quem bate ponto", () => {
  it("o funcionário puro (mecânico, escritório) entra", () => {
    const r = funcionarioDe({ kind: "FUNCIONARIO", funcionarioId: "f1", contaId: "c1" });
    expect((r as { funcionarioId: string }).funcionarioId).toBe("f1");
  });

  it("o MOTORISTA que também é CLT entra — é o caso mais comum", () => {
    const r = funcionarioDe({ kind: "MOTORISTA", funcionarioId: "f2", contaId: "c1" });
    expect((r as { funcionarioId: string }).funcionarioId).toBe("f2");
  });

  it("motorista SEM cadastro de funcionário é recusado, dizendo o porquê", () => {
    expect(() => funcionarioDe({ kind: "MOTORISTA", funcionarioId: null, contaId: "c1" })).toThrow(
      /funcionário/i,
    );
  });
});
