import { describe, expect, it } from "vitest";
import {
  acaoDaRegua,
  competenciaDe,
  diasDeAtraso,
  formaDoGateway,
  formatarData,
  formatarReais,
  proximaCompetencia,
  rotuloCompetencia,
  statusDoGateway,
  sufixoDoLink,
  vencimentoDe,
  type CobrancaParaRegua,
} from "./assinatura-cobranca";

/** Uma cobrança em aberto, vencendo no dia informado. */
function cobranca(over: Partial<CobrancaParaRegua> = {}): CobrancaParaRegua {
  return {
    status: "PENDENTE",
    vencimento: new Date(Date.UTC(2026, 8, 10)),
    avisoAbertaEm: null,
    avisoAtrasoEm: null,
    avisosAtraso: 0,
    ...over,
  };
}

/** Meio-dia de Brasília do dia pedido — longe de qualquer fronteira de fuso. */
function meioDia(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, 15));
}

describe("competência e vencimento", () => {
  it("a competência é o primeiro dia do mês da data", () => {
    expect(competenciaDe(meioDia(2026, 9, 23))).toEqual(new Date(Date.UTC(2026, 8, 1)));
  });

  it("às 22h de Brasília o mês ainda é o de hoje, não o de amanhã em UTC", () => {
    // 30/09 às 22h BR = 01/10 01:00Z. Ancorar em UTC jogaria a competência
    // inteira pro mês seguinte — todo fim de mês, para todo mundo.
    const fimDoMesTarde = new Date(Date.UTC(2026, 9, 1, 1));
    expect(competenciaDe(fimDoMesTarde)).toEqual(new Date(Date.UTC(2026, 8, 1)));
  });

  it("a competência seguinte vira o ano", () => {
    expect(proximaCompetencia(new Date(Date.UTC(2026, 11, 1)))).toEqual(
      new Date(Date.UTC(2027, 0, 1)),
    );
  });

  it("o vencimento cai no dia combinado", () => {
    expect(vencimentoDe(new Date(Date.UTC(2026, 8, 1)), 10)).toEqual(
      new Date(Date.UTC(2026, 8, 10)),
    );
  });

  it("dia 31 numa assinatura antiga prende no último dia do mês, não vaza pro mês seguinte", () => {
    // Fevereiro de 2026 tem 28 dias. Sem o clamp isto viraria 3 de março.
    expect(vencimentoDe(new Date(Date.UTC(2026, 1, 1)), 31)).toEqual(
      new Date(Date.UTC(2026, 1, 28)),
    );
  });
});

describe("dias de atraso", () => {
  it("vencer hoje é zero, não um", () => {
    expect(diasDeAtraso(new Date(Date.UTC(2026, 8, 10)), meioDia(2026, 9, 10))).toBe(0);
  });

  it("antes do vencimento é negativo", () => {
    expect(diasDeAtraso(new Date(Date.UTC(2026, 8, 10)), meioDia(2026, 9, 7))).toBe(-3);
  });

  it("depois do vencimento é positivo", () => {
    expect(diasDeAtraso(new Date(Date.UTC(2026, 8, 10)), meioDia(2026, 9, 25))).toBe(15);
  });
});

describe("a régua de aviso", () => {
  it("não avisa quando ainda falta muito", () => {
    const r = acaoDaRegua(cobranca(), meioDia(2026, 9, 1));
    expect(r.tipo).toBe("NADA");
  });

  it("avisa que está aberta três dias antes", () => {
    const r = acaoDaRegua(cobranca(), meioDia(2026, 9, 7));
    expect(r).toEqual({ tipo: "AVISAR_ABERTA", diasParaVencer: 3 });
  });

  it("não repete o aviso de abertura", () => {
    const r = acaoDaRegua(
      cobranca({ avisoAbertaEm: new Date(Date.UTC(2026, 8, 7)) }),
      meioDia(2026, 9, 8),
    );
    expect(r.tipo).toBe("NADA");
  });

  it("no dia do vencimento não cobra: o dinheiro ainda pode entrar", () => {
    const r = acaoDaRegua(cobranca(), meioDia(2026, 9, 10));
    expect(r).toEqual({ tipo: "NADA", motivo: "vence hoje" });
  });

  it("avisa o atraso no dia seguinte ao vencimento", () => {
    const r = acaoDaRegua(cobranca(), meioDia(2026, 9, 11));
    expect(r).toEqual({ tipo: "AVISAR_ATRASO", diasDeAtraso: 1 });
  });

  it("não manda dois avisos no mesmo dia, mesmo se o cron rodar de novo", () => {
    const r = acaoDaRegua(
      cobranca({ avisosAtraso: 1, avisoAtrasoEm: new Date(Date.UTC(2026, 8, 11)) }),
      meioDia(2026, 9, 11),
    );
    expect(r.tipo).toBe("NADA");
  });

  it("depois do primeiro aviso, espera o marco de 7 dias em vez de cobrar todo dia", () => {
    const jaAvisou = cobranca({ avisosAtraso: 1, avisoAtrasoEm: new Date(Date.UTC(2026, 8, 11)) });
    expect(acaoDaRegua(jaAvisou, meioDia(2026, 9, 14)).tipo).toBe("NADA");
    expect(acaoDaRegua(jaAvisou, meioDia(2026, 9, 17))).toEqual({
      tipo: "AVISAR_ATRASO",
      diasDeAtraso: 7,
    });
  });

  it("depois de três avisos a régua se cala — daqui em diante é conversa humana", () => {
    const esgotada = cobranca({
      avisosAtraso: 3,
      avisoAtrasoEm: new Date(Date.UTC(2026, 8, 25)),
      status: "VENCIDA",
    });
    expect(acaoDaRegua(esgotada, meioDia(2026, 10, 30)).tipo).toBe("NADA");
  });

  it("cobrança paga nunca é cobrada, nem confirmada nem recebida", () => {
    for (const status of ["CONFIRMADA", "RECEBIDA"] as const) {
      const r = acaoDaRegua(cobranca({ status }), meioDia(2026, 9, 30));
      expect(r).toEqual({ tipo: "NADA", motivo: "já foi paga" });
    }
  });

  it("cobrança cancelada ou estornada sai da régua", () => {
    for (const status of ["CANCELADA", "ESTORNADA"] as const) {
      expect(acaoDaRegua(cobranca({ status }), meioDia(2026, 9, 30)).tipo).toBe("NADA");
    }
  });

  it("vencida continua sendo cobrada — o status muda, a dívida não", () => {
    const r = acaoDaRegua(cobranca({ status: "VENCIDA" }), meioDia(2026, 9, 11));
    expect(r.tipo).toBe("AVISAR_ATRASO");
  });
});

describe("tradução do gateway", () => {
  it("confirmado e recebido são coisas diferentes, e as duas são pagas", () => {
    expect(statusDoGateway("CONFIRMED")).toBe("CONFIRMADA");
    expect(statusDoGateway("RECEIVED")).toBe("RECEBIDA");
  });

  it("status desconhecido devolve null em vez de virar pendente", () => {
    // Chutar PENDENTE faria uma cobrança paga voltar pra régua.
    expect(statusDoGateway("ALGO_QUE_O_ASAAS_INVENTOU")).toBeNull();
  });

  it("estorno e chargeback caem no mesmo lugar", () => {
    expect(statusDoGateway("REFUNDED")).toBe("ESTORNADA");
    expect(statusDoGateway("CHARGEBACK_REQUESTED")).toBe("ESTORNADA");
  });

  it("débito conta como cartão", () => {
    expect(formaDoGateway("DEBIT_CARD")).toBe("CARTAO");
    expect(formaDoGateway("PIX")).toBe("PIX");
    expect(formaDoGateway("SEI_LA")).toBeNull();
  });
});

describe("o link que vai no botão do template", () => {
  it("manda só o sufixo, porque a Meta não aceita URL inteira em parâmetro", () => {
    expect(sufixoDoLink("https://www.asaas.com/i/abc123")).toBe("abc123");
  });

  it("um link sem barra volta inteiro, em vez de virar um botão pro lugar errado", () => {
    expect(sufixoDoLink("abc123")).toBe("abc123");
  });
});

describe("formatação pro texto que a pessoa lê", () => {
  it("a competência vira o nome do mês", () => {
    expect(rotuloCompetencia(new Date(Date.UTC(2026, 8, 1)))).toBe("setembro/2026");
  });

  it("a data sai em dd/mm/aaaa a partir de uma coluna Date", () => {
    expect(formatarData(new Date(Date.UTC(2026, 8, 10)))).toBe("10/09/2026");
  });

  it("centavos viram reais", () => {
    //   é o espaço não-separável que o Intl usa depois do R$.
    expect(formatarReais(189000).replace(/ /g, " ")).toBe("R$ 1.890,00");
  });
});
