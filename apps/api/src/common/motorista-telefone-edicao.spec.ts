import { describe, expect, it } from "vitest";
import { AtualizarMotoristaInput } from "@ronan/shared-types";

// Bug real (29/09/2026): apagar o telefone na ficha salvava com toast verde e
// nada mudava — o formulário mandava o campo vazio como ausente e `null` era
// recusado. `null` é o "apagar"; ausente ou vazio é "não mudar".
describe("edição do motorista: telefone", () => {
  it("null apaga o telefone", () => {
    const r = AtualizarMotoristaInput.parse({ telefone: null });
    expect(r.telefone).toBeNull();
  });

  it("campo ausente ou vazio NÃO muda o telefone", () => {
    expect(AtualizarMotoristaInput.parse({}).telefone).toBeUndefined();
    expect(AtualizarMotoristaInput.parse({ telefone: "" }).telefone).toBeUndefined();
    expect(AtualizarMotoristaInput.parse({ telefone: "  " }).telefone).toBeUndefined();
  });

  it("número com máscara vira só dígitos", () => {
    expect(AtualizarMotoristaInput.parse({ telefone: "(42) 99842-4945" }).telefone).toBe("42998424945");
  });

  it("número inválido continua recusado", () => {
    expect(AtualizarMotoristaInput.safeParse({ telefone: "123" }).success).toBe(false);
  });
});
