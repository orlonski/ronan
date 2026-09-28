import { describe, expect, it } from "vitest";
import { descreverRegraConferencia } from "@ronan/shared-types";
import {
  avaliarConferenciaDiaria,
  diasEsperadosAntesDeHoje,
  hojeYmd,
  somarDias,
  type ConfigRegraConferencia,
  type MotoristaParaConferencia,
} from "./conferencia-diaria";

// 28/09/2026 é segunda-feira. 25/09 é sexta, 26 sábado, 27 domingo.
const SEG_MANHA = new Date("2026-09-28T13:00:00Z"); // 10:00 em São Paulo
const SEM_FERIADO = new Set<string>();

const cfg = (over: Partial<ConfigRegraConferencia> = {}): ConfigRegraConferencia => ({
  regra: "SEM_VIAGEM_NO_DIA_ANTERIOR",
  diasSemViagem: 2,
  diasConsiderados: [1, 2, 3, 4, 5],
  ignorarFeriados: true,
  incluirQueNuncaLancou: true,
  intervaloMinimoDias: 3,
  maxPerguntasPorSemana: 3,
  ...over,
});

const mot = (over: Partial<MotoristaParaConferencia> = {}): MotoristaParaConferencia => ({
  motoristaId: "m1",
  diasComViagem: ["2026-09-20"],
  temViagemEmAndamento: false,
  cadastradoEm: "2026-01-01",
  perguntasAnteriores: [],
  ...over,
});

describe("datas civis", () => {
  it("somarDias atravessa mês e ano sem fuso", () => {
    expect(somarDias("2026-10-01", -1)).toBe("2026-09-30");
    expect(somarDias("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("virada de dia: às 21h30 de Brasília ainda é o mesmo dia (UTC já virou)", () => {
    expect(hojeYmd(new Date("2026-09-29T00:30:00Z"))).toBe("2026-09-28");
    expect(hojeYmd(new Date("2026-09-29T02:59:00Z"))).toBe("2026-09-28");
    expect(hojeYmd(new Date("2026-09-29T03:00:00Z"))).toBe("2026-09-29");
  });
});

describe("diasEsperadosAntesDeHoje", () => {
  it("segunda olha a sexta (fim de semana fora dos dias considerados)", () => {
    expect(diasEsperadosAntesDeHoje("2026-09-28", 1, [1, 2, 3, 4, 5], null)).toEqual(["2026-09-25"]);
  });
  it("com todos os dias, segunda olha o domingo", () => {
    expect(diasEsperadosAntesDeHoje("2026-09-28", 1, [0, 1, 2, 3, 4, 5, 6], null)).toEqual(["2026-09-27"]);
  });
  it("feriado nacional pula o dia; sem ignorar, ele conta", () => {
    const feriados = new Set(["2026-09-07"]);
    expect(diasEsperadosAntesDeHoje("2026-09-08", 1, [1, 2, 3, 4, 5], feriados)).toEqual(["2026-09-04"]);
    expect(diasEsperadosAntesDeHoje("2026-09-08", 1, [1, 2, 3, 4, 5], null)).toEqual(["2026-09-07"]);
  });
  it("sem nenhum dia considerado devolve vazio (não trava)", () => {
    expect(diasEsperadosAntesDeHoje("2026-09-28", 3, [], null)).toEqual([]);
  });
});

describe("regra SEM_VIAGEM_NO_DIA_ANTERIOR", () => {
  it("pergunta quando não lançou no último dia esperado", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot(), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(true);
    expect(r.evidencias.diasEsperadosVerificados).toEqual(["2026-09-25"]);
    expect(r.evidencias.ultimoDiaComViagem).toBe("2026-09-20");
    expect(r.motivo).toContain("25/09/2026");
  });

  it("não pergunta quem lançou no dia esperado", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: ["2026-09-25"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(false);
  });

  it("viagem só no sábado não salva quem faltou na sexta se o sábado não é dia considerado", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: ["2026-09-26"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(true);
  });

  it("com todos os dias considerados, o domingo é o dia esperado", () => {
    const c = cfg({ diasConsiderados: [0, 1, 2, 3, 4, 5, 6] });
    const r = avaliarConferenciaDiaria(c, mot({ diasComViagem: ["2026-09-25"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.evidencias.diasEsperadosVerificados).toEqual(["2026-09-27"]);
    expect(r.deveriaPerguntar).toBe(true);
  });

  it("hoje nunca conta: viagem lançada hoje não cobre o dia anterior", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: ["2026-09-28"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(true);
    expect(r.evidencias.ultimoDiaComViagem).toBeNull();
  });

  it("feriado nacional: terça depois do feriado de segunda olha a sexta", () => {
    const terca = new Date("2026-09-08T13:00:00Z");
    const feriados = new Set(["2026-09-07"]);
    const r = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: ["2026-09-07"] }), feriados, terca);
    expect(r.evidencias.diasEsperadosVerificados).toEqual(["2026-09-04"]);
    expect(r.deveriaPerguntar).toBe(true);
    const r2 = avaliarConferenciaDiaria(cfg({ ignorarFeriados: false }), mot({ diasComViagem: ["2026-09-07"] }), feriados, terca);
    expect(r2.evidencias.diasEsperadosVerificados).toEqual(["2026-09-07"]);
    expect(r2.deveriaPerguntar).toBe(false);
  });

  it("virada de dia às 21h30 de Brasília: o dia continua sendo o de Brasília", () => {
    const noite = new Date("2026-09-29T00:30:00Z"); // segunda 21:30 em SP, já terça em UTC
    const r = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: ["2026-09-25"] }), SEM_FERIADO, noite);
    expect(r.evidencias.hoje).toBe("2026-09-28");
    expect(r.evidencias.diasEsperadosVerificados).toEqual(["2026-09-25"]);
    expect(r.deveriaPerguntar).toBe(false);
  });
});

describe("motorista que nunca lançou", () => {
  it("entra quando a empresa quer", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: [] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(true);
    expect(r.evidencias.nuncaLancou).toBe(true);
    expect(r.motivo).toContain("nunca lançou");
  });
  it("não entra quando a empresa não quer", () => {
    const r = avaliarConferenciaDiaria(cfg({ incluirQueNuncaLancou: false }), mot({ diasComViagem: [] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(false);
  });
  it("cadastro de ontem: dia anterior ao cadastro não é falta", () => {
    const r = avaliarConferenciaDiaria(
      cfg(),
      mot({ diasComViagem: [], cadastradoEm: "2026-09-27" }),
      SEM_FERIADO,
      SEG_MANHA,
    );
    expect(r.deveriaPerguntar).toBe(false);
  });
});

describe("regra SEM_VIAGEM_HA_N_DIAS", () => {
  const c = cfg({ regra: "SEM_VIAGEM_HA_N_DIAS", diasSemViagem: 2 });
  it("olha os N dias esperados (pula o fim de semana)", () => {
    const r = avaliarConferenciaDiaria(c, mot({ diasComViagem: [] }), SEM_FERIADO, SEG_MANHA);
    expect(r.evidencias.diasEsperadosVerificados).toEqual(["2026-09-25", "2026-09-24"]);
    expect(r.deveriaPerguntar).toBe(true);
  });
  it("uma viagem em qualquer dos N dias basta pra não perguntar", () => {
    const r = avaliarConferenciaDiaria(c, mot({ diasComViagem: ["2026-09-24"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(false);
  });
  it("viagem no dia anterior ao período N não conta", () => {
    const r = avaliarConferenciaDiaria(c, mot({ diasComViagem: ["2026-09-23"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(true);
  });
  it("N=1 equivale ao dia anterior", () => {
    const um = cfg({ regra: "SEM_VIAGEM_HA_N_DIAS", diasSemViagem: 1 });
    const r = avaliarConferenciaDiaria(um, mot(), SEM_FERIADO, SEG_MANHA);
    expect(r.evidencias.diasEsperadosVerificados).toEqual(["2026-09-25"]);
  });
});

describe("viagem incompleta ou em andamento conta como movimento", () => {
  it("viagem em andamento agora: não pergunta", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot({ temViagemEmAndamento: true }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(false);
    expect(r.motivo).toContain("andamento");
  });
  it("viagem de qualquer status no dia esperado (o chamador manda o dia dela) cobre o dia", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: ["2026-09-25", "2026-09-25"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(false);
  });
});

describe("frequência", () => {
  it("respeita o intervalo mínimo entre perguntas", () => {
    const r = avaliarConferenciaDiaria(cfg(), mot({ perguntasAnteriores: ["2026-09-26"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(false);
    expect(r.motivo).toContain("26/09/2026");
    const ok = avaliarConferenciaDiaria(cfg(), mot({ perguntasAnteriores: ["2026-09-25"] }), SEM_FERIADO, SEG_MANHA);
    expect(ok.deveriaPerguntar).toBe(true);
  });
  it("respeita o máximo por semana", () => {
    const c = cfg({ intervaloMinimoDias: 1, maxPerguntasPorSemana: 2 });
    const r = avaliarConferenciaDiaria(c, mot({ perguntasAnteriores: ["2026-09-23", "2026-09-25"] }), SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(false);
    expect(r.evidencias.perguntasNaSemana).toBe(2);
    const ok = avaliarConferenciaDiaria(c, mot({ perguntasAnteriores: ["2026-09-20", "2026-09-25"] }), SEM_FERIADO, SEG_MANHA);
    expect(ok.deveriaPerguntar).toBe(true);
  });
});

describe("descreverRegraConferencia", () => {
  const base = {
    horaEnvio: 8,
    diasDoJob: [1, 2, 3, 4, 5],
    regra: "SEM_VIAGEM_NO_DIA_ANTERIOR" as const,
    diasSemViagem: 2,
    diasConsiderados: [1, 2, 3, 4, 5],
    ignorarFeriados: true,
    incluirQueNuncaLancou: true,
    intervaloMinimoDias: 3,
    maxPerguntasPorSemana: 3,
  };
  it("descreve a regra padrão em português", () => {
    const t = descreverRegraConferencia(base);
    expect(t).toContain("De segunda a sexta, às 08:00");
    expect(t).toContain("não lançou viagem no último dia útil");
    expect(t).toContain("exceto feriado nacional");
    expect(t).toContain("No máximo 1 mensagem a cada 3 dias");
  });
  it("descreve a regra de N dias e dias personalizados", () => {
    const t = descreverRegraConferencia({
      ...base,
      regra: "SEM_VIAGEM_HA_N_DIAS",
      diasDoJob: [1, 3],
      diasConsiderados: [0, 1, 2, 3, 4, 5, 6],
      ignorarFeriados: false,
      incluirQueNuncaLancou: false,
    });
    expect(t).toContain("Toda segunda e quarta");
    expect(t).toContain("2 dias esperados seguidos");
    expect(t).toContain("não entra");
    expect(t).not.toContain("feriado");
  });
});
