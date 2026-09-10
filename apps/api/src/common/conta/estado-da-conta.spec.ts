import { describe, expect, it } from "vitest";
import {
  CODIGO_CONTA_SOMENTE_LEITURA,
  CODIGO_CONTA_SUSPENSA,
  diasAte,
  estadoDaConta,
  type ContaParaEstado,
} from "./estado-da-conta";

const AGORA = new Date("2026-09-10T12:00:00Z");

function conta(over: Partial<ContaParaEstado> = {}): ContaParaEstado {
  return { ativa: true, somenteLeitura: false, trialExpiraEm: null, motivoBloqueio: null, ...over };
}

describe("estadoDaConta", () => {
  it("cliente normal entra e escreve", () => {
    const e = estadoDaConta(conta(), AGORA);
    expect(e).toMatchObject({ podeEntrar: true, podeEscrever: true, emTeste: false, codigo: null });
  });

  it("suspensa não entra, e diz por quê", () => {
    const e = estadoDaConta(conta({ ativa: false }), AGORA);
    expect(e.podeEntrar).toBe(false);
    expect(e.codigo).toBe(CODIGO_CONTA_SUSPENSA);
    expect(e.motivo).toBeTruthy();
  });

  it("somente leitura ENTRA — é o ponto todo", () => {
    // O contrário disto (bloquear) é o que faz o cliente perder o acesso aos
    // próprios dados no dia em que o teste acaba.
    const e = estadoDaConta(conta({ somenteLeitura: true }), AGORA);
    expect(e.podeEntrar).toBe(true);
    expect(e.podeEscrever).toBe(false);
    expect(e.codigo).toBe(CODIGO_CONTA_SOMENTE_LEITURA);
  });

  it("teste vencido vira somente leitura na hora, sem esperar o cron", () => {
    // Senão o resultado dependeria de o cron da madrugada ter rodado.
    const ontem = new Date(AGORA.getTime() - 86_400_000);
    const e = estadoDaConta(conta({ trialExpiraEm: ontem }), AGORA);
    expect(e.podeEntrar).toBe(true);
    expect(e.podeEscrever).toBe(false);
    expect(e.motivo).toContain("teste terminou");
  });

  it("teste no prazo escreve normalmente e conta os dias", () => {
    const daquiA5 = new Date(AGORA.getTime() + 5 * 86_400_000);
    const e = estadoDaConta(conta({ trialExpiraEm: daquiA5 }), AGORA);
    expect(e.podeEscrever).toBe(true);
    expect(e.emTeste).toBe(true);
    expect(e.diasRestantes).toBe(5);
  });

  it("suspensa vence somente leitura", () => {
    const e = estadoDaConta(conta({ ativa: false, somenteLeitura: true }), AGORA);
    expect(e.codigo).toBe(CODIGO_CONTA_SUSPENSA);
    expect(e.podeEntrar).toBe(false);
  });

  it("motivo escrito à mão vence o texto padrão", () => {
    const e = estadoDaConta(conta({ ativa: false, motivoBloqueio: "Mensalidade em aberto." }), AGORA);
    expect(e.motivo).toBe("Mensalidade em aberto.");
  });

  it("nunca deixa escrever quem não pode entrar", () => {
    for (const c of [
      conta({ ativa: false }),
      conta({ ativa: false, somenteLeitura: true }),
      conta({ ativa: false, trialExpiraEm: new Date(AGORA.getTime() - 1) }),
    ]) {
      const e = estadoDaConta(c, AGORA);
      expect(e.podeEntrar || !e.podeEscrever).toBe(true);
    }
  });
});

describe("diasAte", () => {
  it("arredonda para cima, como uma pessoa conta", () => {
    // Meio dia restante é "falta 1 dia", não "falta 0".
    expect(diasAte(new Date(AGORA.getTime() + 43_200_000), AGORA)).toBe(1);
  });

  it("mesmo instante é zero", () => {
    expect(diasAte(AGORA, AGORA)).toBe(0);
  });

  it("passado é negativo", () => {
    expect(diasAte(new Date(AGORA.getTime() - 2 * 86_400_000), AGORA)).toBe(-2);
  });
});
