import { describe, expect, it } from "vitest";
import {
  competenciaPonto,
  diasDoPeriodo,
  feriadoAlcanca,
  feriadosNacionais,
  formatarMinutos,
  jornadaDoDia,
  montarEspelhoPonto,
  type VinculoPuro,
} from "./ponto-espelho";
import type { ApuracaoDia } from "./ponto-jornada";

const semanal = (over: Partial<VinculoPuro> = {}): VinculoPuro => ({
  vigenteDe: "2026-01-01",
  vigenteAte: null,
  modeloNome: "Comercial 5x2",
  tipo: "SEMANAL",
  cicloDias: null,
  ancoraCiclo: null,
  tolerancia: { porMarcacaoMin: 5, diariaMin: 10 },
  intervaloMinimoMin: 60,
  preAssinalacaoMinutos: null,
  dias: [0, 1, 2, 3, 4, 5, 6].map((p) => ({
    posicao: p,
    trabalha: p >= 1 && p <= 5,
    entrada: p >= 1 && p <= 5 ? "08:00" : null,
    saida: p >= 1 && p <= 5 ? "17:00" : null,
    intervaloMin: 60,
    cargaMin: p >= 1 && p <= 5 ? 480 : 0,
  })),
  ...over,
});

describe("competência", () => {
  it("fechamento 30 começa no dia SEGUINTE ao corte anterior, não no dia 1º", () => {
    // Agosto fechou em 30/08, então setembro começa em 31/08. Quem lê "corte
    // 30" e espera "do dia 1 ao 30" perde um dia de jornada todo mês.
    expect(competenciaPonto("2026-09", 30)).toEqual({
      rotulo: "2026-09",
      de: "2026-08-31",
      ate: "2026-09-30",
    });
  });

  it("fechamento 31 é o mês civil inteiro", () => {
    expect(competenciaPonto("2026-09", 31)).toEqual({
      rotulo: "2026-09",
      de: "2026-09-01",
      ate: "2026-09-30",
    });
  });

  it("fechamento 20 atravessa dois meses", () => {
    expect(competenciaPonto("2026-09", 20)).toEqual({
      rotulo: "2026-09",
      de: "2026-08-21",
      ate: "2026-09-20",
    });
  });

  it("fechamento 31 em mês de 30 dias NÃO reconta dia do mês anterior", () => {
    // Setembro fecha em 30/09 (não tem 31), mas agosto fechou em 31/08 —
    // setembro começa em 01/09. Derivar o início do fim recontaria o dia 31,
    // que já foi apurado e pago.
    expect(competenciaPonto("2026-09", 31).de).toBe("2026-09-01");
    expect(competenciaPonto("2026-08", 31).ate).toBe("2026-08-31");
  });

  it("competências vizinhas são contíguas, sem buraco e sem sobreposição", () => {
    for (const corte of [5, 20, 28, 30, 31]) {
      const a = competenciaPonto("2026-09", corte);
      const b = competenciaPonto("2026-10", corte);
      const seguinte = new Date(Date.parse(`${a.ate}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(b.de, `corte ${corte}`).toBe(seguinte);
    }
  });

  it("janeiro puxa a competência de dezembro do ano anterior", () => {
    expect(competenciaPonto("2026-01", 20).de).toBe("2025-12-21");
  });
});

describe("qual jornada valia no dia", () => {
  it("resolve pelo dia da semana no modelo semanal", () => {
    expect(jornadaDoDia("2026-09-21", [semanal()])?.cargaMin).toBe(480); // segunda
    expect(jornadaDoDia("2026-09-20", [semanal()])?.cargaMin).toBe(0); // domingo
  });

  it("sem vínculo devolve null — que NÃO é folga, é 'ninguém definiu'", () => {
    expect(jornadaDoDia("2026-09-21", [])).toBeNull();
  });

  it("vínculo versionado: o mês passado não muda quando a jornada muda hoje", () => {
    const antigo = semanal({ vigenteAte: "2026-08-31", modeloNome: "Antigo" });
    const novo = semanal({ vigenteDe: "2026-09-01", modeloNome: "Novo" });
    expect(jornadaDoDia("2026-08-10", [antigo, novo])?.nomeModelo).toBe("Antigo");
    expect(jornadaDoDia("2026-09-10", [antigo, novo])?.nomeModelo).toBe("Novo");
  });

  it("ciclo 12x36 alterna a partir da âncora", () => {
    const ciclo = semanal({
      tipo: "CICLO",
      cicloDias: 2,
      ancoraCiclo: "2026-09-01",
      dias: [
        { posicao: 0, trabalha: true, entrada: "07:00", saida: "19:00", intervaloMin: 60, cargaMin: 660 },
        { posicao: 1, trabalha: false, entrada: null, saida: null, intervaloMin: 0, cargaMin: 0 },
      ],
    });
    expect(jornadaDoDia("2026-09-01", [ciclo])?.trabalha).toBe(true);
    expect(jornadaDoDia("2026-09-02", [ciclo])?.trabalha).toBe(false);
    expect(jornadaDoDia("2026-09-03", [ciclo])?.trabalha).toBe(true);
  });

  it("dia ANTERIOR à âncora não estoura em posição negativa", () => {
    const ciclo = semanal({
      tipo: "CICLO",
      cicloDias: 2,
      ancoraCiclo: "2026-09-10",
      dias: [
        { posicao: 0, trabalha: true, entrada: "07:00", saida: "19:00", intervaloMin: 60, cargaMin: 660 },
        { posicao: 1, trabalha: false, entrada: null, saida: null, intervaloMin: 0, cargaMin: 0 },
      ],
    });
    expect(jornadaDoDia("2026-09-09", [ciclo])).not.toBeNull();
  });
});

describe("feriados", () => {
  it("nacional alcança todo mundo; estadual só quem é do estado", () => {
    const nac = { data: "2026-09-07", abrangencia: "NACIONAL" as const, uf: null, municipioIbge: null };
    const pr = { data: "2026-12-19", abrangencia: "ESTADUAL" as const, uf: "PR", municipioIbge: null };
    expect(feriadoAlcanca(nac, "SP")).toBe(true);
    expect(feriadoAlcanca(pr, "PR")).toBe(true);
    expect(feriadoAlcanca(pr, "SP")).toBe(false);
    expect(feriadoAlcanca(pr, null)).toBe(false);
  });

  it("calcula os móveis certo — Páscoa 2026 é 05/04", () => {
    const f = feriadosNacionais(2026);
    const nomes = new Map(f.map((x) => [x.data, x.nome]));
    expect(nomes.get("2026-04-03")).toBe("Sexta-feira Santa");
    expect(nomes.get("2026-02-16")).toBe("Carnaval");
    expect(nomes.get("2026-06-04")).toBe("Corpus Christi");
  });

  it("e em 2027, que tem Páscoa em 28/03", () => {
    const nomes = new Map(feriadosNacionais(2027).map((x) => [x.data, x.nome]));
    expect(nomes.get("2027-03-26")).toBe("Sexta-feira Santa");
    expect(nomes.get("2027-05-27")).toBe("Corpus Christi");
  });

  it("traz os fixos que mais aparecem em espelho", () => {
    const datas = feriadosNacionais(2026).map((f) => f.data);
    expect(datas).toContain("2026-09-07");
    expect(datas).toContain("2026-12-25");
    expect(datas).toContain("2026-05-01");
  });
});

describe("o espelho", () => {
  const dia = (d: string, over: Partial<ApuracaoDia> = {}): ApuracaoDia => ({
    dia: d,
    futuro: false,
    pares: [],
    minutosTrabalhados: 480,
    minutosConsiderados: 480,
    minutosPrevistos: 480,
    saldoMin: 0,
    nomeModelo: "Comercial",
    alertas: [],
    ...over,
  });

  it("recorta pelo contrato: nada antes da admissão", () => {
    const e = montarEspelhoPonto({
      funcionarioId: "f1",
      nome: "João",
      competencia: competenciaPonto("2026-09", 30),
      admitidoEm: "2026-09-15",
      dias: [dia("2026-09-10"), dia("2026-09-16")],
    });
    expect(e.dias.map((d) => d.dia)).toEqual(["2026-09-16"]);
  });

  it("mas o dia em branco DENTRO do contrato fica — é o que ele confere", () => {
    const e = montarEspelhoPonto({
      funcionarioId: "f1",
      nome: "João",
      competencia: competenciaPonto("2026-09", 30),
      admitidoEm: "2026-09-01",
      dias: [dia("2026-09-16", { alertas: [{ codigo: "SEM_REGISTRO" }], minutosTrabalhados: 0, minutosConsiderados: 0, saldoMin: -480 })],
    });
    expect(e.dias).toHaveLength(1);
    expect(e.diasParaConferir).toBe(1);
    expect(e.saldoMin).toBe(-480);
  });

  it("soma os totais do período", () => {
    const e = montarEspelhoPonto({
      funcionarioId: "f1",
      nome: "João",
      competencia: competenciaPonto("2026-09", 30),
      admitidoEm: "2026-01-01",
      dias: [dia("2026-09-01"), dia("2026-09-02", { minutosConsiderados: 540, saldoMin: 60 })],
    });
    expect(e.totalPrevistoMin).toBe(960);
    expect(e.saldoMin).toBe(60);
  });
});

describe("o período", () => {
  it("devolve todos os dias, inclusive virada de mês", () => {
    const d = diasDoPeriodo("2026-08-30", "2026-09-02");
    expect(d).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  });
});

describe("leitura humana", () => {
  it("formata saldo com sinal", () => {
    expect(formatarMinutos(-80)).toBe("-1h20");
    expect(formatarMinutos(485)).toBe("+8h05");
    expect(formatarMinutos(0)).toBe("0h00");
  });
});
