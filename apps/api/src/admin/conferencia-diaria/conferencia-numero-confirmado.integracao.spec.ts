import "reflect-metadata";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissaoGuard } from "../../auth/guards/permissao.guard";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { RESPOSTA_NUMERO_ERRADO } from "../../common/conferencia-resposta";
import { inicioDoDiaData } from "../../common/timezone";
import type { PrismaService } from "../../prisma/prisma.service";
import { MotoristasService } from "../motoristas/motoristas.service";
import { ConferenciaDiariaController } from "./conferencia-diaria.controller";
import { ConferenciaDiariaService, SUPRIMIDA_NAO_CONFIRMADO } from "./conferencia-diaria.service";
import { ConferenciaRespostaService } from "./conferencia-resposta.service";
import { SugestoesGestorService } from "./sugestoes-gestor.service";

/**
 * "Só perguntar a número confirmado" e a resposta "número errado" — Prisma REAL (banco
 * descartável). Só roda com `CONFERENCIA_TESTE_DATABASE_URL` apontando pra um banco novo com as
 * migrations aplicadas; sem a variável, pula. O WhatsApp é SEMPRE mock: nada real sai.
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;

// 28/09/2026 é segunda-feira; 09:00 em São Paulo (hora do job = 9).
const SEGUNDA = new Date("2026-09-28T12:00:00Z");
const DIA = inicioDoDiaData(SEGUNDA);
const SUF = Date.now().toString(36);

describe.skipIf(!URL_TESTE)("conferência diária: número confirmado (Prisma real)", () => {
  let prisma: PrismaService;
  let servico: ConferenciaDiariaService;
  let resposta: ConferenciaRespostaService;
  let motoristasSvc: MotoristasService;
  let contaA: string;
  let contaB: string;
  let admin: string;
  let frotaX: string;
  let n = 0;
  const ids: Record<string, string> = {};

  const envio = {
    disponivel: vi.fn(async (..._a: unknown[]): Promise<{ ok: boolean; motivo?: string }> => ({ ok: true })),
    tentarEnviar: vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({ enviado: true, idExterno: "wamid.MOCK" })),
  };
  const inbox = { disparar: vi.fn(async (..._a: unknown[]) => {}) };

  const fone = () => {
    n += 1;
    return { local: `4299${String(2000000 + n).padStart(7, "0")}`, wa: `55429${String(92000000 + n).padStart(8, "0")}` };
  };
  // 11 dígitos únicos entre execuções (a identidade tem CPF único na base inteira).
  const cpf = () => `9${String(Date.now()).slice(-6)}${String(++n).padStart(4, "0")}`;

  const motorista = (c: string, nome: string, over: Record<string, unknown> = {}) =>
    comConta(c, () =>
      prisma.motorista.create({
        data: {
          nome,
          cpf: cpf(),
          senhaHash: "x",
          telefone: fone().local,
          status: "APROVADO",
          aceite: "ACEITO",
          criadoEm: new Date("2026-01-01T00:00:00Z"),
          ...over,
        } as never,
      }),
    );
  const linhas = (c: string) =>
    comConta(c, () => prisma.conferenciaDiaria.findMany({ where: { dia: DIA }, include: { motorista: { select: { nome: true } } } }));
  const daPessoa = async (c: string, nome: string) => (await linhas(c)).find((l) => l.motorista.nome === nome)!;
  const lerM = (c: string, id: string) => comConta(c, () => prisma.motorista.findUniqueOrThrow({ where: { id } }));
  type Interno = {
    gravarODia(cfg: unknown, c: string, a: Date): Promise<number>;
    enviarPendentes(cfg: unknown, a: Date): Promise<number>;
    calcular(cfg: unknown, a: Date): Promise<{ nome: string; motoristaId: string; deveriaPerguntar: boolean; naoConfirmado: boolean; semCanal: string | null; motivo: string }[]>;
  };
  const cfgDe = (c: string) => comConta(c, () => prisma.configuracaoConferenciaDiaria.findFirstOrThrow());
  /** O que o job faz (gravar o dia, promover confirmados, mandar os pendentes), sem depender do módulo contratado. */
  const rodar = async (c: string) => {
    const i = servico as unknown as Interno;
    const cfg = await cfgDe(c);
    const gravadas = await i.gravarODia(cfg, c, SEGUNDA);
    await servico.promoverConfirmadosDoDia(cfg as never, SEGUNDA);
    await i.enviarPendentes(cfg, SEGUNDA);
    return gravadas;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    const auditoria = new AuditoriaService(prisma);
    const sugestoes = new SugestoesGestorService(prisma, inbox as never);
    motoristasSvc = new MotoristasService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { porCpf: vi.fn(async () => null), definirTelefone: vi.fn() } as never,
      auditoria,
      { agendarRecalculo: vi.fn() } as never,
    );
    servico = new ConferenciaDiariaService(prisma, auditoria, envio as never, sugestoes, motoristasSvc);
    resposta = new ConferenciaRespostaService(prisma, envio as never, auditoria, sugestoes, {
      aoResponder: vi.fn(async () => {}),
    } as never);

    const nova = async (nome: string) =>
      (await comoSistema(() => prisma.conta.create({ data: { nome, slug: `${nome}-${SUF}` } }))).id;
    contaA = await nova("confirmado-ligada");
    contaB = await nova("confirmado-desligada");
    admin = (
      await comConta(contaA, () =>
        prisma.user.create({ data: { nome: "Gestor", email: `gestor-conf-${SUF}@teste.local`, senhaHash: "x" } as never }),
      )
    ).id;
    frotaX = (await comConta(contaA, () => prisma.transportadora.create({ data: { nome: "Frota X" } as never }))).id;

    const base = { ativo: true, modo: "ENVIANDO", horaEnvio: 9, diasConsiderados: [1, 2, 3, 4, 5], intervaloMinimoDias: 3 };
    await comConta(contaA, () => prisma.configuracaoConferenciaDiaria.create({ data: { ...base, soPerguntarNumeroConfirmado: true } as never }));
    await comConta(contaB, () => prisma.configuracaoConferenciaDiaria.create({ data: base as never }));

    // ── Conta com a opção LIGADA: ninguém lançou viagem (a regra mandaria perguntar a todos) ──
    ids["App visto"] = (await motorista(contaA, "App visto", { appVistoEm: new Date("2026-09-20T10:00:00Z") })).id;

    const identidade = await comoSistema(() =>
      prisma.motoristaIdentidade.create({
        data: { cpf: cpf(), nome: "Login", senhaHash: "x", ultimoLoginEm: new Date("2026-09-10T10:00:00Z") } as never,
      }),
    );
    ids["Login"] = (await motorista(contaA, "Login", { identidadeId: identidade.id })).id;

    ids["Respondeu antes"] = (await motorista(contaA, "Respondeu antes")).id;
    await comConta(contaA, () =>
      prisma.conferenciaDiaria.create({
        data: {
          motoristaId: ids["Respondeu antes"]!,
          dia: new Date("2026-09-21T00:00:00Z"),
          estado: "RESPONDIDA",
          motivo: "fixture",
          snapshot: {},
          opcao: "NAO_TIVE",
          respondidaEm: new Date("2026-09-21T12:00:00Z"),
        } as never,
      }),
    );

    const f = fone();
    ids["Sessão"] = (await motorista(contaA, "Sessão", { telefone: f.local })).id;
    await comConta(contaA, () => prisma.whatsappSessao.create({ data: { telefone: f.wa, motoristaId: ids["Sessão"]! } as never }));

    ids["Confirmado pelo gestor"] = (
      await motorista(contaA, "Confirmado pelo gestor", { telefoneConfirmadoEm: new Date("2026-09-25T10:00:00Z"), telefoneConfirmadoPorId: admin })
    ).id;
    ids["Sem sinal 1"] = (await motorista(contaA, "Sem sinal 1", { transportadoraId: frotaX })).id;
    ids["Sem sinal 2"] = (await motorista(contaA, "Sem sinal 2")).id;
    ids["Sem sinal 3"] = (await motorista(contaA, "Sem sinal 3")).id;
    ids["Sem telefone"] = (await motorista(contaA, "Sem telefone", { telefone: null })).id;
    ids["Errado com app"] = (
      await motorista(contaA, "Errado com app", { appVistoEm: new Date("2026-09-20T10:00:00Z"), telefoneErradoEm: new Date("2026-09-26T10:00:00Z") })
    ).id;

    // ── Conta com a opção DESLIGADA (default da coluna): comportamento de sempre ──
    ids["B sem sinal"] = (await motorista(contaB, "B sem sinal")).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });
  beforeEach(() => {
    envio.tentarEnviar.mockClear();
    inbox.disparar.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("default da coluna é false: conta que não ligou não muda", async () => {
    expect((await cfgDe(contaB)).soPerguntarNumeroConfirmado).toBe(false);
    expect((await cfgDe(contaA)).soPerguntarNumeroConfirmado).toBe(true);
  });

  it("opção desligada: o motorista sem nenhum sinal É perguntado, como sempre", async () => {
    await comConta(contaB, () => rodar(contaB));
    const l = await daPessoa(contaB, "B sem sinal");
    expect(l.estado).toBe("ENVIADA");
    expect(l.suprimidaPor).toBeNull();
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);
  });

  it("job ENVIANDO com a opção ligada: só os confirmados recebem; cada sinal confirma; sem sinal fica SUPRIMIDA/NAO_CONFIRMADO", async () => {
    const gravadas = await comConta(contaA, () => rodar(contaA));
    expect(gravadas).toBe(10);
    for (const nome of ["App visto", "Login", "Respondeu antes", "Sessão", "Confirmado pelo gestor"]) {
      expect((await daPessoa(contaA, nome)).estado, nome).toBe("ENVIADA");
    }
    // Nada foi pra Meta além dos 5 confirmados.
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(5);

    for (const nome of ["Sem sinal 1", "Sem sinal 2", "Sem sinal 3"]) {
      const l = await daPessoa(contaA, nome);
      expect(l.estado, nome).toBe("SUPRIMIDA");
      expect(l.suprimidaPor, nome).toBe(SUPRIMIDA_NAO_CONFIRMADO);
      expect(l.wamid).toBeNull();
      expect(l.enviadaEm).toBeNull();
      expect(l.motivo).toMatch(/número ainda não foi confirmado/);
      const snap = l.snapshot as { naoConfirmado: boolean; deveriaPerguntar: boolean; semCanal: unknown; evidencias: unknown };
      expect(snap).toMatchObject({ naoConfirmado: true, deveriaPerguntar: false, semCanal: null });
      expect(snap.evidencias).toBeTruthy();
    }
    // Sem canal continua sendo sem canal (e não "não confirmado").
    expect(await daPessoa(contaA, "Sem telefone")).toMatchObject({ estado: "SUPRIMIDA", suprimidaPor: "SEM_TELEFONE" });
    expect(await daPessoa(contaA, "Errado com app")).toMatchObject({ estado: "SUPRIMIDA", suprimidaPor: "NUMERO_ERRADO" });
  });

  it("lista do dia: grupo 'não confirmado' com telefone mascarado, nunca como 'sem canal'", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SEGUNDA);
    const r = await comConta(contaA, () => servico.listaDoDia());
    const item = (nome: string) => r.itens.find((i) => i.nome === nome)!;
    expect(item("Sem sinal 1")).toMatchObject({ naoConfirmado: true, semMovimento: false, deveriaPerguntar: false, semCanal: null });
    expect(item("Sem sinal 1").telefoneMascarado).toMatch(/^••••-\d{4}$/);
    expect(item("App visto")).toMatchObject({ naoConfirmado: false, deveriaPerguntar: true });
    expect(r.itens.filter((i) => i.naoConfirmado).map((i) => i.nome).sort()).toEqual(["Sem sinal 1", "Sem sinal 2", "Sem sinal 3"]);
    // A marca "sem canal" é só de quem realmente não tem canal.
    expect(r.itens.filter((i) => i.deveriaPerguntar && i.semCanal).map((i) => `${i.nome}:${i.semCanal}`).sort()).toEqual([
      "Errado com app:NUMERO_ERRADO",
      "Sem telefone:SEM_TELEFONE",
    ]);
  });

  it("simular: mesma regra, sem gravar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SEGUNDA);
    const antes = (await linhas(contaA)).length;
    const r = await comConta(contaA, () => servico.simular());
    expect(r.gravado).toBe(false);
    expect(r.regraEmVigor).toContain("Só pergunta a quem tem o número confirmado");
    expect(r.itens.filter((i) => i.naoConfirmado).map((i) => i.nome).sort()).toEqual(["Sem sinal 1", "Sem sinal 2", "Sem sinal 3"]);
    expect((await linhas(contaA)).length).toBe(antes);
  });

  it("calendário e 'sem canal' não são afetados pelo não confirmado", async () => {
    const c = await comConta(contaA, () => servico.calendarioDoMotorista(ids["Sem sinal 2"]!, "2026-09", SEGUNDA));
    expect(c.dias.every((d) => !d.pergunta)).toBe(true);
    expect(c.totais).toMatchObject({ perguntados: 0, semCanal: 0 });
    const lista = await comConta(contaA, () => servico.listarSemCanal());
    expect(lista.map((x) => x.nome)).toEqual(["Errado com app"]);
    expect(lista[0]).toMatchObject({ numeroErrado: true });
  });

  it("reenvio não vale pra quem não foi perguntado por não ter número confirmado (mensagem própria)", async () => {
    await expect(comConta(contaA, () => servico.reenviarPerguntaDeHoje(ids["Sem sinal 2"]!, admin, SEGUNDA))).rejects.toThrow(
      /ainda não foi confirmado/,
    );
    expect(envio.tentarEnviar).not.toHaveBeenCalled();
  });

  it("ficha: o selo diz se está confirmado, por qual sinal e quem confirmou", async () => {
    const sem = await comConta(contaA, () => servico.numeroDoMotorista(ids["Sem sinal 1"]!));
    expect(sem).toMatchObject({ confirmado: false, sinais: [], numeroErrado: false, soPerguntarNumeroConfirmado: true, temTelefone: true });
    const com = await comConta(contaA, () => servico.numeroDoMotorista(ids["Confirmado pelo gestor"]!));
    expect(com.confirmado).toBe(true);
    expect(com.sinais.map((s) => s.sinal)).toEqual(["CONFIRMADO_PELO_ESCRITORIO"]);
    expect(com.telefoneConfirmadoPor).toMatchObject({ id: admin, nome: "Gestor" });
    const login = await comConta(contaA, () => servico.numeroDoMotorista(ids["Login"]!));
    expect(login.sinais.map((s) => s.sinal)).toEqual(["LOGIN_NO_APP"]);
    const errado = await comConta(contaA, () => servico.numeroDoMotorista(ids["Errado com app"]!));
    expect(errado).toMatchObject({ confirmado: false, numeroErrado: true });
  });

  it("o botão de TESTE manual continua funcionando pro não confirmado (decisão do gestor)", async () => {
    const r = await comConta(contaA, () => servico.enviarPerguntaDeTeste(ids["Sem sinal 3"]!, admin, SEGUNDA));
    expect(r.enviado).toBe(true);
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);
    const l = await daPessoa(contaA, "Sem sinal 3");
    expect(l.estado).toBe("ENVIADA");
    expect(l.suprimidaPor).toBeNull();
    // Mas o teste não confirma o número.
    expect((await comConta(contaA, () => servico.numeroDoMotorista(ids["Sem sinal 3"]!))).confirmado).toBe(false);
  });

  it("confirmar em lote: confirma, audita com o usuário, é idempotente; depois de rodar de novo o job envia", async () => {
    const r1 = await comConta(contaA, () => servico.confirmarTelefones([ids["Sem sinal 1"]!, ids["Sem sinal 2"]!], { id: admin }, null, SEGUNDA));
    // A promoção já aconteceu dentro da janela do dia (09:00, hora do job)…
    expect(r1).toEqual({ confirmados: 2, jaConfirmados: 0, semTelefone: 0 });
    const m1 = await lerM(contaA, ids["Sem sinal 1"]!);
    expect(m1.telefoneConfirmadoEm).toBeTruthy();
    expect(m1.telefoneConfirmadoPorId).toBe(admin);
    const audits = await comConta(contaA, () =>
      prisma.auditLog.findMany({ where: { acao: "CONFERENCIA_TELEFONE_CONFIRMADO", entidadeId: { in: [ids["Sem sinal 1"]!, ids["Sem sinal 2"]!] } } }),
    );
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.usuarioId === admin)).toBe(true);
    expect(JSON.stringify(audits[0]!.metadata)).not.toMatch(/\d{9,}/); // telefone só mascarado na auditoria

    // Idempotente: de novo não muda nem duplica auditoria.
    const r2 = await comConta(contaA, () => servico.confirmarTelefones([ids["Sem sinal 1"]!, ids["Sem sinal 2"]!], { id: admin }, null, SEGUNDA));
    expect(r2).toEqual({ confirmados: 0, jaConfirmados: 2, semTelefone: 0 });
    expect(
      await comConta(contaA, () => prisma.auditLog.count({ where: { acao: "CONFERENCIA_TELEFONE_CONFIRMADO", entidadeId: ids["Sem sinal 1"]! } })),
    ).toBe(1);

    // Rodar de novo (o mesmo que a próxima batida do cron): os confirmados recebem, o resto não.
    envio.tentarEnviar.mockClear();
    await comConta(contaA, () => rodar(contaA));
    for (const nome of ["Sem sinal 1", "Sem sinal 2"]) {
      const l = await daPessoa(contaA, nome);
      expect(l.estado, nome).toBe("ENVIADA");
      expect(l.suprimidaPor, nome).toBeNull();
      expect(l.wamid, nome).toBe("wamid.MOCK");
    }
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(2);
  });

  it("depois do horário do envio, a confirmação NÃO manda pergunta velha: a lista passa a dizer que foi confirmado", async () => {
    await comConta(contaA, () =>
      prisma.conferenciaDiaria.updateMany({
        where: { motoristaId: ids["Sem sinal 3"]!, dia: DIA },
        data: { estado: "SUPRIMIDA", suprimidaPor: SUPRIMIDA_NAO_CONFIRMADO, wamid: null, enviadaEm: null, snapshot: { naoConfirmado: true, deveriaPerguntar: false } },
      }),
    );
    // 18:00 em São Paulo: fora da janela (hora do job 9 + tolerância 3).
    const noite = new Date("2026-09-28T21:00:00Z");
    const r = await comConta(contaA, () => servico.confirmarTelefones([ids["Sem sinal 3"]!], { id: admin }, null, noite));
    expect(r.confirmados).toBe(1);
    expect((await daPessoa(contaA, "Sem sinal 3")).estado).toBe("SUPRIMIDA");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SEGUNDA);
    const lista = await comConta(contaA, () => servico.listaDoDia());
    const i = lista.itens.find((x) => x.nome === "Sem sinal 3")!;
    expect(i).toMatchObject({ naoConfirmado: false, deveriaPerguntar: false });
    expect(i.motivo).toMatch(/confirmado depois do horário/);
  });

  it("escopo: motorista de outra frota derruba a chamada inteira com 404, sem confirmar ninguém", async () => {
    const novo = await motorista(contaA, "Fora do escopo");
    const novo2 = await motorista(contaA, "Dentro do escopo", { transportadoraId: frotaX });
    const escopo = { transportadoraIds: [frotaX] };
    await expect(
      comConta(contaA, () => servico.confirmarTelefones([novo2.id, novo.id], { id: admin }, escopo, SEGUNDA)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await lerM(contaA, novo2.id)).telefoneConfirmadoEm).toBeNull();
    expect((await lerM(contaA, novo.id)).telefoneConfirmadoEm).toBeNull();
    // Id que não existe também é 404.
    await expect(
      comConta(contaA, () => servico.confirmarTelefones(["00000000-0000-4000-8000-000000000000"], { id: admin }, null, SEGUNDA)),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Dentro do escopo funciona.
    const ok = await comConta(contaA, () => servico.confirmarTelefones([novo2.id], { id: admin }, escopo, SEGUNDA));
    expect(ok.confirmados).toBe(1);
  });

  it("outra empresa não enxerga nem confirma motorista desta (trava de conta)", async () => {
    await expect(
      comConta(contaB, () => servico.confirmarTelefones([ids["Sem sinal 2"]!], { id: admin }, null, SEGUNDA)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("sem telefone não há o que confirmar: é só contado", async () => {
    const r = await comConta(contaA, () => servico.confirmarTelefones([ids["Sem telefone"]!], { id: admin }, null, SEGUNDA));
    expect(r).toEqual({ confirmados: 0, jaConfirmados: 0, semTelefone: 1 });
    expect((await lerM(contaA, ids["Sem telefone"]!)).telefoneConfirmadoEm).toBeNull();
  });

  it("permissões: ver a ficha exige conferencia-diaria.ver; confirmar exige conferencia-diaria.decidir (403 sem elas)", () => {
    const guard = new PermissaoGuard(new Reflector());
    const ctx = (handler: unknown, permissoes: string[]) =>
      ({
        getHandler: () => handler,
        getClass: () => ConferenciaDiariaController,
        switchToHttp: () => ({ getRequest: () => ({ user: { kind: "ADMIN_USER", permissoes } }) }),
      }) as never;
    const proto = ConferenciaDiariaController.prototype;
    for (const h of [proto.confirmarTelefone, proto.confirmarTelefones]) {
      expect(() => guard.canActivate(ctx(h, ["conferencia-diaria.ver"]))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx(h, []))).toThrow(ForbiddenException);
      expect(guard.canActivate(ctx(h, ["conferencia-diaria.decidir"]))).toBe(true);
    }
    expect(() => guard.canActivate(ctx(proto.numero, []))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx(proto.numero, ["conferencia-diaria.ver"]))).toBe(true);
  });

  // ── "Número errado" ─────────────────────────────────────────────────────

  describe("resposta 'número errado'", () => {
    const comPerguntaEnviada = async (nome: string, over: Record<string, unknown> = {}) => {
      const f = fone();
      const m = await motorista(contaA, nome, { telefone: f.local, ...over });
      await comConta(contaA, () =>
        prisma.conferenciaDiaria.create({
          data: {
            motoristaId: m.id,
            dia: new Date(`2026-09-${String(10 + (n % 15)).padStart(2, "0")}T00:00:00Z`),
            estado: "ENVIADA",
            motivo: "fixture",
            snapshot: {},
            wamid: `wamid.${SUF}.${n}`,
            enviadaEm: new Date(),
          } as never,
        }),
      );
      return { m, wa: f.wa };
    };
    const msg = (from: string, texto: string, id = `m-${++n}`) => ({ id, from, type: "text", text: { body: texto } });
    const sugestoesDe = (id: string) =>
      comConta(contaA, () => prisma.sugestaoGestor.findMany({ where: { motoristaId: id, tipo: "NUMERO_ERRADO" } }));

    it("marca o motorista, abre a sugestão, para de perguntar, avisa o gestor, audita e responde pelo serviço de envio", async () => {
      const { m, wa } = await comPerguntaEnviada("Número errado 1", { telefoneConfirmadoEm: new Date(), telefoneConfirmadoPorId: admin });
      const r = await resposta.tratarMensagem(msg(wa, "Número errado!"));
      expect(r).toEqual({ tratada: true, opcao: "NUMERO_ERRADO", origem: "TEXTO" });

      const depois = await lerM(contaA, m.id);
      expect(depois.telefoneErradoEm).toBeTruthy();
      expect(depois.telefoneConfirmadoEm).toBeNull();
      expect(depois.telefoneConfirmadoPorId).toBeNull();
      expect(depois.telefone).toBe(m.telefone); // não mexe no telefone: quem corrige é o escritório

      const s = await sugestoesDe(m.id);
      expect(s).toHaveLength(1);
      expect(s[0]).toMatchObject({
        status: "ABERTA",
        resumo: `Responderam que este número não é do motorista ${m.nome}. Corrija o telefone no cadastro.`,
      });
      expect(s[0]!.chaveViva).toBe(`${m.id}:NUMERO_ERRADO`);
      expect(inbox.disparar).toHaveBeenCalledTimes(1);

      expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);
      expect(envio.tentarEnviar.mock.calls[0]![0]).toMatchObject({ rota: "RESPOSTA_AGENTE", texto: RESPOSTA_NUMERO_ERRADO });
      expect(RESPOSTA_NUMERO_ERRADO).toBe("Desculpe o engano! Vamos avisar a empresa para corrigir o cadastro.");

      const audit = await comConta(contaA, () => prisma.auditLog.findMany({ where: { entidadeId: m.id, acao: "CONFERENCIA_NUMERO_ERRADO" } }));
      expect(audit).toHaveLength(1);
      const linha = await comConta(contaA, () => prisma.conferenciaDiaria.findFirstOrThrow({ where: { motoristaId: m.id } }));
      expect(JSON.stringify(linha.trilha)).toContain("NUMERO_ERRADO");
      // A linha NÃO vira respondida: o que esse desconhecido disse não confirma número nenhum.
      expect(linha.estado).toBe("ENVIADA");
      expect(linha.respondidaEm).toBeNull();

      // Agora é "sem canal" com motivo NUMERO_ERRADO, mesmo que tenha o app (sinais anulados).
      const itens = await (servico as unknown as Interno).calcular(await cfgDe(contaA), SEGUNDA);
      expect(itens.find((i) => i.motoristaId === m.id)).toMatchObject({ semCanal: "NUMERO_ERRADO", naoConfirmado: false });
      const lista = await comConta(contaA, () => servico.listarSemCanal());
      expect(lista.find((x) => x.motoristaId === m.id)).toMatchObject({ numeroErrado: true });
    });

    it("a mesma mensagem entregue duas vezes não repete aviso nem resposta", async () => {
      const { m, wa } = await comPerguntaEnviada("Número errado 2");
      await resposta.tratarMensagem(msg(wa, "engano", "dup-1"));
      envio.tentarEnviar.mockClear();
      inbox.disparar.mockClear();
      const r = await resposta.tratarMensagem(msg(wa, "engano", "dup-1"));
      expect(r.tratada).toBe(true);
      expect(envio.tentarEnviar).not.toHaveBeenCalled();
      expect(inbox.disparar).not.toHaveBeenCalled();
      expect(await sugestoesDe(m.id)).toHaveLength(1);
      expect(await comConta(contaA, () => prisma.auditLog.count({ where: { entidadeId: m.id, acao: "CONFERENCIA_NUMERO_ERRADO" } }))).toBe(1);
    });

    it("sem pergunta pendente pra esse telefone NÃO é nosso: nada é marcado nem respondido", async () => {
      const f = fone();
      const m = await motorista(contaA, "Sem pergunta", { telefone: f.local });
      const r = await resposta.tratarMensagem(msg(f.wa, "não sou eu"));
      expect(r.tratada).toBe(false);
      expect((await lerM(contaA, m.id)).telefoneErradoEm).toBeNull();
      expect(envio.tentarEnviar).not.toHaveBeenCalled();
      // Número que nem é de motorista nosso: segue pro atendimento.
      expect((await resposta.tratarMensagem(msg("5542999000000", "engano"))).tratada).toBe(false);
    });

    it("frase fora da tabela exata não marca ninguém (ambígua segue o caminho de sempre)", async () => {
      const { m, wa } = await comPerguntaEnviada("Número errado 3");
      await resposta.tratarMensagem(msg(wa, "não sou eu que dirijo hoje"));
      expect((await lerM(contaA, m.id)).telefoneErradoEm).toBeNull();
      expect(await sugestoesDe(m.id)).toHaveLength(0);
    });

    it("respostaJaTratada (anti-duplicata do Chatwoot/agente) cobre a frase enquanto há pergunta pendente", async () => {
      const { wa } = await comPerguntaEnviada("Número errado 4");
      expect(await resposta.respostaJaTratada(wa, "Número errado")).toBe(true);
      expect(await resposta.respostaJaTratada(wa, "não sou eu que dirijo hoje")).toBe(false);
      const solto = fone();
      await motorista(contaA, "Número errado 5", { telefone: solto.local });
      expect(await resposta.respostaJaTratada(solto.wa, "número errado")).toBe(false);
    });

    it("corrigir o telefone no cadastro limpa tudo e fecha a sugestão como RESOLVIDA_SOZINHA", async () => {
      const { m, wa } = await comPerguntaEnviada("Número errado 6", { telefoneConfirmadoEm: new Date() });
      await resposta.tratarMensagem(msg(wa, "não conheço"));
      expect((await lerM(contaA, m.id)).telefoneErradoEm).toBeTruthy();

      // Editar OUTRA coisa, ou salvar o MESMO telefone formatado, não limpa nada.
      await comConta(contaA, () => motoristasSvc.update(m.id, { nome: "Outro nome" } as never, null, admin));
      const mascarado = m.telefone!.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
      await comConta(contaA, () => motoristasSvc.update(m.id, { telefone: mascarado } as never, null, admin));
      expect((await lerM(contaA, m.id)).telefoneErradoEm).toBeTruthy();
      expect((await sugestoesDe(m.id))[0]!.status).toBe("ABERTA");

      // Telefone DIFERENTE: zera marca e confirmação e resolve a sugestão.
      await comConta(contaA, () => motoristasSvc.update(m.id, { telefone: "42988887777" } as never, null, admin));
      const depois = await lerM(contaA, m.id);
      expect(depois).toMatchObject({ telefoneErradoEm: null, telefoneConfirmadoEm: null, telefoneConfirmadoPorId: null, telefone: "42988887777" });
      const s = (await sugestoesDe(m.id))[0]!;
      expect(s.status).toBe("RESOLVIDA_SOZINHA");
      expect(s.chaveViva).toBeNull();
      expect(s.motivoDecisao).toMatch(/corrigido/);

      // O número novo recomeça do zero: sem sinal, com a opção ligada, não é perguntado.
      const itens = await (servico as unknown as Interno).calcular(await cfgDe(contaA), SEGUNDA);
      expect(itens.find((i) => i.motoristaId === m.id)).toMatchObject({ semCanal: null, naoConfirmado: true });
    });

    it("apagar o telefone (null) também zera o que se sabia do número", async () => {
      const { m, wa } = await comPerguntaEnviada("Número errado 7", { telefoneConfirmadoEm: new Date() });
      await resposta.tratarMensagem(msg(wa, "esse número não é do motorista"));
      await comConta(contaA, () => motoristasSvc.update(m.id, { telefone: null } as never, null, admin));
      expect(await lerM(contaA, m.id)).toMatchObject({ telefone: null, telefoneErradoEm: null, telefoneConfirmadoEm: null });
    });

    it("o gestor confirmar um número marcado como errado vale (decisão dele) e fecha a sugestão", async () => {
      const { m, wa } = await comPerguntaEnviada("Número errado 8");
      await resposta.tratarMensagem(msg(wa, "engano"));
      const r = await comConta(contaA, () => servico.confirmarTelefones([m.id], { id: admin }, null, SEGUNDA));
      expect(r.confirmados).toBe(1);
      expect(await lerM(contaA, m.id)).toMatchObject({ telefoneErradoEm: null, telefoneConfirmadoPorId: admin });
      expect((await sugestoesDe(m.id))[0]!.status).toBe("RESOLVIDA_SOZINHA");
    });
  });
});
