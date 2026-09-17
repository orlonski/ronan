import { describe, expect, it } from "vitest";
import {
  acaoDoFollowup,
  dentroDaJanelaDeEnvio,
  estadoVisivel,
  horaEmSaoPaulo,
  type EstadoConversa,
  type PrazosFollowup,
} from "./followup.regua";

const PRAZOS: PrazosFollowup = {
  followupHoras: 4,
  followupMax: 2,
  followupIntervaloHoras: 18,
  encerrarAposHoras: 48,
  horaInicio: 9,
  horaFim: 19,
};

/** 17/09/2026, 14h em São Paulo (17h UTC) — dia útil, dentro do horário. */
const AGORA = new Date("2026-09-17T17:00:00Z");
const hAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

function conversa(over: Partial<EstadoConversa> = {}): EstadoConversa {
  return {
    // Ele escreveu, nós respondemos, e desde então silêncio.
    ultimaDirecao: "SAIDA",
    ultimaMensagemEm: hAtras(5),
    ultimaEntradaEm: hAtras(5),
    followupsEnviados: 0,
    ultimoFollowupEm: null,
    conversaEncerradaEm: null,
    sdrPausadoEm: null,
    optOut: false,
    status: "EM_CONTATO",
    ...over,
  };
}

describe("quem NUNCA recebe follow-up", () => {
  it("quem pediu pra não ser contatado", () => {
    expect(acaoDoFollowup(conversa({ optOut: true }), PRAZOS, AGORA)).toEqual({
      tipo: "NADA",
      motivo: "opt-out",
    });
  });

  it.each(["GANHOU", "PERDEU", "QUALIFICADO", "PROPOSTA"])(
    "lead em %s — virou cliente ou já tem vendedor cuidando",
    (status) => {
      expect(acaoDoFollowup(conversa({ status }), PRAZOS, AGORA).tipo).toBe("NADA");
    },
  );

  it("conversa que um humano assumiu", () => {
    expect(acaoDoFollowup(conversa({ sdrPausadoEm: hAtras(1) }), PRAZOS, AGORA)).toEqual({
      tipo: "NADA",
      motivo: "humano-assumiu",
    });
  });

  it("conversa já encerrada não encerra de novo", () => {
    expect(acaoDoFollowup(conversa({ conversaEncerradaEm: hAtras(2) }), PRAZOS, AGORA)).toEqual({
      tipo: "NADA",
      motivo: "ja-encerrada",
    });
  });
});

describe("a regra que vale mais que todas", () => {
  it("se o último a falar foi ELE, não se escreve — está esperando resposta nossa", () => {
    const c = conversa({ ultimaDirecao: "ENTRADA", ultimaMensagemEm: hAtras(10) });
    expect(acaoDoFollowup(c, PRAZOS, AGORA)).toEqual({
      tipo: "NADA",
      motivo: "ele-falou-por-ultimo",
    });
  });

  it("vale mesmo com dias de silêncio: cobrar quem espera é o pior erro", () => {
    const c = conversa({
      ultimaDirecao: "ENTRADA",
      ultimaMensagemEm: hAtras(72),
      ultimaEntradaEm: hAtras(72),
    });
    expect(acaoDoFollowup(c, PRAZOS, AGORA).tipo).toBe("NADA");
  });
});

describe("o primeiro toque", () => {
  it("sai depois do prazo, dentro do horário", () => {
    expect(acaoDoFollowup(conversa(), PRAZOS, AGORA)).toEqual({ tipo: "FOLLOWUP", passo: 1 });
  });

  it("não sai antes do prazo", () => {
    const c = conversa({ ultimaMensagemEm: hAtras(2), ultimaEntradaEm: hAtras(2) });
    expect(acaoDoFollowup(c, PRAZOS, AGORA)).toEqual({ tipo: "NADA", motivo: "ainda-cedo" });
  });

  it("respeita o intervalo entre o primeiro e o segundo", () => {
    const c = conversa({ followupsEnviados: 1, ultimoFollowupEm: hAtras(3) });
    expect(acaoDoFollowup(c, PRAZOS, AGORA)).toEqual({ tipo: "NADA", motivo: "ainda-cedo" });
  });
});

describe("a janela de 24h da Meta manda em tudo", () => {
  it("passou de 23h desde que ELE falou: não existe follow-up, encerra", () => {
    const c = conversa({ ultimaMensagemEm: hAtras(23), ultimaEntradaEm: hAtras(23) });
    expect(acaoDoFollowup(c, PRAZOS, AGORA)).toEqual({
      tipo: "ENCERRAR",
      motivo: "janela-da-meta-fechada",
    });
  });

  it("a margem de 1h evita a mensagem recusada em silêncio pela Meta", () => {
    const dentro = conversa({ ultimaMensagemEm: hAtras(22.5), ultimaEntradaEm: hAtras(22.5) });
    expect(acaoDoFollowup(dentro, PRAZOS, AGORA).tipo).toBe("FOLLOWUP");
    const fora = conversa({ ultimaMensagemEm: hAtras(23.5), ultimaEntradaEm: hAtras(23.5) });
    expect(acaoDoFollowup(fora, PRAZOS, AGORA).tipo).toBe("ENCERRAR");
  });

  it("encerrar por janela fechada vale a qualquer hora — não manda mensagem", () => {
    const madrugada = new Date("2026-09-17T06:00:00Z"); // 3h em São Paulo
    const c = conversa({
      ultimaMensagemEm: new Date(madrugada.getTime() - 30 * 3_600_000),
      ultimaEntradaEm: new Date(madrugada.getTime() - 30 * 3_600_000),
    });
    expect(acaoDoFollowup(c, PRAZOS, madrugada).tipo).toBe("ENCERRAR");
  });
});

describe("teto de toques e encerramento", () => {
  it("com os toques esgotados, espera o prazo total pra encerrar", () => {
    const c = conversa({
      followupsEnviados: 2,
      ultimoFollowupEm: hAtras(20),
      ultimaMensagemEm: hAtras(20),
      ultimaEntradaEm: hAtras(21),
    });
    expect(acaoDoFollowup(c, PRAZOS, AGORA)).toEqual({ tipo: "NADA", motivo: "toques-esgotados" });
  });

  it("nunca existe um terceiro toque", () => {
    const c = conversa({
      followupsEnviados: 2,
      ultimoFollowupEm: hAtras(50),
      ultimaMensagemEm: hAtras(50),
      ultimaEntradaEm: hAtras(51),
    });
    expect(acaoDoFollowup(c, PRAZOS, AGORA).tipo).toBe("ENCERRAR");
  });
});

describe("horário de gente", () => {
  it("não cobra de madrugada", () => {
    const madrugada = new Date("2026-09-17T06:00:00Z"); // 3h em São Paulo
    const c = conversa({
      ultimaMensagemEm: new Date(madrugada.getTime() - 5 * 3_600_000),
      ultimaEntradaEm: new Date(madrugada.getTime() - 5 * 3_600_000),
    });
    expect(acaoDoFollowup(c, PRAZOS, madrugada)).toEqual({
      tipo: "NADA",
      motivo: "fora-do-horario",
    });
  });

  it("não cobra no domingo", () => {
    const domingo = new Date("2026-09-20T17:00:00Z"); // domingo, 14h em SP
    expect(dentroDaJanelaDeEnvio(domingo, PRAZOS)).toBe(false);
  });

  it("sábado passa — caminhão roda no sábado", () => {
    const sabado = new Date("2026-09-19T17:00:00Z");
    expect(dentroDaJanelaDeEnvio(sabado, PRAZOS)).toBe(true);
  });

  it("a hora é a de São Paulo, não a do container em UTC", () => {
    // 17h UTC é 14h em São Paulo: dentro do horário. Se lesse UTC, daria 17h.
    expect(horaEmSaoPaulo(AGORA)).toBe(14);
  });
});

describe("como a tela chama cada estado", () => {
  it("ele falou e ninguém respondeu: aguardando NÓS", () => {
    const c = conversa({ ultimaDirecao: "ENTRADA", ultimaMensagemEm: hAtras(3) });
    expect(estadoVisivel(c, PRAZOS, AGORA)).toBe("aguardando-nos");
  });

  it("acabou de escrever ainda é conversa ativa", () => {
    const c = conversa({ ultimaDirecao: "ENTRADA", ultimaMensagemEm: hAtras(0.1) });
    expect(estadoVisivel(c, PRAZOS, AGORA)).toBe("ativa");
  });

  it("nós falamos por último e ele sumiu: parada", () => {
    expect(estadoVisivel(conversa(), PRAZOS, AGORA)).toBe("parada");
  });

  it("encerrada e com humano têm nome próprio", () => {
    expect(estadoVisivel(conversa({ conversaEncerradaEm: hAtras(1) }), PRAZOS, AGORA)).toBe(
      "encerrada",
    );
    expect(estadoVisivel(conversa({ sdrPausadoEm: hAtras(1) }), PRAZOS, AGORA)).toBe("com-humano");
  });
});
