import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

// 28/09/2026 é segunda-feira. 08:10 em Brasília = 11:10Z.
const AGORA = new Date("2026-09-28T11:10:00Z");
const DIA = new Date("2026-09-28T00:00:00Z");

const CFG = {
  id: "cfg1",
  ativo: true,
  modo: "ENVIANDO" as "SOMBRA" | "ENVIANDO",
  horaEnvio: 8,
  diasDoJob: [1, 2, 3, 4, 5],
  regra: "SEM_VIAGEM_NO_DIA_ANTERIOR",
  diasSemViagem: 2,
  diasConsiderados: [1, 2, 3, 4, 5],
  ignorarFeriados: true,
  incluirQueNuncaLancou: true,
  intervaloMinimoDias: 3,
  maxPerguntasPorSemana: 3,
  quemEntra: "TODOS_APROVADOS",
  modalidadeIds: [],
  transportadoraIds: [],
  reenviar: false,
  horasParaLembrar: 4,
  horasParaExpirar: 24,
  mensagemAoParar: null,
  contatoEmpresa: null,
  suprimirResumoQuemRecebeuPergunta: true,
  mensagensParaSuspeitar: 3,
  diasParaSuspeitar: 7,
};

const EVID = { hoje: "2026-09-28", diasEsperadosVerificados: ["2026-09-25"], ultimoDiaComViagem: "2026-09-20", nuncaLancou: false };
const item = (id: string, over: Record<string, unknown> = {}) => ({
  motoristaId: id,
  nome: `Motorista ${id}`,
  deveriaPerguntar: true,
  motivo: "Sem viagem lançada no dia esperado anterior (25/09/2026, sexta).",
  evidencias: EVID,
  semCanal: null,
  ...over,
});

function montar(
  opts: {
    cfg?: Partial<typeof CFG>;
    disponivel?: boolean;
    teto?: number | null;
    usadasNaHora?: number;
    jaRodou?: number;
    pendentes?: Record<string, unknown>[];
    candidatosLembrete?: Record<string, unknown>[];
    sombra?: Record<string, unknown>[];
    envioResultado?: Record<string, unknown>;
    sugestao?: Record<string, unknown> | null;
    lancouDepois?: boolean;
  } = {},
) {
  const cfg = { ...CFG, ...opts.cfg };
  const createMany = vi.fn(async (a: { data: unknown[] }) => ({ count: a.data.length }));
  const update = vi.fn(async (_a: unknown) => ({}));
  const updateMany = vi.fn(async (_a: unknown) => ({ count: 0 }));
  const findMany = vi.fn(async (a: { where: { estado?: string } }) => {
    if (a.where.estado === "PENDENTE") return opts.pendentes ?? [];
    if (a.where.estado === "ENVIADA") return opts.candidatosLembrete ?? [];
    if (a.where.estado === "SOMBRA") return opts.sombra ?? [];
    return [];
  });
  const prisma = {
    moduloContratado: { findMany: vi.fn(async () => [{ chave: "conferencia", vigenteDe: null, vigenteAte: null }]) },
    configuracaoConferenciaDiaria: { findFirst: vi.fn(async () => cfg) },
    conferenciaDiaria: { count: vi.fn(async () => opts.jaRodou ?? 0), createMany, update, updateMany, findMany },
    configuracaoPlataforma: {
      findUnique: vi.fn(async () => (opts.teto === null ? null : { maxConferenciasPorHora: opts.teto ?? 60 })),
    },
    whatsappMensagem: { count: vi.fn(async () => opts.usadasNaHora ?? 0) },
    viagem: { findFirst: vi.fn(async () => (opts.lancouDepois ? { id: "v1" } : null)) },
    sugestaoGestor: {
      findUnique: vi.fn(async () => (opts.sugestao === undefined ? null : opts.sugestao)),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const tentarEnviar = vi.fn(
    async (_e: Record<string, any>) => opts.envioResultado ?? { enviado: true, idExterno: "wamid.NOVO" },
  );
  const disponivel = vi.fn(async () => ({ ok: opts.disponivel ?? true, motivo: "Meta não configurada" }));
  const manter = vi.fn(async () => ({ resolvidas: 0, expiradas: 0 }));
  const motoristasUpdate = vi.fn(async (..._a: unknown[]) => ({}));
  const log = vi.fn(async (_a: unknown) => {});
  const svc = new ConferenciaDiariaService(
    prisma as never,
    { log, logDiff: vi.fn() } as never,
    { tentarEnviar, disponivel } as never,
    { manter } as never,
    { update: motoristasUpdate } as never,
  );
  return { svc, prisma, createMany, update, updateMany, tentarEnviar, disponivel, motoristasUpdate, manter, log, cfg };
}

const pend = (id: string, tel: string | null = "42991088125", over: Record<string, unknown> = {}) => ({
  id,
  snapshot: { evidencias: EVID },
  dia: DIA,
  motorista: {
    id: `m-${id}`,
    telefone: tel,
    aceitaWhatsapp: true,
    receberConferenciaDiaria: true,
    whatsappInalcancavelEm: null,
    ...over,
  },
});

describe("modo sombra x enviando", () => {
  it("SOMBRA: grava a linha como SOMBRA e não envia nada", async () => {
    const t = montar({ cfg: { modo: "SOMBRA" } });
    vi.spyOn(t.svc as never, "calcular").mockResolvedValue([item("a")] as never);
    await t.svc.rodarDaVez("c1", AGORA);
    const dados = t.createMany.mock.calls[0]![0].data as { estado: string }[];
    expect(dados.map((d) => d.estado)).toEqual(["SOMBRA"]);
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("ENVIANDO com a Meta disponível: nasce PENDENTE e sai na mesma batida", async () => {
    const t = montar({ pendentes: [pend("a")] });
    vi.spyOn(t.svc as never, "calcular").mockResolvedValue([item("a")] as never);
    await t.svc.rodarDaVez("c1", AGORA);
    const dados = t.createMany.mock.calls[0]![0].data as { estado: string }[];
    expect(dados.map((d) => d.estado)).toEqual(["PENDENTE"]);
    expect(t.tentarEnviar).toHaveBeenCalledOnce();
  });

  it("ENVIANDO mas a Meta NÃO está configurada: cai em SOMBRA, com o motivo no snapshot, e não envia", async () => {
    const t = montar({ disponivel: false });
    vi.spyOn(t.svc as never, "calcular").mockResolvedValue([item("a")] as never);
    await t.svc.rodarDaVez("c1", AGORA);
    const d = (t.createMany.mock.calls[0]![0].data as { estado: string; snapshot: Record<string, unknown> }[])[0]!;
    expect(d.estado).toBe("SOMBRA");
    expect(d.snapshot.nadaEnviado).toBe(true);
    expect(d.snapshot.semEnvioPorque).toBe("Meta não configurada");
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("conferência DESLIGADA não grava nem envia, mesmo em modo ENVIANDO", async () => {
    const t = montar({ cfg: { ativo: false } });
    const calcular = vi.spyOn(t.svc as never, "calcular");
    await t.svc.rodarDaVez("c1", AGORA);
    expect(calcular).not.toHaveBeenCalled();
    expect(t.createMany).not.toHaveBeenCalled();
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("usa `disponivel(\"CONFERENCIA_DIARIA\")` antes de qualquer envio", async () => {
    const t = montar({ pendentes: [pend("a")] });
    vi.spyOn(t.svc as never, "calcular").mockResolvedValue([item("a")] as never);
    await t.svc.rodarDaVez("c1", AGORA);
    expect(t.disponivel).toHaveBeenCalledWith("CONFERENCIA_DIARIA");
  });

  it("fora da hora configurada não grava o dia", async () => {
    const t = montar();
    await t.svc.rodarDaVez("c1", new Date("2026-09-28T15:00:00Z")); // 12h
    expect(t.createMany).not.toHaveBeenCalled();
  });

  it("idempotente: o dia que já rodou não grava de novo", async () => {
    const t = montar({ jaRodou: 5 });
    const calcular = vi.spyOn(t.svc as never, "calcular");
    await t.svc.rodarDaVez("c1", AGORA);
    expect(calcular).not.toHaveBeenCalled();
  });

  it("envio ligado DEPOIS da sombra do dia: quem ainda deve ser perguntado vira PENDENTE; quem lançou nesse meio tempo continua em SOMBRA", async () => {
    const t = montar({
      jaRodou: 2,
      sombra: [
        { id: "l1", motoristaId: "a", snapshot: { nadaEnviado: true, semEnvioPorque: "modo sombra", evidencias: EVID } },
        { id: "l2", motoristaId: "b", snapshot: { nadaEnviado: true, semEnvioPorque: "modo sombra", evidencias: EVID } },
      ],
    });
    vi.spyOn(t.svc as never, "calcular").mockResolvedValue([
      item("a"),
      item("b", { deveriaPerguntar: false }),
    ] as never);
    await t.svc.rodarDaVez("c1", AGORA);
    const chamadas = t.update.mock.calls.map(
      (c) => c[0] as { where: { id: string }; data: { estado: string; snapshot: Record<string, unknown> } },
    );
    const promovidas = chamadas.filter((c) => c.data.estado === "PENDENTE");
    expect(promovidas.map((c) => c.where.id)).toEqual(["l1"]);
    expect(promovidas[0]!.data.snapshot).toMatchObject({ nadaEnviado: false, promovidaDeSombra: true });
    expect(promovidas[0]!.data.snapshot).not.toHaveProperty("semEnvioPorque");
    expect(t.createMany).not.toHaveBeenCalled();
  });

  it("sombra do dia NÃO é promovida se o modo continua SOMBRA", async () => {
    const t = montar({
      cfg: { modo: "SOMBRA" },
      jaRodou: 1,
      sombra: [{ id: "l1", motoristaId: "a", snapshot: {} }],
    });
    const calcular = vi.spyOn(t.svc as never, "calcular");
    await t.svc.rodarDaVez("c1", AGORA);
    expect(calcular).not.toHaveBeenCalled();
    expect(t.update).not.toHaveBeenCalled();
  });

  it("quem NÃO tem canal (parou, inalcançável) é registrado como SUPRIMIDA com a marca, nunca perguntado", async () => {
    const t = montar();
    vi.spyOn(t.svc as never, "calcular").mockResolvedValue([
      item("a", { semCanal: "PAROU" }),
      item("b", { semCanal: "INALCANCAVEL" }),
      item("c", { deveriaPerguntar: false, semCanal: "PAROU", motivo: "Lançou viagem." }),
    ] as never);
    await t.svc.rodarDaVez("c1", AGORA);
    const dados = t.createMany.mock.calls[0]![0].data as { estado: string; suprimidaPor: string | null }[];
    expect(dados.map((d) => [d.estado, d.suprimidaPor])).toEqual([
      ["SUPRIMIDA", "PAROU"],
      ["SUPRIMIDA", "INALCANCAVEL"],
      ["SUPRIMIDA", null], // não precisava perguntar: sem marca
    ]);
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });
});

describe("envio da pergunta", () => {
  it("manda o template com o dia esperado e os 4 payloads cv:<id>:<opcao>", async () => {
    const t = montar({ pendentes: [pend("abc-1")] });
    await t.svc.enviarPendentes(t.cfg as never, AGORA);
    const e = t.tentarEnviar.mock.calls[0]![0];
    expect(e.rota).toBe("CONFERENCIA_DIARIA");
    expect(e.destino).toEqual({ tipo: "TELEFONE", numero: "5542991088125" });
    expect(e.params).toEqual(["sexta, 25/09"]);
    expect(e.payloads).toEqual([
      "cv:abc-1:NAO_TIVE",
      "cv:abc-1:TIVE_NAO_LANCEI",
      "cv:abc-1:SAI_DA_EMPRESA",
      "cv:abc-1:PARAR",
    ]);
  });

  it("guarda o wamid e marca ENVIADA", async () => {
    const t = montar({ pendentes: [pend("a")] });
    await t.svc.enviarPendentes(t.cfg as never, AGORA);
    expect(t.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: expect.objectContaining({ estado: "ENVIADA", wamid: "wamid.NOVO", enviadaEm: expect.any(Date) }),
    });
  });

  it("a Meta recusa (política): FALHOU com o motivo", async () => {
    const t = montar({
      pendentes: [pend("a")],
      envioResultado: { enviado: false, erro: { tipo: "POLITICA", codigo: "META_132001", detalhe: "template não existe" } },
    });
    await t.svc.enviarPendentes(t.cfg as never, AGORA);
    expect(t.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { estado: "FALHOU", erroEnvio: "META_132001: template não existe" },
    });
  });

  it("Meta fora do ar (transporte): continua PENDENTE pra próxima batida", async () => {
    const t = montar({
      pendentes: [pend("a")],
      envioResultado: { enviado: false, erro: { tipo: "TRANSPORTE", codigo: "META_INDISPONIVEL", detalhe: "timeout" } },
    });
    await t.svc.enviarPendentes(t.cfg as never, AGORA);
    const data = (t.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.estado).toBeUndefined();
    expect(data.erroEnvio).toContain("META_INDISPONIVEL");
  });

  it("teto por hora: só envia as vagas que restam; o resto fica PENDENTE", async () => {
    const t = montar({ pendentes: [pend("a"), pend("b"), pend("c")], teto: 10, usadasNaHora: 8 });
    const n = await t.svc.enviarPendentes(t.cfg as never, AGORA);
    expect(n).toBe(2);
    expect(t.tentarEnviar).toHaveBeenCalledTimes(2);
  });

  it("teto esgotado: não envia nada", async () => {
    const t = montar({ pendentes: [pend("a")], teto: 5, usadasNaHora: 5 });
    expect(await t.svc.enviarPendentes(t.cfg as never, AGORA)).toBe(0);
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("sem linha de plataforma vale o teto padrão de 60 por hora", async () => {
    const t = montar({ pendentes: [pend("a")], teto: null, usadasNaHora: 59 });
    expect(await t.svc.enviarPendentes(t.cfg as never, AGORA)).toBe(1);
    const t2 = montar({ pendentes: [pend("a")], teto: null, usadasNaHora: 60 });
    expect(await t2.svc.enviarPendentes(t2.cfg as never, AGORA)).toBe(0);
  });

  it("motorista que parou entre a gravação e o envio NÃO recebe", async () => {
    const t = montar({ pendentes: [pend("a", "42991088125", { receberConferenciaDiaria: false })] });
    await t.svc.enviarPendentes(t.cfg as never, AGORA);
    expect(t.tentarEnviar).not.toHaveBeenCalled();
    expect(t.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { estado: "SUPRIMIDA", suprimidaPor: "PAROU" } });
  });

  it("número suspeito de inalcançável não recebe", async () => {
    const t = montar({ pendentes: [pend("a", "42991088125", { whatsappInalcancavelEm: new Date() })] });
    await t.svc.enviarPendentes(t.cfg as never, AGORA);
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("passada a tolerância (horário + 3h) o que não saiu vira FALHOU — não se pergunta 'ontem' às 15h", async () => {
    const t = montar({ pendentes: [pend("a")] });
    await t.svc.enviarPendentes(t.cfg as never, new Date("2026-09-28T15:00:00Z")); // 12h
    expect(t.tentarEnviar).not.toHaveBeenCalled();
    expect(t.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: "FALHOU" }) }));
  });

  it("modo SOMBRA nunca envia, mesmo com linhas PENDENTE de um dia em que estava ENVIANDO", async () => {
    const t = montar({ cfg: { modo: "SOMBRA" }, pendentes: [pend("a")] });
    expect(await t.svc.enviarPendentes({ ...t.cfg, modo: "SOMBRA" } as never, AGORA)).toBe(0);
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });
});

describe("lembrete e expiração", () => {
  const enviada = (id: string, horasAtras: number) => ({
    ...pend(id),
    enviadaEm: new Date(AGORA.getTime() - horasAtras * 3_600_000),
  });
  const cfg = { ...CFG, reenviar: true };

  it("expira a pergunta sem resposta depois das horas configuradas", async () => {
    const t = montar();
    await t.svc.lembrarEExpirar({ ...CFG, horasParaExpirar: 12 } as never, AGORA);
    const a = t.updateMany.mock.calls[0]![0] as { where: { estado: string; enviadaEm: { lt: Date } }; data: { estado: string } };
    expect(a.data.estado).toBe("EXPIRADA");
    expect(a.where.enviadaEm.lt.getTime()).toBe(AGORA.getTime() - 12 * 3_600_000);
  });

  it("manda UM lembrete (mesmos botões) e carimba, quando a empresa quis", async () => {
    const t = montar({ candidatosLembrete: [enviada("a", 5)] });
    const r = await t.svc.lembrarEExpirar(cfg as never, AGORA);
    expect(r.lembretes).toBe(1);
    expect(t.tentarEnviar.mock.calls[0]![0].payloads[3]).toBe("cv:a:PARAR");
    expect(t.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: expect.objectContaining({ lembreteEnviadoEm: expect.any(Date), lembreteWamid: "wamid.NOVO" }),
    });
  });

  it("sem `reenviar` não há lembrete", async () => {
    const t = montar({ candidatosLembrete: [enviada("a", 5)] });
    const r = await t.svc.lembrarEExpirar({ ...CFG, reenviar: false } as never, AGORA);
    expect(r.lembretes).toBe(0);
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("só pega quem ainda não recebeu lembrete e está dentro da janela", async () => {
    const t = montar();
    await t.svc.lembrarEExpirar(cfg as never, AGORA);
    const q = t.prisma.conferenciaDiaria.findMany.mock.calls[0]![0] as {
      where: { lembreteEnviadoEm: null; enviadaEm: { lte: Date; gt: Date } };
    };
    expect(q.where.lembreteEnviadoEm).toBeNull();
    expect(q.where.enviadaEm.lte.getTime()).toBe(AGORA.getTime() - 4 * 3_600_000);
    expect(q.where.enviadaEm.gt.getTime()).toBe(AGORA.getTime() - 24 * 3_600_000);
  });

  it("quem já lançou viagem depois da pergunta não é incomodado", async () => {
    const t = montar({ candidatosLembrete: [enviada("a", 5)], lancouDepois: true });
    const r = await t.svc.lembrarEExpirar(cfg as never, AGORA);
    expect(r.lembretes).toBe(0);
  });

  it("de madrugada não manda lembrete", async () => {
    const t = montar({ candidatosLembrete: [enviada("a", 5)] });
    const r = await t.svc.lembrarEExpirar(cfg as never, new Date("2026-09-28T04:00:00Z")); // 01h
    expect(r.lembretes).toBe(0);
  });
});

describe("fila do gestor: aprovar", () => {
  const sug = (tipo: string, over: Record<string, unknown> = {}) => ({
    id: "s1",
    tipo,
    status: "ABERTA",
    motoristaId: "m9",
    ...over,
  });
  const usuario = (permissoes: string[]) =>
    ({ id: "u1", permissoes, escopo: null }) as never;

  it("INATIVAR_VINCULO chama o MotoristasService.update existente, com o usuário e o escopo", async () => {
    const t = montar({ sugestao: sug("INATIVAR_VINCULO") });
    await t.svc.aprovarSugestao("s1", usuario(["conferencia-diaria.decidir", "motoristas.editar"]));
    expect(t.motoristasUpdate).toHaveBeenCalledWith("m9", { ativo: false }, null, "u1");
    expect(t.prisma.sugestaoGestor.updateMany).toHaveBeenCalled();
  });

  it("sem `motoristas.editar` não inativa: 403, e a sugestão continua aberta", async () => {
    const t = montar({ sugestao: sug("INATIVAR_VINCULO") });
    await expect(
      t.svc.aprovarSugestao("s1", usuario(["conferencia-diaria.decidir"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.motoristasUpdate).not.toHaveBeenCalled();
    expect(t.prisma.sugestaoGestor.updateMany).not.toHaveBeenCalled();
  });

  it.each(["LANCAR_VIAGEM_FALTANTE", "RESPOSTA_AMBIGUA", "MOTORISTA_PAROU_WHATSAPP", "WHATSAPP_INALCANCAVEL"])(
    "aprovar %s NÃO mexe no cadastro do motorista",
    async (tipo) => {
      const t = montar({ sugestao: sug(tipo) });
      await t.svc.aprovarSugestao("s1", usuario(["conferencia-diaria.decidir"]));
      expect(t.motoristasUpdate).not.toHaveBeenCalled();
    },
  );

  it("recusar nunca mexe no cadastro, nem pra INATIVAR_VINCULO", async () => {
    const t = montar({ sugestao: sug("INATIVAR_VINCULO") });
    await t.svc.recusarSugestao("s1", usuario(["conferencia-diaria.decidir"]), "ele só está de férias");
    expect(t.motoristasUpdate).not.toHaveBeenCalled();
    expect(t.prisma.sugestaoGestor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RECUSADA", chaveViva: null, decididaPorId: "u1" }) }),
    );
  });

  it("sugestão já decidida: 409, e nada acontece", async () => {
    const t = montar({ sugestao: sug("INATIVAR_VINCULO", { status: "APROVADA" }) });
    await expect(
      t.svc.aprovarSugestao("s1", usuario(["conferencia-diaria.decidir", "motoristas.editar"])),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.motoristasUpdate).not.toHaveBeenCalled();
  });

  it("decisão fica na auditoria", async () => {
    const t = montar({ sugestao: sug("LANCAR_VIAGEM_FALTANTE") });
    await t.svc.aprovarSugestao("s1", usuario(["conferencia-diaria.decidir"]));
    expect(t.log).toHaveBeenCalledWith(expect.objectContaining({ acao: "CONFERENCIA_SUGESTAO_DECIDIDA", usuarioId: "u1" }));
  });
});

describe("invariante: o sistema nunca inativa motorista sozinho", () => {
  /**
   * Varre o código da conferência inteira atrás de escrita de "ativo = false".
   * A ÚNICA ocorrência permitida é dentro de `aprovarSugestao` (handler com
   * usuário humano, atrás de `conferencia-diaria.decidir` + `motoristas.editar`).
   * Um cron, o webhook ou a resposta do motorista escrevendo isso é o bug que
   * este teste existe pra barrar.
   */
  const RE = /\bativo\s*:\s*false\b/;
  const dir = __dirname;
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
  const extras = [
    join(dir, "..", "..", "whatsapp", "meta-webhook.controller.ts"),
    join(dir, "..", "..", "common", "conferencia-resposta.ts"),
    join(dir, "..", "..", "common", "whatsapp-alcance.ts"),
  ];

  it("nenhum arquivo do módulo (fora o serviço) escreve ativo:false", () => {
    for (const f of arquivos.filter((a) => a !== "conferencia-diaria.service.ts")) {
      expect(RE.test(readFileSync(join(dir, f), "utf8")), `${f} escreve ativo:false`).toBe(false);
    }
    for (const f of extras) expect(RE.test(readFileSync(f, "utf8")), `${f} escreve ativo:false`).toBe(false);
  });

  it("no serviço, só dentro de aprovarSugestao", () => {
    const src = readFileSync(join(dir, "conferencia-diaria.service.ts"), "utf8");
    const ini = src.indexOf("async aprovarSugestao(");
    const fim = src.indexOf("\n  async recusarSugestao(");
    expect(ini).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(ini);
    const fora = src.slice(0, ini) + src.slice(fim);
    expect(RE.test(fora)).toBe(false);
    expect(RE.test(src.slice(ini, fim))).toBe(true);
  });

  it("e a aprovação passa pelo MotoristasService, sem tocar no prisma.motorista direto", () => {
    const src = readFileSync(join(dir, "conferencia-diaria.service.ts"), "utf8");
    const corpo = src.slice(src.indexOf("async aprovarSugestao("), src.indexOf("\n  async recusarSugestao("));
    expect(corpo).toContain("this.motoristas.update(");
    expect(corpo).not.toMatch(/prisma\.motorista\.(update|updateMany)/);
  });

  it("e o serviço de resposta só liga receberConferenciaDiaria=false (nunca aceitaWhatsapp/ativo/status/bloqueadoAte)", () => {
    const src = readFileSync(join(dir, "conferencia-resposta.service.ts"), "utf8");
    expect(src).not.toMatch(/aceitaWhatsapp\s*:\s*false/);
    expect(src).not.toMatch(/bloqueadoAte\s*:/);
    const alcance = readFileSync(join(dir, "conferencia-alcance.service.ts"), "utf8");
    expect(alcance).not.toMatch(/aceitaWhatsapp\s*:\s*(false|true)/);
    expect(alcance).not.toMatch(/bloqueadoAte\s*:/);
    expect(alcance).not.toMatch(/status\s*:\s*"(REJEITADO|PENDENTE)/);
  });
});
