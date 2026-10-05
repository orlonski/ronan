import { describe, expect, it } from "vitest";
import { rankearCandidatosDuplicata } from "@ronan/shared-types";

/**
 * O ranqueador roda no app, offline, quando o motorista vai cadastrar um local
 * novo. Caso real (05/10/2026): na carga, todos os locais do cliente entravam
 * como "já visto", e "Mercado Municipal" a 399 km virou "Opa! Já tem um local
 * aqui" pra quem cadastrava a própria rua.
 */
describe("rankearCandidatosDuplicata", () => {
  it("local visto em outra região, com nome diferente, não é suspeito", () => {
    const [c] = rankearCandidatosDuplicata({
      nomeDigitado: "Salomão Tuma 245",
      candidatos: [
        { id: "m", nome: "Mercado Municipal SW São Paulo", distanciaM: 399_000, jaVisto: true },
      ],
    });
    expect(c!.confianca).toBe("baixa");
  });

  it("local que ele acabou de ver na mesma região segue pedindo confirmação", () => {
    const [c] = rankearCandidatosDuplicata({
      nomeDigitado: "Pátio novo",
      candidatos: [{ id: "p", nome: "Pedreira Central", distanciaM: 900, jaVisto: true }],
    });
    expect(c!.confianca).toBe("media");
  });

  it("nome quase igual é suspeito em qualquer distância", () => {
    const [c] = rankearCandidatosDuplicata({
      nomeDigitado: "Pedreira Central",
      candidatos: [{ id: "p", nome: "Pedreira Central", distanciaM: 399_000 }],
    });
    expect(c!.confianca).toBe("alta");
  });
});
