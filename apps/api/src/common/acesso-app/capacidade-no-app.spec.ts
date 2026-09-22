import { describe, expect, it } from "vitest";
import { capacidadeNaConta, type AcessoAppDaConta } from "@ronan/shared-types";

/**
 * O que o APP DO MOTORISTA decide com o acesso calculado (`capacidadeNaConta`,
 * usada em `motorista-app/lib/acessos-app.ts`). Mora aqui porque o app não tem
 * runner de teste, e esta é a única decisão nova da F3: todo o resto é "o item
 * aparece se aparecia antes E isto não disse false".
 *
 * Cada caso é um jeito de tirar do celular algo que a pessoa usa.
 */

const conta = (contaId: string, capacidades: AcessoAppDaConta["capacidades"]): AcessoAppDaConta => ({
  contaId,
  contaNome: contaId,
  capacidades,
  calculadoEm: "2026-09-22T00:00:00.000Z",
});

describe("o app lê a capacidade na empresa certa", () => {
  it("vale o que a empresa da sessão diz", () => {
    const acessos = [conta("A", ["app.chat.usar"])];
    expect(capacidadeNaConta(acessos, { sessao: "A", registrado: null }, "app.chat.usar")).toBe(true);
    expect(capacidadeNaConta(acessos, { sessao: "A", registrado: null }, "app.acertos.ver")).toBe(false);
  });

  it("parceiro na A e registrado na B: o ponto se decide na B", () => {
    // Olhar a A (a da sessão) sumiria com a aba de ponto que ele usa na B.
    const acessos = [conta("A", ["app.viagem.lancar"]), conta("B", ["app.ponto.bater"])];
    const contas = { sessao: "A", registrado: "B" };
    expect(capacidadeNaConta(acessos, contas, "app.ponto.bater")).toBe(true);
    // ...e o que é de motorista continua se decidindo na A.
    expect(capacidadeNaConta(acessos, contas, "app.viagem.lancar")).toBe(true);
    expect(capacidadeNaConta(acessos, contas, "app.chat.usar")).toBe(false);
  });

  it("quem só é registrado (sem sessão de motorista) usa a empresa do vínculo", () => {
    const acessos = [conta("B", ["app.ponto.bater", "app.documentos.enviar"])];
    const contas = { sessao: null, registrado: "B" };
    expect(capacidadeNaConta(acessos, contas, "app.ponto.bater")).toBe(true);
    expect(capacidadeNaConta(acessos, contas, "app.documentos.enviar")).toBe(true);
  });
});

describe("não saber nunca vira não poder", () => {
  it("sem nada guardado no aparelho (primeiro boot sem sinal)", () => {
    expect(capacidadeNaConta(undefined, { sessao: "A", registrado: null }, "app.ponto.bater")).toBeUndefined();
    expect(capacidadeNaConta(null, { sessao: "A", registrado: null }, "app.chat.usar")).toBeUndefined();
  });

  it("empresa sem linha calculada (cadastro de minutos atrás)", () => {
    const acessos = [conta("OUTRA", ["app.chat.usar"])];
    expect(capacidadeNaConta(acessos, { sessao: "A", registrado: null }, "app.chat.usar")).toBeUndefined();
  });

  it("sem empresa nenhuma (autônomo)", () => {
    expect(capacidadeNaConta([], { sessao: null, registrado: null }, "app.chat.usar")).toBeUndefined();
  });

  it("registrado na B sem linha da B ainda: o ponto fica 'não sei', não 'não pode'", () => {
    const acessos = [conta("A", [])];
    expect(capacidadeNaConta(acessos, { sessao: "A", registrado: "B" }, "app.ponto.bater")).toBeUndefined();
  });
});
