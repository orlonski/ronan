import { describe, expect, it } from "vitest";
import { situacao } from "./documentos-pessoais.service";

/** Dias a partir de hoje, no mesmo dia civil que o serviço usa. */
function emDias(dias: number): Date {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${hoje}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

describe("a carteira do motorista", () => {
  it("documento que não vence não fica cobrando nada dele", () => {
    // CPF e comprovante de residência não têm validade — e um alerta permanente
    // na tela só ensinaria ele a ignorar a tela.
    expect(situacao("IDENTIDADE_CPF", null).status).toBe("SEM_VALIDADE");
  });

  it("vencido é vencido, e diz há quantos dias", () => {
    const r = situacao("CNH", emDias(-5));
    expect(r.status).toBe("VENCIDO");
    expect(r.dias).toBe(-5);
  });

  it("CNH avisa faltando 30 dias", () => {
    expect(situacao("CNH", emDias(31)).status).toBe("EM_DIA");
    expect(situacao("CNH", emDias(30)).status).toBe("VENCENDO");
  });

  it("o toxicológico avisa MUITO antes — 60 dias", () => {
    // O exame demora pra sair e a multa é automática 30 dias DEPOIS do
    // vencimento (art. 165-D): avisar em cima da hora seria avisar tarde.
    expect(situacao("EXAME_TOXICOLOGICO", emDias(45)).status).toBe("VENCENDO");
    expect(situacao("CNH", emDias(45)).status).toBe("EM_DIA");
  });

  it("vence hoje ainda não está vencido", () => {
    // O documento vale o dia inteiro do vencimento — declarar vencido de manhã
    // mandaria ele parar de rodar um dia antes da hora.
    expect(situacao("CNH", emDias(0)).status).toBe("VENCENDO");
    expect(situacao("CNH", emDias(0)).dias).toBe(0);
  });
});
