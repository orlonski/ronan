import { describe, expect, it } from "vitest";
import {
  AtualizarConfigConferenciaDiariaSchema,
  JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS,
  JANELA_ATIVIDADE_VALIDACAO_MIN_DIAS,
  descreverRegraConferencia,
  lembreteLancamentoVisivel,
  textoLembreteLancamento,
} from "@ronan/shared-types";
import {
  avaliarConferenciaDiaria,
  avaliarLembreteNoApp,
  numeroConfirmado,
  sinaisDoNumero,
  SINAIS_NUMERO_CONFIRMADO,
  type ConfigLembreteApp,
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


describe("avaliarLembreteNoApp (lembrete dentro do app)", () => {
  const app = (over: Partial<ConfigLembreteApp> = {}): ConfigLembreteApp => ({
    ativo: true,
    lembreteNoApp: true,
    lembreteParaQuem: "SO_QUEM_SAIU",
    diasParaLembreteNoApp: 3,
    ...over,
  });
  // Segunda 28/09: os dias esperados antes são sex 25, qui 24, qua 23, ter 22...
  const parou = (over: Partial<MotoristaParaConferencia> = {}) => ({
    ...mot({ diasComViagem: ["2026-09-18"], ...over }),
    receberConferenciaDiaria: false,
  });
  const rodar = (
    a: ConfigLembreteApp,
    m: ReturnType<typeof parou>,
    over: Partial<ConfigRegraConferencia> = {},
    feriados = SEM_FERIADO,
    agora = SEG_MANHA,
  ) => avaliarLembreteNoApp(cfg(over), a, m, feriados, agora);

  it("empresa desligada: nada", () => {
    expect(rodar(app({ lembreteNoApp: false }), parou())).toBeNull();
  });

  it("conferência inativa: nada, mesmo com o lembrete ligado", () => {
    expect(rodar(app({ ativo: false }), parou())).toBeNull();
  });

  it("SO_QUEM_SAIU: quem ainda recebe as perguntas NÃO vê; quem parou vê", () => {
    expect(rodar(app(), { ...parou(), receberConferenciaDiaria: true })).toBeNull();
    const r = rodar(app(), parou());
    expect(r).not.toBeNull();
    expect(r!.dias).toBeGreaterThanOrEqual(3);
  });

  it("TODOS_QUE_ATRASARAM: quem ainda recebe também vê", () => {
    const r = rodar(app({ lembreteParaQuem: "TODOS_QUE_ATRASARAM" }), { ...parou(), receberConferenciaDiaria: true });
    expect(r).not.toBeNull();
  });

  it("só aparece com N dias esperados sem viagem: 2 dias não bastam pra N=3, 3 bastam", () => {
    // Lançou na quarta 23: sem viagem em qui 24 e sex 25 = 2 dias esperados.
    expect(rodar(app(), parou({ diasComViagem: ["2026-09-23"] }))).toBeNull();
    // Lançou na terça 22: qua, qui, sex = 3.
    const r = rodar(app(), parou({ diasComViagem: ["2026-09-22"] }));
    expect(r).toEqual({ dias: 3, desde: "2026-09-23", calculadoEm: "2026-09-28" });
  });

  it("N configurável e a regra da conferência (dia anterior) não interfere", () => {
    const r = rodar(app({ diasParaLembreteNoApp: 1 }), parou({ diasComViagem: ["2026-09-24"] }), {
      regra: "SEM_VIAGEM_NO_DIA_ANTERIOR",
    });
    expect(r).toEqual({ dias: 1, desde: "2026-09-25", calculadoEm: "2026-09-28" });
  });

  it("frequência do WhatsApp (intervalo/máximo por semana) não segura o card", () => {
    const r = rodar(app(), parou(), { intervaloMinimoDias: 30, maxPerguntasPorSemana: 1 });
    expect(r).not.toBeNull();
  });

  it("feriado nacional não conta como dia esperado (mesma config da regra)", () => {
    // Sem o feriado de sex 25, a sequência desde ter 22 teria 3 dias; com ele, só 2.
    const feriados = new Set(["2026-09-25"]);
    expect(rodar(app(), parou({ diasComViagem: ["2026-09-22"] }), {}, feriados)).toBeNull();
    // Se a empresa não ignora feriado, ele conta.
    expect(rodar(app(), parou({ diasComViagem: ["2026-09-22"] }), { ignorarFeriados: false }, feriados)).not.toBeNull();
  });

  it("fim de semana não conta (só os dias considerados)", () => {
    // Lançou na sexta 25; segunda 28 olha sex... zero dias sem viagem.
    expect(rodar(app(), parou({ diasComViagem: ["2026-09-25"] }))).toBeNull();
  });

  it("virada de dia às 21h30 de Brasília: ainda é segunda (UTC já é terça)", () => {
    const noite = new Date("2026-09-29T00:30:00Z"); // segunda 21:30 em SP
    const r = rodar(app(), parou({ diasComViagem: ["2026-09-22"] }), {}, SEM_FERIADO, noite);
    expect(r?.calculadoEm).toBe("2026-09-28");
    // À 00:30 de terça em SP (03:30Z) o "hoje" muda e segunda passa a contar como dia esperado.
    const madruga = new Date("2026-09-29T03:30:00Z");
    const r2 = rodar(app(), parou({ diasComViagem: ["2026-09-22"] }), {}, SEM_FERIADO, madruga);
    expect(r2).toEqual({ dias: 4, desde: "2026-09-23", calculadoEm: "2026-09-29" });
  });

  it("lançou hoje: o lembrete some na hora", () => {
    expect(rodar(app(), parou({ diasComViagem: ["2026-09-18", "2026-09-28"] }))).toBeNull();
  });

  it("viagem em andamento e cadastro recente não geram lembrete", () => {
    expect(rodar(app(), parou({ temViagemEmAndamento: true }))).toBeNull();
    expect(rodar(app(), parou({ cadastradoEm: "2026-09-26" }))).toBeNull();
  });

  it("quem nunca lançou: segue a config da conferência (incluirQueNuncaLancou)", () => {
    expect(rodar(app(), parou({ diasComViagem: [] }))).not.toBeNull();
    expect(rodar(app(), parou({ diasComViagem: [] }), { incluirQueNuncaLancou: false })).toBeNull();
  });

  it("a contagem mostrada é a sequência real, com teto de 30", () => {
    const r = rodar(app(), parou({ diasComViagem: ["2026-06-01"], cadastradoEm: "2026-01-01" }));
    expect(r!.dias).toBe(30);
  });
});

describe("lembreteLancamentoVisivel (decisão do card no aparelho)", () => {
  const lembrete = { dias: 3, desde: "2026-09-23", calculadoEm: "2026-09-28" };
  const base = { lembrete, hoje: "2026-09-28", dispensadoEm: null as string | null, datasDeViagens: [] as string[] };

  it("sem lembrete (servidor antigo, cache antigo, empresa desligada): não mostra", () => {
    expect(lembreteLancamentoVisivel({ ...base, lembrete: undefined })).toBe(false);
    expect(lembreteLancamentoVisivel({ ...base, lembrete: null })).toBe(false);
    expect(lembreteLancamentoVisivel({ ...base, lembrete: {} as never })).toBe(false);
  });

  it("com lembrete: mostra", () => {
    expect(lembreteLancamentoVisivel(base)).toBe(true);
  });

  it("'Agora não' vale só pro dia: amanhã volta", () => {
    expect(lembreteLancamentoVisivel({ ...base, dispensadoEm: "2026-09-28" })).toBe(false);
    expect(lembreteLancamentoVisivel({ ...base, dispensadoEm: "2026-09-27" })).toBe(true);
    expect(lembreteLancamentoVisivel({ ...base, dispensadoEm: "2026-09-28", hoje: "2026-09-29" })).toBe(true);
  });

  it("viagem na fila ou na lista com dia dentro da sequência desfaz o lembrete", () => {
    expect(lembreteLancamentoVisivel({ ...base, datasDeViagens: ["2026-09-28"] })).toBe(false);
    expect(lembreteLancamentoVisivel({ ...base, datasDeViagens: ["2026-09-23"] })).toBe(false);
  });

  it("viagem antiga (antes da sequência) não desfaz", () => {
    expect(lembreteLancamentoVisivel({ ...base, datasDeViagens: ["2026-09-22", "2026-09-01"] })).toBe(true);
  });

  it("texto: singular, plural e sem 'empresa/frota/controle'", () => {
    expect(textoLembreteLancamento(1)).toBe(
      "Você está há 1 dia sem lançar viagem. Viagem que não é lançada não entra no seu acerto.",
    );
    const t = textoLembreteLancamento(4);
    expect(t).toContain("há 4 dias");
    expect(t).not.toMatch(/empresa|frota|controle|schaba/i);
  });
});

describe("descreverRegraConferencia com lembrete no app", () => {
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
  it("desligado (ou campo ausente): o texto é o de sempre", () => {
    expect(descreverRegraConferencia(base)).not.toMatch(/app mostra/);
    expect(descreverRegraConferencia({ ...base, lembreteNoApp: false })).not.toMatch(/app mostra/);
  });
  it("ligado: cita o lembrete, pra quem e quantos dias", () => {
    const t = descreverRegraConferencia({ ...base, lembreteNoApp: true, lembreteParaQuem: "SO_QUEM_SAIU", diasParaLembreteNoApp: 3 });
    expect(t).toMatch(/o app mostra um lembrete/);
    expect(t).toMatch(/pediu pra parar/);
    expect(t).toMatch(/3 dias esperados/);
    expect(
      descreverRegraConferencia({ ...base, lembreteNoApp: true, lembreteParaQuem: "TODOS_QUE_ATRASARAM", diasParaLembreteNoApp: 1 }),
    ).toMatch(/qualquer motorista.*1 dia esperado/);
  });
});

describe("regra de atividade (janelaAtividadeDias)", () => {
  // Hoje = 28/09/2026 (segunda). 45 dias antes = 14/08/2026.
  const c = (janela: number) => cfg({ janelaAtividadeDias: janela });
  const av = (janela: number, over: Partial<MotoristaParaConferencia>, agora = SEG_MANHA) =>
    avaliarConferenciaDiaria(c(janela), mot(over), SEM_FERIADO, agora);

  it("última viagem MAIS antiga que N dias: semMovimento, não pergunta, motivo legível e evidência", () => {
    const r = av(45, { diasComViagem: ["2026-08-13"] }); // 46 dias
    expect(r.semMovimento).toBe(true);
    expect(r.deveriaPerguntar).toBe(false);
    expect(r.motivo).toBe("Sem viagem há mais de 45 dias (última em 13/08/2026).");
    expect(r.evidencias.diasSemMovimento).toBe(46);
  });

  it("limite exato: exatamente N dias atrás ainda conta como ativo", () => {
    const r = av(45, { diasComViagem: ["2026-08-14"] }); // 45 dias
    expect(r.semMovimento).toBeUndefined();
    expect(r.deveriaPerguntar).toBe(true);
    expect(r.evidencias.diasSemMovimento).toBeUndefined();
  });

  it("N = 0 desliga a regra: comportamento de sempre", () => {
    const r = av(0, { diasComViagem: ["2026-06-05"] });
    expect(r.semMovimento).toBeUndefined();
    expect(r.deveriaPerguntar).toBe(true);
    const sem = avaliarConferenciaDiaria(cfg(), mot({ diasComViagem: ["2026-06-05"] }), SEM_FERIADO, SEG_MANHA);
    expect(sem.deveriaPerguntar).toBe(true);
  });

  it("quem NUNCA lançou não é afetado: segue só incluirQueNuncaLancou", () => {
    const entra = av(45, { diasComViagem: [] });
    expect(entra.semMovimento).toBeUndefined();
    expect(entra.deveriaPerguntar).toBe(true);
    const fora = avaliarConferenciaDiaria(
      { ...c(45), incluirQueNuncaLancou: false },
      mot({ diasComViagem: [] }),
      SEM_FERIADO,
      SEG_MANHA,
    );
    expect(fora.semMovimento).toBeUndefined();
    expect(fora.deveriaPerguntar).toBe(false);
  });

  it("viagem EM_ANDAMENTO é movimento, mesmo com a última data antiga", () => {
    const r = av(45, { diasComViagem: ["2026-06-05"], temViagemEmAndamento: true });
    expect(r.semMovimento).toBeUndefined();
    expect(r.deveriaPerguntar).toBe(false);
    expect(r.motivo).toBe("Tem viagem em andamento agora.");
  });

  it("viagem lançada HOJE é atividade (hoje não conta na regra do dia, mas conta aqui)", () => {
    const r = av(7, { diasComViagem: ["2026-06-05", "2026-09-28"] });
    expect(r.semMovimento).toBeUndefined();
  });

  it("fuso: às 21h30 de Brasília (UTC já virou) 'hoje' segue sendo o dia local", () => {
    const noite = new Date("2026-09-29T00:30:00Z"); // 28/09 21:30 em SP
    // 14/08 = 45 dias antes de 28/09 (não 46, como seria em UTC).
    expect(av(45, { diasComViagem: ["2026-08-14"] }, noite).semMovimento).toBeUndefined();
    expect(av(45, { diasComViagem: ["2026-08-13"] }, noite).semMovimento).toBe(true);
  });

  it("o lembrete no app ignora a janela (não é mensagem de WhatsApp)", () => {
    const r = avaliarLembreteNoApp(
      c(45),
      { ativo: true, lembreteNoApp: true, lembreteParaQuem: "TODOS_QUE_ATRASARAM", diasParaLembreteNoApp: 3 },
      { ...mot({ diasComViagem: ["2026-06-05"] }), receberConferenciaDiaria: true },
      SEM_FERIADO,
      SEG_MANHA,
    );
    expect(r).not.toBeNull();
  });

  it("a Regra em vigor só fala da janela quando N > 0", () => {
    const base = {
      horaEnvio: 8,
      diasDoJob: [1, 2, 3, 4, 5],
      regra: "SEM_VIAGEM_NO_DIA_ANTERIOR" as const,
      diasSemViagem: 1,
      diasConsiderados: [1, 2, 3, 4, 5],
      ignorarFeriados: true,
      incluirQueNuncaLancou: true,
      intervaloMinimoDias: 3,
      maxPerguntasPorSemana: 3,
    };
    expect(descreverRegraConferencia({ ...base, janelaAtividadeDias: 0 })).toBe(descreverRegraConferencia(base));
    expect(descreverRegraConferencia({ ...base, janelaAtividadeDias: 45 })).toContain(
      "Só recebe a pergunta quem lançou viagem nos últimos 45 dias",
    );
  });
});

describe("Zod da janela de atividade", () => {
  const ok = (v: unknown) => AtualizarConfigConferenciaDiariaSchema.safeParse({ janelaAtividadeDias: v });
  it("aceita 0 (desligada) e valores dentro da guarda técnica", () => {
    expect(ok(0).success).toBe(true);
    expect(ok(JANELA_ATIVIDADE_VALIDACAO_MIN_DIAS).success).toBe(true);
    expect(ok(JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS).success).toBe(true);
  });
  it("recusa fora da guarda, negativo, quebrado e texto, em PT-BR", () => {
    for (const v of [1, JANELA_ATIVIDADE_VALIDACAO_MIN_DIAS - 1, JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS + 1, -3, 10.5, "abc"]) {
      const r = ok(v);
      expect(r.success, String(v)).toBe(false);
      if (!r.success) expect(r.error.issues[0]!.message).toMatch(/dias|número/);
    }
  });
  it("config antiga sem o campo continua valendo", () => {
    expect(AtualizarConfigConferenciaDiariaSchema.safeParse({}).success).toBe(true);
  });
});

describe("limites de envio da conferência (tolerância, janela do lembrete, reenvios)", () => {
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
  const padroes = { horasToleranciaEnvio: 3, lembreteHoraMin: 7, lembreteHoraMax: 21, reenviar: true };

  it("com os padrões o texto da regra em vigor é idêntico ao de antes (campos ausentes ou explícitos)", () => {
    const antes = descreverRegraConferencia(base);
    expect(descreverRegraConferencia({ ...base, ...padroes })).toBe(antes);
    expect(descreverRegraConferencia({ ...base, ...padroes, reenviar: false })).toBe(antes);
  });
  it("tolerância diferente do padrão entra no texto (singular, plural e zero)", () => {
    expect(descreverRegraConferencia({ ...base, horasToleranciaEnvio: 1 })).toContain(
      "Se a pergunta não sair até 1 hora depois, é cancelada.",
    );
    expect(descreverRegraConferencia({ ...base, horasToleranciaEnvio: 5 })).toContain(
      "Se a pergunta não sair até 5 horas depois, é cancelada.",
    );
    expect(descreverRegraConferencia({ ...base, horasToleranciaEnvio: 0 })).toContain("não sair na hora do horário");
  });
  it("janela do lembrete só aparece com o lembrete ligado e fora do padrão", () => {
    const c = { ...base, lembreteHoraMin: 9, lembreteHoraMax: 18 };
    expect(descreverRegraConferencia({ ...c, reenviar: true })).toContain("Lembrete só entre 9h e 18h.");
    expect(descreverRegraConferencia({ ...c, reenviar: false })).not.toContain("Lembrete só entre");
  });

  const ok = (v: Record<string, unknown>) => AtualizarConfigConferenciaDiariaSchema.safeParse(v);
  it("tolerância aceita 0 a 12 e recusa fora", () => {
    for (const v of [0, 1, 12]) expect(ok({ horasToleranciaEnvio: v }).success, String(v)).toBe(true);
    for (const v of [-1, 13, 2.5, "3"]) expect(ok({ horasToleranciaEnvio: v }).success, String(v)).toBe(false);
  });
  it("limite de reenvios aceita 1 a 50 e recusa fora", () => {
    for (const v of [1, 5, 50]) expect(ok({ maxReenviosPorPergunta: v }).success, String(v)).toBe(true);
    for (const v of [0, 51, 1.5]) expect(ok({ maxReenviosPorPergunta: v }).success, String(v)).toBe(false);
  });
  it("hora do lembrete: min 0-23, max 1-24 e min < max", () => {
    expect(ok({ lembreteHoraMin: 0, lembreteHoraMax: 24 }).success).toBe(true);
    expect(ok({ lembreteHoraMin: 24 }).success).toBe(false);
    expect(ok({ lembreteHoraMax: 0 }).success).toBe(false);
    expect(ok({ lembreteHoraMax: 25 }).success).toBe(false);
    const igual = ok({ lembreteHoraMin: 9, lembreteHoraMax: 9 });
    expect(igual.success).toBe(false);
    expect(!igual.success && igual.error.issues[0]!.message).toMatch(/depois da hora inicial/);
    expect(ok({ lembreteHoraMin: 18, lembreteHoraMax: 9 }).success).toBe(false);
    expect(ok({ lembreteHoraMin: 9, lembreteHoraMax: 18 }).success).toBe(true);
  });
});

describe("número confirmado", () => {
  const D = new Date("2026-09-20T10:00:00Z");

  it("sem nenhum sinal, não está confirmado", () => {
    expect(numeroConfirmado({})).toBe(false);
    expect(numeroConfirmado({ appVistoEm: null, ultimoLoginEm: null, respondeuAntes: false, sessaoWhatsappVinculada: false, telefoneConfirmadoEm: null })).toBe(false);
  });

  it.each([
    ["app visto", { appVistoEm: D }, "APP_VISTO"],
    ["login na identidade", { ultimoLoginEm: D }, "LOGIN_NO_APP"],
    ["respondeu antes no WhatsApp", { respondeuAntes: true }, "RESPONDEU_ANTES"],
    ["sessão de WhatsApp vinculada", { sessaoWhatsappVinculada: true }, "SESSAO_WHATSAPP"],
    ["confirmado pelo escritório", { telefoneConfirmadoEm: D }, "CONFIRMADO_PELO_ESCRITORIO"],
  ] as const)("um sinal basta: %s", (_n, sinais, esperado) => {
    expect(numeroConfirmado(sinais)).toBe(true);
    expect(sinaisDoNumero(sinais)).toEqual([esperado]);
  });

  it("aceita data em texto (vinda de JSON) e vários sinais juntos", () => {
    expect(sinaisDoNumero({ appVistoEm: "2026-09-20T10:00:00Z", respondeuAntes: true })).toEqual(["APP_VISTO", "RESPONDEU_ANTES"]);
  });

  it("'número errado' anula todos os sinais", () => {
    expect(numeroConfirmado({ appVistoEm: D, respondeuAntes: true, telefoneConfirmadoEm: D, telefoneErradoEm: D })).toBe(false);
  });

  it("a lista de sinais é dado: um sinal por chave, todos com rótulo", () => {
    expect(new Set(SINAIS_NUMERO_CONFIRMADO.map((x) => x.sinal)).size).toBe(SINAIS_NUMERO_CONFIRMADO.length);
    expect(SINAIS_NUMERO_CONFIRMADO.every((x) => x.rotulo.length > 0)).toBe(true);
  });
});

describe("avaliarConferenciaDiaria com a opção 'só perguntar número confirmado'", () => {
  const SEM_VIAGEM = mot({ diasComViagem: ["2026-09-20"] }); // segunda 28: sexta 25 sem viagem => perguntaria

  it("desligada (ou ausente): idêntico a hoje, mesmo com numeroConfirmado=false", () => {
    for (const c of [cfg(), cfg({ soPerguntarNumeroConfirmado: false })]) {
      const r = avaliarConferenciaDiaria(c, { ...SEM_VIAGEM, numeroConfirmado: false }, SEM_FERIADO, SEG_MANHA);
      expect(r.deveriaPerguntar).toBe(true);
      expect(r.naoConfirmado).toBeUndefined();
    }
  });

  it("ligada e SEM sinal: não pergunta e vira naoConfirmado, com motivo legível", () => {
    const r = avaliarConferenciaDiaria(cfg({ soPerguntarNumeroConfirmado: true }), { ...SEM_VIAGEM, numeroConfirmado: false }, SEM_FERIADO, SEG_MANHA);
    expect(r).toMatchObject({ deveriaPerguntar: false, naoConfirmado: true });
    expect(r.semMovimento).toBeUndefined();
    expect(r.motivo).toMatch(/número ainda não foi confirmado/);
  });

  it("ligada e COM sinal: pergunta normalmente", () => {
    const r = avaliarConferenciaDiaria(cfg({ soPerguntarNumeroConfirmado: true }), { ...SEM_VIAGEM, numeroConfirmado: true }, SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(true);
    expect(r.naoConfirmado).toBeUndefined();
  });

  it("ligada, mas o chamador não informou os sinais: não barra ninguém", () => {
    const r = avaliarConferenciaDiaria(cfg({ soPerguntarNumeroConfirmado: true }), SEM_VIAGEM, SEM_FERIADO, SEG_MANHA);
    expect(r.deveriaPerguntar).toBe(true);
  });

  it("só marca naoConfirmado quem a regra mandaria perguntar (quem lançou viagem não entra na lista)", () => {
    const r = avaliarConferenciaDiaria(
      cfg({ soPerguntarNumeroConfirmado: true }),
      mot({ diasComViagem: ["2026-09-25"], numeroConfirmado: false }),
      SEM_FERIADO,
      SEG_MANHA,
    );
    expect(r).toMatchObject({ deveriaPerguntar: false });
    expect(r.naoConfirmado).toBeUndefined();
  });

  it("sem movimento tem prioridade (é outra lista)", () => {
    const r = avaliarConferenciaDiaria(
      cfg({ soPerguntarNumeroConfirmado: true, janelaAtividadeDias: 30 }),
      mot({ diasComViagem: ["2026-06-01"], numeroConfirmado: false }),
      SEM_FERIADO,
      SEG_MANHA,
    );
    expect(r.semMovimento).toBe(true);
    expect(r.naoConfirmado).toBeUndefined();
  });

  it("o lembrete DENTRO do app não depende do número confirmado", () => {
    const l = avaliarLembreteNoApp(
      cfg({ soPerguntarNumeroConfirmado: true }),
      { ativo: true, lembreteNoApp: true, lembreteParaQuem: "TODOS_QUE_ATRASARAM", diasParaLembreteNoApp: 1 },
      { ...SEM_VIAGEM, numeroConfirmado: false, receberConferenciaDiaria: true },
      SEM_FERIADO,
      SEG_MANHA,
    );
    expect(l).not.toBeNull();
  });
});

describe("descreverRegraConferencia e o número confirmado", () => {
  const base = {
    horaEnvio: 8, diasDoJob: [1, 2, 3, 4, 5], regra: "SEM_VIAGEM_NO_DIA_ANTERIOR" as const, diasSemViagem: 2,
    diasConsiderados: [1, 2, 3, 4, 5], ignorarFeriados: true, incluirQueNuncaLancou: true,
    intervaloMinimoDias: 3, maxPerguntasPorSemana: 3,
  };
  const FRASE = "Só pergunta a quem tem o número confirmado: já usou o app, já respondeu antes ou foi confirmado pelo escritório.";
  it("ligada: diz a frase", () => {
    expect(descreverRegraConferencia({ ...base, soPerguntarNumeroConfirmado: true })).toContain(FRASE);
  });
  it("desligada ou ausente: texto igual ao de antes", () => {
    expect(descreverRegraConferencia(base)).not.toContain("número confirmado");
    expect(descreverRegraConferencia({ ...base, soPerguntarNumeroConfirmado: false })).toBe(descreverRegraConferencia(base));
  });
  it("o schema aceita o campo e recusa lixo", () => {
    expect(AtualizarConfigConferenciaDiariaSchema.safeParse({ soPerguntarNumeroConfirmado: true }).success).toBe(true);
    expect(AtualizarConfigConferenciaDiariaSchema.safeParse({ soPerguntarNumeroConfirmado: "sim" }).success).toBe(false);
  });
});
