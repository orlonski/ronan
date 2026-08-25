import { describe, it, expect } from "vitest";
import { StatusViagem } from "@prisma/client";
import {
  dispensaConferencia,
  carimbosDaDispensa,
  textoDispensa,
} from "./conferencia-dispensada";

describe("dispensaConferencia", () => {
  it("dispensa material marcado, em viagem completa", () => {
    expect(
      dispensaConferencia({ materialDispensa: true, statusDesejado: StatusViagem.ENVIADA }),
    ).toBe(true);
  });

  it("material sem a flag confere como sempre", () => {
    for (const materialDispensa of [false, null, undefined]) {
      expect(dispensaConferencia({ materialDispensa, statusDesejado: StatusViagem.ENVIADA })).toBe(
        false,
      );
    }
  });

  it("INCOMPLETA nunca dispensa — é justamente quando alguém precisa olhar", () => {
    // A viagem entrou faltando km, local, cliente ou apontando pra cadastro que
    // sumiu. Aprovar aqui esconderia o buraco dentro do faturamento, que é o
    // lugar onde ninguém revisa mais.
    expect(
      dispensaConferencia({ materialDispensa: true, statusDesejado: StatusViagem.INCOMPLETA }),
    ).toBe(false);
  });

  it("viagem que ainda não terminou nunca dispensa", () => {
    // A aprovação vem quando ela se completar — completarPeso e encerrarDiaria
    // passam por esta mesma regra de novo.
    for (const statusDesejado of [
      StatusViagem.AGUARDANDO_PESO,
      StatusViagem.AGUARDANDO_SAIDA,
      StatusViagem.EM_ANDAMENTO,
    ]) {
      expect(dispensaConferencia({ materialDispensa: true, statusDesejado })).toBe(false);
    }
  });

  it("viagem que já tem decisão nunca é dispensada — robô não passa por cima de gente", () => {
    for (const statusDesejado of [
      StatusViagem.OK,
      StatusViagem.DIVERGENTE,
      StatusViagem.AJUSTADA,
      StatusViagem.EM_CONFERENCIA,
    ]) {
      expect(dispensaConferencia({ materialDispensa: true, statusDesejado })).toBe(false);
    }
  });
});

describe("carimbosDaDispensa", () => {
  const agora = new Date("2026-08-25T12:00:00Z");

  it("aprova e carimba os dois campos juntos", () => {
    const c = carimbosDaDispensa(agora);
    expect(c.status).toBe(StatusViagem.OK);
    expect(c.revisadoEm).toBe(agora);
    expect(c.conferenciaDispensadaEm).toBe(agora);
  });

  it("NUNCA preenche revisadoPorId — não há User por trás", () => {
    // É o espelho do teste que trava a mesma regra na conferência automática, e
    // que o código de lá chama de "a regressão mais cara do projeto".
    expect(carimbosDaDispensa(agora)).not.toHaveProperty("revisadoPorId");
    expect(carimbosDaDispensa(agora)).not.toHaveProperty("revisadoPor");
  });

  it("nunca carimba conferidoPorIaEm — nenhuma IA leu nada aqui", () => {
    // O campo do irmão significa "a IA leu o documento e aprovou". Usar ele
    // faria a tela mentir sobre o que aconteceu.
    expect(carimbosDaDispensa(agora)).not.toHaveProperty("conferidoPorIaEm");
  });
});

describe("textoDispensa", () => {
  it("usa o nome real do material, não 'concreto' fixo", () => {
    expect(textoDispensa("Concreto usinado")).toContain("Concreto usinado");
    expect(textoDispensa("Argamassa")).toContain("Argamassa");
  });

  it("aguenta material sem nome sem soar quebrado", () => {
    for (const vazio of [null, undefined, "   "]) {
      expect(textoDispensa(vazio)).toMatch(/^Este material não gera/);
    }
  });

  it("diz ao motorista que não falta nada da parte dele", () => {
    // Sem isto ele fica na dúvida se esqueceu de mandar a foto.
    expect(textoDispensa("Concreto")).toMatch(/não falta nada da sua parte/i);
  });
});
