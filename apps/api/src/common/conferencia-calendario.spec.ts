import { describe, expect, it } from "vitest";
import { diaPerguntado, montarCalendarioConferencia, ultimoDiaDoMes } from "./conferencia-calendario";

const AGORA = new Date("2026-09-29T15:00:00Z");

const linha = (over: Record<string, unknown> = {}) => ({
  dia: "2026-09-28",
  estado: "ENVIADA",
  suprimidaPor: null,
  enviadaEm: new Date("2026-09-28T11:10:00Z"),
  respondidaEm: null,
  opcao: null,
  criadoEm: new Date("2026-09-28T11:00:00Z"),
  snapshot: { deveriaPerguntar: true, evidencias: { diasEsperadosVerificados: ["2026-09-25"] } },
  ...over,
});
const viagem = (data: string, sinc: string, off: string | null = null) => ({
  data,
  sincronizadoEm: new Date(sinc),
  criadoOfflineEm: off ? new Date(off) : null,
});
const monta = (o: { viagens?: ReturnType<typeof viagem>[]; linhas?: ReturnType<typeof linha>[]; mes?: string; agora?: Date }) =>
  montarCalendarioConferencia({ mes: o.mes ?? "2026-09", viagens: o.viagens ?? [], linhas: o.linhas ?? [], agora: o.agora ?? AGORA });
const dia = (c: ReturnType<typeof monta>, d: string) => c.dias.find((x) => x.dia === d)!;

describe("montarCalendarioConferencia", () => {
  it("devolve todos os dias do mês, neutros quando não há nada", () => {
    const c = monta({});
    expect(c.dias).toHaveLength(30);
    expect(c.dias.every((d) => !d.lancou && d.viagens === 0 && !d.pergunta)).toBe(true);
    expect(c.totais).toEqual({ diasComViagem: 0, perguntados: 0, respondidos: 0, retroativos: 0, semResposta: 0, semCanal: 0 });
    expect(c.hoje).toBe("2026-09-29");
  });

  it("dia com viagem normal: lançou, sem pergunta", () => {
    const c = monta({ viagens: [viagem("2026-09-10", "2026-09-10T20:00:00Z"), viagem("2026-09-10", "2026-09-10T22:00:00Z")] });
    expect(dia(c, "2026-09-10")).toEqual({ dia: "2026-09-10", lancou: true, viagens: 2 });
    expect(c.totais.diasComViagem).toBe(1);
  });

  it("marca o dia ESPERADO da pergunta, não o dia em que o job rodou", () => {
    const c = monta({ linhas: [linha()] });
    expect(dia(c, "2026-09-25").pergunta?.estado).toBe("ENVIADA");
    expect(dia(c, "2026-09-28").pergunta).toBeUndefined();
  });

  it("sem dias esperados no snapshot, o dia perguntado é o anterior ao do job", () => {
    expect(diaPerguntado({ dia: "2026-10-01", snapshot: {} })).toBe("2026-09-30");
    expect(diaPerguntado({ dia: "2026-09-28", snapshot: null })).toBe("2026-09-27");
  });

  it("perguntado + 'Não tive'", () => {
    const c = monta({
      linhas: [linha({ estado: "RESPONDIDA", opcao: "NAO_TIVE", respondidaEm: new Date("2026-09-28T11:40:00Z") })],
    });
    const p = dia(c, "2026-09-25").pergunta!;
    expect(p.resposta).toBe("NAO_TIVE");
    expect(p.retroativo).toBe(false);
    expect(p.respondidaEm).toBe("2026-09-28T11:40:00.000Z");
    expect(c.totais).toMatchObject({ perguntados: 1, respondidos: 1, retroativos: 0 });
  });

  it("lançou DEPOIS da pergunta = retroativo", () => {
    const c = monta({
      linhas: [linha({ estado: "RESPONDIDA", opcao: "TIVE_NAO_LANCEI" })],
      viagens: [viagem("2026-09-25", "2026-09-28T14:00:00Z")],
    });
    const d = dia(c, "2026-09-25");
    expect(d.lancou).toBe(true);
    expect(d.pergunta).toMatchObject({ retroativo: true, lancouDepoisEm: "2026-09-28T14:00:00.000Z", viagensDepois: 1 });
    expect(c.totais.retroativos).toBe(1);
  });

  it("lançou ANTES da pergunta = não retroativo", () => {
    const c = monta({ linhas: [linha()], viagens: [viagem("2026-09-25", "2026-09-28T10:00:00Z")] });
    const p = dia(c, "2026-09-25").pergunta!;
    expect(p.retroativo).toBe(false);
    expect(p.lancouDepoisEm).toBeNull();
    expect(c.totais.retroativos).toBe(0);
  });

  it("criada offline antes da pergunta e sincronizada depois NÃO é retroativa", () => {
    const c = monta({
      linhas: [linha()],
      viagens: [viagem("2026-09-25", "2026-09-28T13:00:00Z", "2026-09-25T18:00:00Z")],
    });
    expect(dia(c, "2026-09-25").pergunta?.retroativo).toBe(false);
  });

  it("criada offline depois da pergunta é retroativa (vale o instante mais antigo)", () => {
    const c = monta({
      linhas: [linha()],
      viagens: [viagem("2026-09-25", "2026-09-28T20:00:00Z", "2026-09-28T13:00:00Z")],
    });
    expect(dia(c, "2026-09-25").pergunta?.lancouDepoisEm).toBe("2026-09-28T13:00:00.000Z");
  });

  it("viagem de outro dia não torna a pergunta retroativa", () => {
    const c = monta({ linhas: [linha()], viagens: [viagem("2026-09-26", "2026-09-28T14:00:00Z")] });
    expect(dia(c, "2026-09-25").pergunta?.retroativo).toBe(false);
  });

  it("sem resposta (expirada) e esperando resposta (enviada)", () => {
    const c = monta({
      linhas: [
        linha({ estado: "EXPIRADA" }),
        linha({ dia: "2026-09-29", snapshot: { evidencias: { diasEsperadosVerificados: ["2026-09-28"] } } }),
      ],
    });
    expect(dia(c, "2026-09-25").pergunta?.estado).toBe("EXPIRADA");
    expect(dia(c, "2026-09-28").pergunta?.estado).toBe("ENVIADA");
    expect(c.totais).toMatchObject({ perguntados: 2, semResposta: 1 });
  });

  it("sem canal: aparece, não conta como perguntado e nunca é retroativo", () => {
    const c = monta({
      linhas: [linha({ estado: "SUPRIMIDA", suprimidaPor: "SEM_TELEFONE", enviadaEm: null })],
      viagens: [viagem("2026-09-25", "2026-09-28T14:00:00Z")],
    });
    const p = dia(c, "2026-09-25").pergunta!;
    expect(p).toMatchObject({ semCanal: "SEM_TELEFONE", enviadaEm: null, retroativo: false });
    expect(c.totais).toMatchObject({ perguntados: 0, semCanal: 1, retroativos: 0 });
  });

  it("linhas que o motorista nunca viveu ficam de fora: sombra e suprimida por regra", () => {
    const c = monta({
      linhas: [
        linha({ estado: "SOMBRA", enviadaEm: null }),
        linha({ dia: "2026-09-21", estado: "SUPRIMIDA", enviadaEm: null, snapshot: { deveriaPerguntar: false } }),
      ],
    });
    expect(c.dias.some((d) => d.pergunta)).toBe(false);
  });

  it("virada de mês: o job em 01/10 pergunta sobre 30/09 e cai em setembro, não em outubro", () => {
    const l = linha({ dia: "2026-10-01", snapshot: { evidencias: { diasEsperadosVerificados: ["2026-09-30"] } } });
    expect(dia(monta({ linhas: [l] }), "2026-09-30").pergunta).toBeDefined();
    const out = monta({ mes: "2026-10", linhas: [l] });
    expect(out.dias).toHaveLength(31);
    expect(out.dias.some((d) => d.pergunta)).toBe(false);
  });

  it("dias do mês: fevereiro bissexto e não bissexto", () => {
    expect(ultimoDiaDoMes("2028-02")).toBe("2028-02-29");
    expect(ultimoDiaDoMes("2026-02")).toBe("2026-02-28");
    expect(monta({ mes: "2026-12" }).dias.at(-1)?.dia).toBe("2026-12-31");
  });

  it("viagem EM_ANDAMENTO (qualquer status) conta como lançou: o status nem entra na regra", () => {
    const c = monta({ viagens: [viagem("2026-09-29", "2026-09-29T12:00:00Z")] });
    expect(dia(c, "2026-09-29")).toMatchObject({ lancou: true, viagens: 1 });
  });

  it("fuso: pergunta às 21h30 de Brasília (00:30Z do dia seguinte) e 'hoje' ainda é o dia de Brasília", () => {
    const agora = new Date("2026-09-29T00:30:00Z"); // 28/09 21:30 em SP
    const c = monta({
      agora,
      linhas: [linha({ enviadaEm: agora, dia: "2026-09-28" })],
      viagens: [viagem("2026-09-25", "2026-09-29T00:31:00Z"), viagem("2026-09-25", "2026-09-29T00:29:00Z")],
    });
    expect(c.hoje).toBe("2026-09-28");
    // 00:29Z é antes da pergunta (não conta); 00:31Z é depois.
    expect(dia(c, "2026-09-25").pergunta).toMatchObject({ retroativo: true, viagensDepois: 1, lancouDepoisEm: "2026-09-29T00:31:00.000Z" });
  });

  it("duas perguntas sobre o mesmo dia: vale a mais recente", () => {
    const c = monta({
      linhas: [linha({ dia: "2026-09-26", estado: "EXPIRADA" }), linha({ dia: "2026-09-28", estado: "RESPONDIDA", opcao: "NAO_TIVE" })],
    });
    expect(dia(c, "2026-09-25").pergunta?.estado).toBe("RESPONDIDA");
    expect(c.totais.perguntados).toBe(1);
  });
});

describe("dados técnicos do dia (só pra quem decide)", () => {
  const l = linha({ id: "L1", estado: "RESPONDIDA", opcao: "NAO_TIVE", wamid: "wamid.X", reenvios: 1, respostaTexto: "Não tive", trilha: [{ em: "2026-09-29T12:00:00.000Z", evento: "TOQUE", detalhe: {} }] });

  it("sem o pedido, a resposta é a de sempre (retrocompatível) e só ganha `linhaDia`", () => {
    const p = dia(monta({ linhas: [l] }), "2026-09-25").pergunta!;
    expect(p).not.toHaveProperty("tecnico");
    expect(p.linhaDia).toBe(l.dia);
  });

  it("com o pedido, traz id, estado, opção, wamid, respostaTexto e a trilha em ordem", () => {
    const c = montarCalendarioConferencia({ mes: "2026-09", viagens: [], linhas: [l as never], agora: AGORA, incluirTecnico: true });
    const t = dia(c, "2026-09-25").pergunta!.tecnico!;
    expect(t).toMatchObject({ id: "L1", estado: "RESPONDIDA", opcao: "NAO_TIVE", wamid: "wamid.X", reenvios: 1, respostaTexto: "Não tive" });
    expect(t.trilha.map((e) => e.evento)).toEqual(["TOQUE"]);
  });
});
