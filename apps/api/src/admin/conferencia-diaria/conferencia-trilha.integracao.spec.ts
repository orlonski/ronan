import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { PERMISSAO_KEY } from "../../auth/decorators/requer-permissao.decorator";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { inicioDoDiaData } from "../../common/timezone";
import type { PrismaService } from "../../prisma/prisma.service";
import { ConferenciaDiariaController } from "./conferencia-diaria.controller";
import { PADRAO_MAX_REENVIOS_POR_PERGUNTA } from "@ronan/shared-types";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";
import { ConferenciaRespostaService } from "./conferencia-resposta.service";

/**
 * Integração com Prisma REAL (banco descartável). Só roda com
 * `CONFERENCIA_TESTE_DATABASE_URL` apontando pra um banco novo com as migrations
 * aplicadas (`prisma migrate deploy`):
 *
 *   CONFERENCIA_TESTE_DATABASE_URL=postgresql://…/banco_tmp pnpm exec vitest run conferencia-trilha.integracao
 *
 * Sem a variável, pula — a suíte normal não depende de banco.
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;

const AGORA = new Date("2026-09-29T12:00:00Z"); // 09:00 em São Paulo
const HOJE = inicioDoDiaData(AGORA);
const FONE = "5542991088125";
const SUF = Date.now().toString(36);

describe.skipIf(!URL_TESTE)("conferência diária — Prisma real", () => {
  let prisma: PrismaService;
  let contaA: string;
  let contaB: string;
  let motoristaA: string;
  let motoristaB: string;
  let admin: string;
  let n = 0;

  const envio = {
    disponivel: vi.fn(async () => ({ ok: true })),
    tentarEnviar: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ enviado: true, idExterno: "wamid.PADRAO" })),
  };
  const sugestoes = { abrir: vi.fn(async () => ({ id: "s", criada: true })), notificar: vi.fn(async () => {}), manter: vi.fn() };
  let servico: ConferenciaDiariaService;
  let resposta: ConferenciaRespostaService;
  let cfg: Awaited<ReturnType<ConferenciaDiariaService["config"]>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    const auditoria = new AuditoriaService(prisma);
    servico = new ConferenciaDiariaService(prisma, auditoria, envio as never, sugestoes as never, {} as never);
    resposta = new ConferenciaRespostaService(
      prisma,
      envio as never,
      auditoria,
      sugestoes as never,
      { aoResponder: vi.fn(async () => {}) } as never,
    );
    const nova = async (nome: string) =>
      (await comoSistema(() => prisma.conta.create({ data: { nome, slug: `${nome}-${SUF}` } }))).id;
    contaA = await nova("conf-a");
    contaB = await nova("conf-b");
    const mot = (contaId: string, cpf: string) =>
      comConta(contaId, () =>
        prisma.motorista.create({ data: { nome: "Tião", cpf, senhaHash: "x", telefone: "42991088125" } as never }),
      ).then((m) => m.id);
    motoristaA = await mot(contaA, "11111111111");
    motoristaB = await mot(contaB, "22222222222");
    admin = (
      await comConta(contaA, () =>
        prisma.user.create({ data: { nome: "Gestor", email: `gestor-${SUF}@teste.local`, senhaHash: "x" } as never }),
      )
    ).id;
    cfg = await comConta(contaA, async () => {
      await prisma.configuracaoConferenciaDiaria.upsert({
        where: { contaId: contaA },
        update: {},
        create: {},
      });
      return prisma.configuracaoConferenciaDiaria.update({
        where: { contaId: contaA },
        data: { ativo: true, modo: "ENVIANDO", horaEnvio: 9 },
      });
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Uma linha de HOJE. (contaId, motorista, dia) é único: cada teste usa um motorista novo. */
  async function novaLinha(over: Record<string, unknown> = {}) {
    const m = await comConta(contaA, () =>
      prisma.motorista.create({
        data: { nome: `Tião ${++n}`, cpf: `3000000${String(n).padStart(4, "0")}`, senhaHash: "x", telefone: "42991088125" } as never,
      }),
    );
    const l = await comConta(contaA, () =>
      prisma.conferenciaDiaria.create({
        data: {
          motoristaId: m.id,
          dia: HOJE,
          estado: "PENDENTE",
          motivo: "teste",
          snapshot: { evidencias: { diasEsperadosVerificados: ["2026-09-28"] } },
          ...over,
        } as never,
      }),
    );
    return { linha: l, motoristaId: m.id };
  }
  const ler = (id: string) => comConta(contaA, () => prisma.conferenciaDiaria.findUniqueOrThrow({ where: { id } }));
  const toque = (id: string, opcao: string, ctx?: string, from = FONE) => ({
    id: `wamid.TOQUE.${Math.random()}`,
    from,
    type: "button",
    button: { payload: `cv:${id}:${opcao}`, text: "x" },
    ...(ctx ? { context: { id: ctx } } : {}),
  });
  const eventos = (t: unknown) => (t as { evento: string; detalhe: Record<string, unknown> }[]).map((e) => e.evento);

  it("envio -> toque -> RESPONDIDA, mesmo se o update pós-envio for atrasado de propósito", async () => {
    const { linha } = await novaLinha();
    let liberar!: (v: unknown) => void;
    envio.tentarEnviar.mockImplementationOnce(() => new Promise((r) => (liberar = r)));

    // O job começa a enviar e fica preso na Meta…
    const job = comConta(contaA, () => servico.enviarPendentes(cfg as never, AGORA));
    await vi.waitFor(() => expect(liberar).toBeTypeOf("function"));

    // …a mensagem já chegou no celular e o motorista toca "Não tive".
    const r = await resposta.tratarMensagem(toque(linha.id, "NAO_TIVE", "wamid.CHEGOU"));
    expect(r).toEqual({ tratada: true, opcao: "NAO_TIVE", origem: "BOTAO" });
    expect((await ler(linha.id)).estado).toBe("RESPONDIDA");

    // Só agora a Meta responde e o job tenta gravar "ENVIADA".
    liberar({ enviado: true, idExterno: "wamid.CHEGOU" });
    await job;

    const final = await ler(linha.id);
    expect(final.estado).toBe("RESPONDIDA"); // não foi rebaixada
    expect(final.opcao).toBe("NAO_TIVE");
    expect(final.wamid).toBe("wamid.CHEGOU"); // e o wamid que faltava foi guardado
    expect(eventos(final.trilha)).toEqual(["TOQUE", "RESPOSTA_GRAVADA", "ENVIO"]);
    const envioEv = (final.trilha as { detalhe: Record<string, unknown> }[])[2]!;
    expect(envioEv.detalhe).toMatchObject({ enviado: true, count: 0, wamid: "wamid.CHEGOU" });
  });

  it("toque com a linha ainda PENDENTE é aceito (payload + telefone); de outro número é ignorado e registrado", async () => {
    const { linha } = await novaLinha();
    const estranho = await resposta.tratarMensagem(toque(linha.id, "NAO_TIVE", undefined, "5511999990000"));
    expect(estranho).toEqual({ tratada: false, motivo: "remetente não confere" });
    let l = await ler(linha.id);
    expect(l.estado).toBe("PENDENTE");
    expect(eventos(l.trilha)).toEqual(["TOQUE", "IGNORADO"]);
    expect((l.trilha as { detalhe: Record<string, unknown> }[])[1]!.detalhe.motivo).toBe("remetente não confere");

    await resposta.tratarMensagem(toque(linha.id, "TIVE_NAO_LANCEI"));
    l = await ler(linha.id);
    expect(l.estado).toBe("RESPONDIDA");
    expect(l.opcao).toBe("TIVE_NAO_LANCEI");
    expect(l.respondidaEm).not.toBeNull();
  });

  it("o update pós-envio normal continua funcionando (PENDENTE -> ENVIADA com wamid) e a trilha registra o ENVIO", async () => {
    const { linha } = await novaLinha();
    envio.tentarEnviar.mockResolvedValueOnce({ enviado: true, idExterno: "wamid.NORMAL" });
    await comConta(contaA, () => servico.enviarPendentes(cfg as never, AGORA));
    const l = await ler(linha.id);
    expect(l).toMatchObject({ estado: "ENVIADA", wamid: "wamid.NORMAL" });
    expect(eventos(l.trilha)).toEqual(["ENVIO"]);
  });

  it("reenviar ponta a ponta: RESPONDIDA -> PENDENTE -> ENVIADA com novo wamid, trilha preservada, auditoria", async () => {
    const { linha, motoristaId } = await novaLinha({
      estado: "RESPONDIDA",
      opcao: "NAO_TIVE",
      wamid: "wamid.VELHO",
      enviadaEm: new Date("2026-09-29T12:00:00Z"),
      respondidaEm: new Date("2026-09-29T12:01:00Z"),
      respostaTexto: "Não tive",
      lembreteWamid: "wamid.LEMB",
      lembreteEnviadoEm: new Date("2026-09-29T16:00:00Z"),
      trilha: [{ em: "2026-09-29T12:01:00.000Z", evento: "TOQUE", detalhe: { opcao: "NAO_TIVE" } }],
    });
    envio.tentarEnviar.mockResolvedValueOnce({ enviado: true, idExterno: "wamid.NOVO" });
    const r = await comConta(contaA, () => servico.reenviarPerguntaDeHoje(motoristaId, admin, AGORA));
    expect(r).toMatchObject({ enviado: true, estado: "ENVIADA", reenvios: 1, erro: null });

    const l = await ler(linha.id);
    expect(l).toMatchObject({
      estado: "ENVIADA",
      opcao: null,
      respondidaEm: null,
      respostaTexto: null,
      wamid: "wamid.NOVO",
      lembreteWamid: null,
      lembreteEnviadoEm: null,
      reenvios: 1,
    });
    expect(l.enviadaEm).not.toBeNull();
    // Histórico mantido: o TOQUE antigo continua, e o REENVIO guarda como a linha estava.
    expect(eventos(l.trilha)).toEqual(["TOQUE", "REENVIO", "ENVIO"]);
    const reenvio = (l.trilha as { detalhe: Record<string, any> }[])[1]!.detalhe;
    expect(reenvio).toMatchObject({ pedidoPor: admin, antes: { estado: "RESPONDIDA", opcao: "NAO_TIVE", wamid: "wamid.VELHO" } });

    const aud = await prisma.auditLog.findMany({ where: { entidade: "ConferenciaDiaria", entidadeId: linha.id } });
    expect(aud.map((a) => a.acao)).toEqual(["CONFERENCIA_PERGUNTA_REENVIADA"]);
    expect(aud[0]!.usuarioId).toBe(admin);

    // Toque na mensagem ANTIGA já não vale; na nova, vale.
    expect((await resposta.tratarMensagem(toque(linha.id, "NAO_TIVE", "wamid.VELHO"))).tratada).toBe(false);
    expect((await resposta.tratarMensagem(toque(linha.id, "NAO_TIVE", "wamid.NOVO"))).tratada).toBe(true);
    expect((await ler(linha.id)).estado).toBe("RESPONDIDA");
  });

  it("a Meta recusa o reenvio: FALHOU com o motivo", async () => {
    const { linha, motoristaId } = await novaLinha({ estado: "ENVIADA", wamid: "wamid.X", enviadaEm: AGORA });
    envio.tentarEnviar.mockResolvedValueOnce({ enviado: false, erro: { tipo: "POLITICA", codigo: "META_131026", detalhe: "não entregue" } });
    const r = await comConta(contaA, () => servico.reenviarPerguntaDeHoje(motoristaId, admin, AGORA));
    expect(r).toMatchObject({ enviado: false, estado: "FALHOU", erro: "META_131026: não entregue" });
    expect((await ler(linha.id)).estado).toBe("FALHOU");
  });

  it("limite por linha, SUPRIMIDA/SOMBRA e sem linha de hoje", async () => {
    const { motoristaId } = await novaLinha({ estado: "ENVIADA", wamid: "w", enviadaEm: AGORA });
    for (let i = 0; i < PADRAO_MAX_REENVIOS_POR_PERGUNTA; i++) {
      envio.tentarEnviar.mockResolvedValueOnce({ enviado: true, idExterno: `wamid.R${i}` });
      await comConta(contaA, () => servico.reenviarPerguntaDeHoje(motoristaId, admin, AGORA));
    }
    await expect(comConta(contaA, () => servico.reenviarPerguntaDeHoje(motoristaId, admin, AGORA))).rejects.toBeInstanceOf(ConflictException);

    for (const estado of ["SUPRIMIDA", "SOMBRA"]) {
      const s = await novaLinha({ estado });
      await expect(comConta(contaA, () => servico.reenviarPerguntaDeHoje(s.motoristaId, admin, AGORA))).rejects.toBeInstanceOf(ConflictException);
    }
    await expect(comConta(contaA, () => servico.reenviarPerguntaDeHoje(motoristaA, admin, AGORA))).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("controller: permissão, módulo e escopo", () => {
    const motoristasStub = {
      // Mesmo contrato do MotoristasService.findOne: fora do escopo/conta = 404.
      findOne: async (id: string) => {
        const m = await prisma.motorista.findFirst({ where: { id } });
        if (!m) throw new NotFoundException("Motorista não encontrado");
        return m;
      },
    };
    const ctrl = () => new ConferenciaDiariaController(servico, {} as never, motoristasStub as never);

    it("declara @RequerPermissao('conferencia-diaria.decidir') (é dela que o ModuloGuard deriva o módulo)", () => {
      expect(Reflect.getMetadata(PERMISSAO_KEY, ConferenciaDiariaController.prototype.reenviarPergunta)).toEqual([
        "conferencia-diaria.decidir",
      ]);
    });

    it("motorista de OUTRA empresa = 404 e nada é enviado", async () => {
      envio.tentarEnviar.mockClear();
      await expect(
        comConta(contaA, () => ctrl().reenviarPergunta(motoristaB, { id: "u1", escopo: null } as never)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(envio.tentarEnviar).not.toHaveBeenCalled();
    });

    it("o calendário só devolve 'dados técnicos' a quem tem conferencia-diaria.decidir", async () => {
      const { motoristaId } = await novaLinha({ estado: "ENVIADA", wamid: "wamid.Z", enviadaEm: AGORA });
      const ver = { id: "u1", escopo: null, permissoes: ["conferencia-diaria.ver"] } as never;
      const decidir = { id: "u2", escopo: null, permissoes: ["conferencia-diaria.ver", "conferencia-diaria.decidir"] } as never;
      const dia = (c: Awaited<ReturnType<ConferenciaDiariaController["calendario"]>>) =>
        c.dias.find((d) => d.pergunta)!.pergunta!;
      const semPerm = await comConta(contaA, () => ctrl().calendario(motoristaId, { mes: "2026-09" }, ver));
      const comPerm = await comConta(contaA, () => ctrl().calendario(motoristaId, { mes: "2026-09" }, decidir));
      expect(dia(semPerm)).not.toHaveProperty("tecnico");
      expect(dia(comPerm).tecnico).toMatchObject({ estado: "ENVIADA", wamid: "wamid.Z" });
    });
  });
});
