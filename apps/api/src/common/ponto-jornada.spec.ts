import { describe, expect, it } from "vitest";
import {
  apurarPeriodo,
  aplicarTolerancia,
  diaBR,
  parearPeriodo,
  violacoesDeJornada,
  type JornadaDiaPura,
  type MarcacaoApurada,
} from "./ponto-jornada";

/**
 * A conta que vai pra folha de gente registrada. Cada teste aqui é um jeito
 * de a empresa pagar errado — ou de descobrir o erro anos depois, numa
 * liquidação de sentença.
 */

let n = 0;
const m = (iso: string, desconsiderada = false): MarcacaoApurada => ({
  numero: ++n,
  marcadoEm: new Date(iso),
  desconsiderada,
});

const jornada = (over: Partial<JornadaDiaPura> = {}): JornadaDiaPura => ({
  trabalha: true,
  entrada: "07:00",
  saida: "17:00",
  intervaloMin: 60,
  cargaMin: 540,
  nomeModelo: "Motorista 9h",
  tolerancia: { porMarcacaoMin: 5, diariaMin: 10 },
  intervaloMinimoMin: 60,
  preAssinalacaoMinutos: null,
  ...over,
});

describe("pareamento", () => {
  it("pareia entrada e saída na ordem do relógio", () => {
    const p = parearPeriodo([m("2026-09-20T10:00:00Z"), m("2026-09-20T18:00:00Z")]);
    expect(p).toHaveLength(1);
    expect(p[0]!.minutos).toBe(480);
    expect(p[0]!.emAberto).toBe(false);
  });

  it("marcação sozinha fica EM ABERTO — nunca inventa a saída", () => {
    const p = parearPeriodo([m("2026-09-20T10:00:00Z")]);
    expect(p[0]!.emAberto).toBe(true);
    expect(p[0]!.minutos).toBe(0);
  });

  it("ATRAVESSA A MEIA-NOITE: 21h→05h é UMA jornada, no dia de abertura", () => {
    // É o turno normal de quem roda estrada e de plantão de oficina. Parear
    // dentro do dia daria dois meios-pares e 0h trabalhadas, todo dia.
    const p = parearPeriodo([
      m("2026-09-21T00:00:00Z"), // 20/09 21:00 BR
      m("2026-09-21T08:00:00Z"), // 21/09 05:00 BR
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]!.minutos).toBe(480);
    expect(p[0]!.dia).toBe("2026-09-20");
  });

  it("esquecer a saída NÃO cola com a entrada do dia seguinte", () => {
    // Sem o teto de duração isto vira 24h trabalhadas — plausível, absurdo, e
    // ninguém confere hora por hora.
    const p = parearPeriodo([
      m("2026-09-20T10:00:00Z"),
      m("2026-09-21T10:00:00Z"),
      m("2026-09-21T20:00:00Z"),
    ]);
    expect(p).toHaveLength(2);
    expect(p[0]!.emAberto).toBe(true);
    expect(p[1]!.minutos).toBe(600);
  });

  it("marcação desconsiderada sai do pareamento, mas o registro segue existindo", () => {
    const p = parearPeriodo([
      m("2026-09-20T10:00:00Z"),
      m("2026-09-20T12:00:00Z", true),
      m("2026-09-20T18:00:00Z"),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]!.minutos).toBe(480);
  });

  it("pareia fora de ordem sem reclamar — o outbox não garante ordem", () => {
    const p = parearPeriodo([m("2026-09-20T18:00:00Z"), m("2026-09-20T10:00:00Z")]);
    expect(p[0]!.minutos).toBe(480);
  });
});

describe("tolerância (Súmula 366)", () => {
  it("dentro da tolerância, vale o previsto — nem a mais nem a menos", () => {
    expect(aplicarTolerancia(540, 546, { porMarcacaoMin: 5, diariaMin: 10 })).toEqual({
      minutosConsiderados: 540,
      estourou: false,
    });
  });

  it("estourou: conta a jornada INTEIRA, não só o excedente", () => {
    // O erro clássico: descontar só os 5 minutos que passaram de 10. A súmula
    // diz o contrário, e a diferença aparece com juros anos depois.
    expect(aplicarTolerancia(540, 555, { porMarcacaoMin: 5, diariaMin: 10 })).toEqual({
      minutosConsiderados: 555,
      estourou: true,
    });
  });

  it("vale pros dois lados: saiu 15min mais cedo também estoura", () => {
    expect(aplicarTolerancia(540, 525, { porMarcacaoMin: 5, diariaMin: 10 }).minutosConsiderados).toBe(
      525,
    );
  });
});

describe("apuração do dia", () => {
  const base = {
    feriados: new Set<string>(),
    jornadaPorDia: new Map([["2026-09-21", jornada()]]),
  };

  it("dia previsto sem marcação nenhuma é SEM_REGISTRO, e aparece no espelho", () => {
    const [d] = apurarPeriodo({ ...base, dias: ["2026-09-21"], marcacoes: [] });
    expect(d!.alertas.map((a) => a.codigo)).toContain("SEM_REGISTRO");
    expect(d!.saldoMin).toBe(-540);
  });

  it("número ímpar de marcações vira CONFERIR, com os números na mão", () => {
    const [d] = apurarPeriodo({
      ...base,
      dias: ["2026-09-21"],
      marcacoes: [m("2026-09-21T10:00:00Z")],
    });
    const a = d!.alertas.find((x) => x.codigo === "CONFERIR");
    expect(a).toBeTruthy();
  });

  it("marcar em dia sem previsão é informação, não erro", () => {
    const [d] = apurarPeriodo({
      feriados: new Set(),
      jornadaPorDia: new Map([["2026-09-20", jornada({ trabalha: false, cargaMin: 0 })]]),
      dias: ["2026-09-20"],
      marcacoes: [m("2026-09-20T13:00:00Z"), m("2026-09-20T17:00:00Z")],
    });
    expect(d!.alertas.map((x) => x.codigo)).toContain("FORA_DA_JORNADA");
    expect(d!.minutosTrabalhados).toBe(240);
  });

  it("feriado zera o previsto — senão o mês inteiro sai com saldo negativo", () => {
    const [d] = apurarPeriodo({
      jornadaPorDia: new Map([["2026-09-07", jornada()]]),
      feriados: new Set(["2026-09-07"]),
      dias: ["2026-09-07"],
      marcacoes: [],
    });
    expect(d!.minutosPrevistos).toBe(0);
    expect(d!.saldoMin).toBe(0);
    expect(d!.alertas.map((x) => x.codigo)).not.toContain("SEM_REGISTRO");
  });

  it("intervalo mais curto que o mínimo vira alerta", () => {
    const [d] = apurarPeriodo({
      ...base,
      dias: ["2026-09-21"],
      marcacoes: [
        m("2026-09-21T10:00:00Z"),
        m("2026-09-21T14:00:00Z"),
        m("2026-09-21T14:30:00Z"),
        m("2026-09-21T19:00:00Z"),
      ],
    });
    expect(d!.alertas.map((x) => x.codigo)).toContain("SEM_INTERVALO");
  });

  it("pré-assinalação desconta o intervalo, e só quando está ligada", () => {
    const comPre = new Map([["2026-09-21", jornada({ preAssinalacaoMinutos: 60 })]]);
    const [d] = apurarPeriodo({
      feriados: new Set(),
      jornadaPorDia: comPre,
      dias: ["2026-09-21"],
      marcacoes: [m("2026-09-21T10:00:00Z"), m("2026-09-21T20:00:00Z")],
    });
    expect(d!.minutosTrabalhados).toBe(540);
  });

  it("relógio adulterado vira alerta; fila do outbox NÃO", () => {
    // O desvio vem medido no envio, não de `recebidoEm - marcadoEm`. Um alerta
    // que dispara em toda marcação de motorista é o mesmo que nenhum.
    const a = m("2026-09-21T10:00:00Z");
    const b = m("2026-09-21T19:00:00Z");
    const [d] = apurarPeriodo({
      ...base,
      dias: ["2026-09-21"],
      marcacoes: [a, b],
      desvioPorNumero: new Map([[a.numero, 4000]]),
    });
    expect(d!.alertas.map((x) => x.codigo)).toContain("RELOGIO_DIVERGENTE");
  });
});

describe("limites da Lei 13.103", () => {
  it("aponta direção contínua acima do limite — como ALERTA", () => {
    const dias = apurarPeriodo({
      feriados: new Set(),
      jornadaPorDia: new Map([["2026-09-21", jornada()]]),
      dias: ["2026-09-21"],
      marcacoes: [m("2026-09-21T09:00:00Z"), m("2026-09-21T18:00:00Z")],
    });
    const v = violacoesDeJornada(dias, { maxDirecaoContinuaMin: 330 });
    expect(v.map((x) => x.codigo)).toContain("DIRECAO_CONTINUA");
  });
});

describe("o dia é o de Brasília, não o do container", () => {
  it("23h50 de Brasília ainda é o mesmo dia", () => {
    expect(diaBR(new Date("2026-09-21T02:50:00Z"))).toBe("2026-09-20");
  });
});

/**
 * O mês que ainda está correndo.
 *
 * Sem isto o espelho do dia 5 mostrava 168h de saldo negativo: o período
 * inteiro contava como previsto, inclusive os dias que ainda não chegaram. É
 * a mesma lição do espelho de diárias — dia futuro não pode parecer dívida.
 */
describe("dia que ainda não aconteceu", () => {
  const jornadaPorDia = new Map([
    ["2026-09-21", jornada()],
    ["2026-09-22", jornada()],
  ]);

  it("não tem previsto, não gera alerta e não entra no saldo", () => {
    const dias = apurarPeriodo({
      dias: ["2026-09-21", "2026-09-22"],
      marcacoes: [],
      jornadaPorDia,
      feriados: new Set(),
      hoje: "2026-09-21",
    });
    const [ontem, amanha] = dias;
    expect(ontem!.futuro).toBe(false);
    expect(ontem!.saldoMin).toBe(-540);
    expect(ontem!.alertas.map((a) => a.codigo)).toContain("SEM_REGISTRO");

    expect(amanha!.futuro).toBe(true);
    expect(amanha!.minutosPrevistos).toBe(0);
    expect(amanha!.saldoMin).toBe(0);
    expect(amanha!.alertas).toEqual([]);
  });

  it("bater adiantado num dia futuro não vira 'trabalhou em folga'", () => {
    const [d] = apurarPeriodo({
      dias: ["2026-09-22"],
      marcacoes: [m("2026-09-22T11:00:00Z"), m("2026-09-22T20:00:00Z")],
      jornadaPorDia,
      feriados: new Set(),
      hoje: "2026-09-21",
    });
    expect(d!.alertas.map((a) => a.codigo)).not.toContain("FORA_DA_JORNADA");
  });

  it("sem `hoje`, nada é futuro — a apuração de um mês fechado não muda", () => {
    const [d] = apurarPeriodo({
      dias: ["2026-09-22"],
      marcacoes: [],
      jornadaPorDia,
      feriados: new Set(),
    });
    expect(d!.futuro).toBe(false);
    expect(d!.minutosPrevistos).toBe(540);
  });
});

/**
 * Horário incluído por correção não pode parecer batida do trabalhador.
 *
 * Num documento de jornada, a distinção entre "ele registrou" e "fizeram por
 * ele" é a informação mais importante da linha — some ela e o espelho vira
 * uma lista de horas sem dono.
 */
describe("o que veio de correção fica marcado", () => {
  it("carrega a marca até o par, lado a lado", () => {
    const entrada = { ...m("2026-09-21T10:00:00Z"), incluida: true };
    const saida = m("2026-09-21T19:00:00Z");
    const [p] = parearPeriodo([entrada, saida]);
    expect(p!.entradaIncluida).toBe(true);
    expect(p!.saidaIncluida).toBe(false);
  });

  it("batida normal não fica marcada", () => {
    const [p] = parearPeriodo([m("2026-09-21T10:00:00Z"), m("2026-09-21T19:00:00Z")]);
    expect(p!.entradaIncluida).toBe(false);
    expect(p!.saidaIncluida).toBe(false);
  });

  it("par em aberto também carrega a marca", () => {
    const [p] = parearPeriodo([{ ...m("2026-09-21T10:00:00Z"), incluida: true }]);
    expect(p!.emAberto).toBe(true);
    expect(p!.entradaIncluida).toBe(true);
  });
});
