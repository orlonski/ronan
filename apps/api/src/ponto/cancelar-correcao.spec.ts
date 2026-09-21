import { describe, expect, it } from "vitest";
import { PontoService } from "./ponto.service";
import type { AuthFuncionario } from "../auth/types";

/**
 * Cancelar o PRÓPRIO pedido enquanto ninguém decidiu.
 *
 * A linha que este teste guarda: pedido pendente é rascunho, registro é
 * prova. Cancelar o rascunho não encosta em `ponto_marcacoes` — mas o guard
 * tem que impedir os três casos em que o "rascunho" já virou outra coisa.
 */

const USER = { kind: "FUNCIONARIO", funcionarioId: "f1", contaId: "c1" } as AuthFuncionario;

function servico(correcao: Record<string, unknown> | null) {
  const apagados: string[] = [];
  const prisma = {
    correcaoPonto: {
      findFirst: async () => correcao,
      delete: async ({ where }: { where: { id: string } }) => {
        apagados.push(where.id);
        return {};
      },
    },
  };
  return { s: new PontoService(prisma as never, {} as never), apagados };
}

describe("cancelar pedido de correção", () => {
  it("cancela o próprio pedido pendente", async () => {
    const { s, apagados } = servico({ id: "x", status: "PENDENTE", pedidoPor: "FUNCIONARIO" });
    await s.cancelarCorrecao(USER, "x");
    expect(apagados).toEqual(["x"]);
  });

  it("NÃO cancela o que já foi decidido — virou parte do documento", async () => {
    const { s, apagados } = servico({ id: "x", status: "APROVADA", pedidoPor: "FUNCIONARIO" });
    await expect(s.cancelarCorrecao(USER, "x")).rejects.toThrow(/já foi decidido/i);
    expect(apagados).toEqual([]);
  });

  it("NÃO cancela lançamento do escritório — aquilo não é dele pra desfazer", async () => {
    const { s, apagados } = servico({ id: "x", status: "PENDENTE", pedidoPor: "GESTOR" });
    await expect(s.cancelarCorrecao(USER, "x")).rejects.toThrow(/escritório/i);
    expect(apagados).toEqual([]);
  });

  it("pedido de outra pessoa nem é encontrado", async () => {
    // O `where` leva o funcionarioId junto: não existe caminho pra alcançar
    // o pedido de outro, nem sabendo o id.
    const { s } = servico(null);
    await expect(s.cancelarCorrecao(USER, "x")).rejects.toThrow(/não encontrado/i);
  });
});
