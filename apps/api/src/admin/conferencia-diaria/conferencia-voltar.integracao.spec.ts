import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { RESPOSTA_VOLTAR, RESPOSTA_VOLTAR_EMPRESA_DESLIGOU } from "../../common/conferencia-resposta";
import { inicioDoDiaData } from "../../common/timezone";
import type { PrismaService } from "../../prisma/prisma.service";
import { ConferenciaRespostaService } from "./conferencia-resposta.service";
import { SugestoesGestorService } from "./sugestoes-gestor.service";

/**
 * "Voltar" por WhatsApp — Prisma REAL (banco descartável). Só roda com
 * `CONFERENCIA_TESTE_DATABASE_URL` apontando pra um banco novo com as migrations
 * aplicadas. Meta mockada: nenhuma mensagem real sai.
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;
const HOJE = inicioDoDiaData(new Date("2026-09-29T12:00:00Z"));
const SUF = Date.now().toString(36);

describe.skipIf(!URL_TESTE)("conferência diária — VOLTAR (Prisma real)", () => {
  let prisma: PrismaService;
  let contaA: string;
  let contaB: string;
  let resposta: ConferenciaRespostaService;
  let n = 0;

  const envio = { tentarEnviar: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ enviado: true })) };
  const inbox = { disparar: vi.fn(async (..._a: unknown[]) => {}) };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    const auditoria = new AuditoriaService(prisma);
    const sugestoes = new SugestoesGestorService(prisma, inbox as never);
    resposta = new ConferenciaRespostaService(
      prisma,
      envio as never,
      auditoria,
      sugestoes,
      { aoResponder: vi.fn(async () => {}) } as never,
    );
    const nova = async (nome: string) =>
      (await comoSistema(() => prisma.conta.create({ data: { nome, slug: `${nome}-${SUF}` } }))).id;
    contaA = await nova("voltar-a");
    contaB = await nova("voltar-b");
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    envio.tentarEnviar.mockClear();
    inbox.disparar.mockClear();
  });

  /** Telefone novo por teste: a busca é por telefone em TODAS as contas. */
  const novoFone = () => {
    n += 1;
    return { local: `4299${String(1000000 + n).padStart(7, "0")}`, wa: `55429${String(91000000 + n).padStart(8, "0")}` };
  };

  async function vinculo(
    contaId: string,
    fone: string,
    over: Record<string, unknown> = {},
    cpf = `9${String(n).padStart(10, "0")}`,
  ) {
    return comConta(contaId, () =>
      prisma.motorista.create({
        data: { nome: `Tião ${n}`, cpf, senhaHash: "x", telefone: fone, ...over } as never,
      }),
    );
  }
  const desligadoPeloMotorista = { receberConferenciaDiaria: false, conferenciaDesligadaOrigem: "MOTORISTA", conferenciaDesligadaEm: new Date() };
  const lerM = (contaId: string, id: string) =>
    comConta(contaId, () => prisma.motorista.findUniqueOrThrow({ where: { id } }));
  const audits = (id: string) =>
    comoSistema(() =>
      prisma.auditLog.findMany({ where: { entidade: "Motorista", entidadeId: id, acao: "CONFERENCIA_MOTORISTA_RELIGADA" } }),
    );
  const texto = (from: string, body: string, id = `wamid.${Math.random()}`) => ({ id, from, type: "text", text: { body } });

  it("motorista em 2 empresas que tocou Parar: 'voltar' religa as duas, avisa cada empresa, audita e responde", async () => {
    const f = novoFone();
    const cpf = `8${String(n).padStart(10, "0")}`;
    const a = await vinculo(contaA, f.local, desligadoPeloMotorista, cpf);
    const b = await vinculo(contaB, f.local, desligadoPeloMotorista, cpf);
    // a sugestão aberta pelo "Parar" em cada empresa
    for (const [c, m] of [[contaA, a.id], [contaB, b.id]] as const) {
      await comConta(c, () =>
        prisma.sugestaoGestor.create({
          data: { tipo: "MOTORISTA_PAROU_WHATSAPP", motoristaId: m, resumo: "parou", evidencia: {}, chaveViva: `${m}:MOTORISTA_PAROU_WHATSAPP` } as never,
        }),
      );
    }

    const r = await resposta.tratarMensagem(texto(f.wa, "Voltar!"));
    expect(r).toEqual({ tratada: true, opcao: "VOLTAR", origem: "TEXTO" });

    for (const [c, m] of [[contaA, a.id], [contaB, b.id]] as const) {
      const x = await lerM(c, m);
      expect(x).toMatchObject({
        receberConferenciaDiaria: true,
        conferenciaDesligadaEm: null,
        conferenciaDesligadaOrigem: null,
        conferenciaDesligadaPorId: null,
        conferenciaDesligadaMotivo: null,
      });
      const au = await audits(m);
      expect(au).toHaveLength(1);
      expect(au[0]).toMatchObject({ usuarioId: null, contaId: c, valorAntes: false, valorDepois: true });
      expect(au[0]!.metadata).toMatchObject({ origem: "motorista via WhatsApp" });
      const sug = await comConta(c, () => prisma.sugestaoGestor.findFirstOrThrow({ where: { motoristaId: m } }));
      expect(sug.status).toBe("RESOLVIDA_SOZINHA");
    }
    expect(inbox.disparar).toHaveBeenCalledTimes(2); // uma por empresa
    expect(envio.tentarEnviar).toHaveBeenCalledTimes(1);
    expect(envio.tentarEnviar.mock.calls[0]![0]).toMatchObject({ rota: "RESPOSTA_AGENTE", texto: RESPOSTA_VOLTAR });
  });

  it("idempotente: a mesma mensagem entregue de novo não repete auditoria, sino nem resposta (e segue 'nossa')", async () => {
    const f = novoFone();
    const m = await vinculo(contaA, f.local, desligadoPeloMotorista);
    await resposta.tratarMensagem(texto(f.wa, "voltar"));
    envio.tentarEnviar.mockClear();
    inbox.disparar.mockClear();

    const r2 = await resposta.tratarMensagem(texto(f.wa, "voltar"));
    expect(r2).toEqual({ tratada: true, opcao: "VOLTAR", origem: "TEXTO" });
    expect(await audits(m.id)).toHaveLength(1);
    expect(inbox.disparar).not.toHaveBeenCalled();
    expect(envio.tentarEnviar).not.toHaveBeenCalled();
  });

  it("tudo ligado e sem religação recente: nada acontece e não é 'nossa' (o atendimento responde)", async () => {
    const f = novoFone();
    const m = await vinculo(contaA, f.local);
    const r = await resposta.tratarMensagem(texto(f.wa, "voltar"));
    expect(r).toMatchObject({ tratada: false });
    expect(await audits(m.id)).toHaveLength(0);
    expect(envio.tentarEnviar).not.toHaveBeenCalled();
    expect(await resposta.respostaJaTratada(f.wa, "voltar")).toBe(false);
  });

  it("vínculo desligado pelo PAINEL não é religado: ele é avisado, sem promessa", async () => {
    const f = novoFone();
    const m = await vinculo(contaA, f.local, {
      receberConferenciaDiaria: false,
      conferenciaDesligadaOrigem: "PAINEL",
      conferenciaDesligadaMotivo: "decisão do escritório",
      conferenciaDesligadaEm: new Date(),
    });
    const r = await resposta.tratarMensagem(texto(f.wa, "quero voltar"));
    expect(r).toEqual({ tratada: true, opcao: "VOLTAR", origem: "TEXTO" });
    const x = await lerM(contaA, m.id);
    expect(x).toMatchObject({
      receberConferenciaDiaria: false,
      conferenciaDesligadaOrigem: "PAINEL",
      conferenciaDesligadaMotivo: "decisão do escritório",
    });
    expect(await audits(m.id)).toHaveLength(0);
    expect(inbox.disparar).not.toHaveBeenCalled();
    expect(envio.tentarEnviar.mock.calls[0]![0]).toMatchObject({ texto: RESPOSTA_VOLTAR_EMPRESA_DESLIGOU });
  });

  it("misto: religa o do motorista e deixa o do painel, dizendo qual empresa precisa liberar", async () => {
    const f = novoFone();
    const cpf = `7${String(n).padStart(10, "0")}`;
    const a = await vinculo(contaA, f.local, desligadoPeloMotorista, cpf);
    const b = await vinculo(contaB, f.local, { receberConferenciaDiaria: false, conferenciaDesligadaOrigem: "PAINEL" }, cpf);
    await resposta.tratarMensagem(texto(f.wa, "retomar"));
    expect((await lerM(contaA, a.id)).receberConferenciaDiaria).toBe(true);
    expect((await lerM(contaB, b.id)).receberConferenciaDiaria).toBe(false);
    const enviado = (envio.tentarEnviar.mock.calls[0]![0] as { texto: string }).texto;
    expect(enviado).toContain(RESPOSTA_VOLTAR);
    expect(enviado).toContain("voltar-b");
    expect(inbox.disparar).toHaveBeenCalledTimes(1);
  });

  it("linha antiga (origem nula) conta como do motorista", async () => {
    const f = novoFone();
    const m = await vinculo(contaA, f.local, { receberConferenciaDiaria: false });
    await resposta.tratarMensagem(texto(f.wa, "voltar a receber"));
    expect((await lerM(contaA, m.id)).receberConferenciaDiaria).toBe(true);
  });

  it("número com/sem o nono dígito e com/sem DDI acha o mesmo motorista", async () => {
    const f = novoFone(); // cadastro com 9: 42 9 XXXX XXXX
    const m = await vinculo(contaA, f.local, desligadoPeloMotorista);
    const semNove = `55${f.local.slice(0, 2)}${f.local.slice(3)}`; // a Meta entrega sem o 9
    expect(semNove).toHaveLength(12);
    await resposta.tratarMensagem(texto(semNove, "voltar"));
    expect((await lerM(contaA, m.id)).receberConferenciaDiaria).toBe(true);
  });

  it("remetente desconhecido: ignorado, sem efeito algum", async () => {
    const f = novoFone();
    const r = await resposta.tratarMensagem(texto(f.wa, "voltar"));
    expect(r).toMatchObject({ tratada: false });
    expect(envio.tentarEnviar).not.toHaveBeenCalled();
    expect(inbox.disparar).not.toHaveBeenCalled();
    expect(await resposta.respostaJaTratada(f.wa, "voltar")).toBe(false);
  });

  it("frase parecida NÃO religa ('não quero voltar', 'voltar amanhã com a carga')", async () => {
    const f = novoFone();
    const m = await vinculo(contaA, f.local, desligadoPeloMotorista);
    for (const t of ["não quero voltar", "voltar amanhã com a carga", "vou voltar pro posto"]) {
      await resposta.tratarMensagem(texto(f.wa, t));
    }
    expect((await lerM(contaA, m.id)).receberConferenciaDiaria).toBe(false);
    expect(await audits(m.id)).toHaveLength(0);
    expect(envio.tentarEnviar).not.toHaveBeenCalled();
    expect(await resposta.respostaJaTratada(f.wa, "voltar amanhã com a carga")).toBe(false);
  });

  it("registra na trilha da última conferência do motorista", async () => {
    const f = novoFone();
    const m = await vinculo(contaA, f.local, desligadoPeloMotorista);
    const linha = await comConta(contaA, () =>
      prisma.conferenciaDiaria.create({
        data: { motoristaId: m.id, dia: HOJE, estado: "RESPONDIDA", opcao: "PARAR", motivo: "t", snapshot: {} } as never,
      }),
    );
    await resposta.tratarMensagem(texto(f.wa, "voltar"));
    const l = await comConta(contaA, () => prisma.conferenciaDiaria.findUniqueOrThrow({ where: { id: linha.id } }));
    const t = l.trilha as { evento: string; detalhe: Record<string, unknown> }[];
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ evento: "TOQUE", detalhe: { opcao: "VOLTAR", origem: "TEXTO" } });
    expect(l.estado).toBe("RESPONDIDA"); // a linha em si não muda
  });

  it("respostaJaTratada: 'voltar' é nosso enquanto há vínculo desligado e logo depois de religar; depois de um tempo, não", async () => {
    const f = novoFone();
    const m = await vinculo(contaA, f.local, desligadoPeloMotorista);
    // o Chatwoot chegou ANTES do webhook: ainda desligado
    expect(await resposta.respostaJaTratada(f.wa, "voltar")).toBe(true);
    await resposta.tratarMensagem(texto(f.wa, "voltar"));
    // o webhook chegou primeiro: religou há instantes
    expect(await resposta.respostaJaTratada(f.wa, "VOLTAR.")).toBe(true);
    // conversa normal continua com o agente
    expect(await resposta.respostaJaTratada(f.wa, "voltar pro posto")).toBe(false);
    // passada a janela, 'voltar' volta a ser conversa normal
    await comoSistema(() =>
      prisma.auditLog.updateMany({
        where: { entidadeId: m.id, acao: "CONFERENCIA_MOTORISTA_RELIGADA" },
        data: { criadoEm: new Date(Date.now() - 3_600_000) },
      }),
    );
    expect(await resposta.respostaJaTratada(f.wa, "voltar")).toBe(false);
  });
});
