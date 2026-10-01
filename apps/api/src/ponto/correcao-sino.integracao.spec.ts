import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { comConta, comoSistema } from "../common/conta/conta-context";
import type { PrismaService } from "../prisma/prisma.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import type { AuthFuncionario } from "../auth/types";
import { PontoService } from "./ponto.service";
import { PontoAdminService } from "./ponto-admin.service";

/**
 * Integração com Prisma REAL (banco descartável). O pedido de correção feito
 * pelo app tem que (a) aparecer na lista de "Hoje" do próprio app e (b) chegar
 * no sininho só de quem decide correção. Os dois faltavam: o pedido só existia
 * no espelho do mês, e o escritório só via se abrisse "Acerto de ponto".
 * Só roda com `CONFERENCIA_TESTE_DATABASE_URL` (banco novo com migrations).
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;
const SUF = Date.now().toString(36);
const DIA = "2026-10-01";
const CPF_JOANA = `9${Date.now()}`.slice(0, 11);

describe.skipIf(!URL_TESTE)("correção de ponto → Hoje + sininho — Prisma real", () => {
  let prisma: PrismaService;
  let ponto: PontoService;
  let inbox: AdminInboxService;
  let contaId: string;
  let decide: string;
  let soVe: string;
  let user: AuthFuncionario;
  let outro: AuthFuncionario;
  let admin: PontoAdminService;
  let identidadeId: string;
  const push = {
    enviarParaIdentidade: vi.fn(async () => ({ enviado: true })),
    enviar: vi.fn(async () => ({ enviado: true })),
  };

  const naConta = <T>(fn: () => Promise<T>) => comConta(contaId, fn);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    inbox = new AdminInboxService(prisma);
    ponto = new PontoService(prisma, { marcarQueSubiu: async () => {}, subir: async () => {} } as never, inbox);
    admin = new PontoAdminService(prisma, { log: async () => {} } as never, {} as never, push as never);
    identidadeId = (
      await comoSistema(() =>
        prisma.motoristaIdentidade.create({ data: { cpf: CPF_JOANA, nome: "Joana", senhaHash: "x", expoPushToken: "ExponentPushToken[joana]" } }),
      )
    ).id;

    contaId = (await comoSistema(() => prisma.conta.create({ data: { nome: "ponto", slug: `ponto-${SUF}` } }))).id;
    await naConta(async () => {
      const papelDecide = await prisma.papel.create({
        data: { nome: "decide", permissoes: ["correcoes-ponto.ver", "correcoes-ponto.decidir"] },
      });
      const papelVe = await prisma.papel.create({ data: { nome: "ve", permissoes: ["correcoes-ponto.ver"] } });
      decide = (
        await prisma.user.create({
          data: { nome: "Decide", email: `decide-${SUF}@t.local`, senhaHash: "x", papelId: papelDecide.id },
        })
      ).id;
      soVe = (
        await prisma.user.create({
          data: { nome: "Só vê", email: `ve-${SUF}@t.local`, senhaHash: "x", papelId: papelVe.id },
        })
      ).id;
      const f = await prisma.funcionario.create({
        // SEM identidadeId, de propósito: é o caso comum (cadastrada no painel
        // antes de instalar o app) e era o que fazia o push não sair.
        data: { nome: "Joana Teste", cpf: CPF_JOANA, admitidoEm: new Date("2026-01-01") },
      });
      const g = await prisma.funcionario.create({
        data: { nome: "Outro", cpf: "11144477735", admitidoEm: new Date("2026-01-01") },
      });
      outro = {
        kind: "FUNCIONARIO",
        id: "identidade-outro",
        nome: g.nome,
        cpf: g.cpf,
        funcionarioId: g.id,
        contaId,
        contaSomenteLeitura: false,
      };
      user = {
        kind: "FUNCIONARIO",
        id: "identidade-fake",
        nome: f.nome,
        cpf: f.cpf,
        funcionarioId: f.id,
        contaId,
        contaSomenteLeitura: false,
      };
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("o pedido aparece no Hoje do app, com a hora pretendida", async () => {
    await naConta(() =>
      ponto.pedirCorrecao(user, {
        clientId: `cli-${SUF}`,
        dia: DIA,
        tipo: "INCLUSAO",
        instantePretendido: "2026-10-01T10:30:00.000Z", // 07:30 em SP
        motivoCodigo: "ESQUECI",
        motivo: "Esqueci de registrar",
      }),
    );
    const hoje = await naConta(() => ponto.hoje(user, DIA));
    expect(hoje.marcacoes).toHaveLength(0);
    expect(hoje.correcoes).toHaveLength(1);
    expect(hoje.correcoes[0]).toMatchObject({
      tipo: "INCLUSAO",
      status: "PENDENTE",
      instantePretendido: "2026-10-01T10:30:00.000Z",
      pedidoPor: "FUNCIONARIO",
    });
  });

  it("o sininho avisa só quem decide, com a hora de SP no texto", async () => {
    const doDecide = await naConta(() => inbox.listar(decide, {}));
    expect(doDecide.itens).toHaveLength(1);
    expect(doDecide.itens[0]).toMatchObject({
      tipo: "correcao-ponto",
      titulo: "Joana Teste pediu correção do ponto",
      corpo: "Dia 01/10: incluir 07:30.",
    });
    const doSoVe = await naConta(() => inbox.listar(soVe, {}));
    expect(doSoVe.itens).toHaveLength(0);
  });

  it("reenvio do mesmo clientId (outbox) não duplica o aviso", async () => {
    await naConta(() =>
      ponto.pedirCorrecao(user, {
        clientId: `cli-${SUF}`,
        dia: DIA,
        tipo: "INCLUSAO",
        instantePretendido: "2026-10-01T10:30:00.000Z",
        motivoCodigo: "ESQUECI",
        motivo: "Esqueci de registrar",
      }),
    );
    expect((await naConta(() => inbox.listar(decide, {}))).itens).toHaveLength(1);
  });

  it("filtro por tipo e contagem por tipo do sininho", async () => {
    await naConta(() =>
      inbox.disparar({ tipo: "problema-veiculo", titulo: "x", corpo: "y", permissao: "correcoes-ponto.decidir" }),
    );
    const ponto = await naConta(() => inbox.listar(decide, { tipos: ["correcao-ponto"] }));
    expect(ponto.itens.map((n) => n.tipo)).toEqual(["correcao-ponto"]);
    const todas = await naConta(() => inbox.listar(decide, {}));
    expect(todas.itens).toHaveLength(2);
    expect(await naConta(() => inbox.contarNaoLidasPorTipo(decide))).toEqual({
      "correcao-ponto": 1,
      "problema-veiculo": 1,
    });
  });

  it("não contar: só batida dela, do dia, e um pedido por batida", async () => {
    const bateu = (u: AuthFuncionario, clientId: string) =>
      naConta(() =>
        ponto.registrar(u, { clientId, dia: DIA, marcadoEm: "2026-10-01T11:00:00.000Z" } as never, {}),
      );
    const minha = (await bateu(user, `m1-${SUF}`)) as { id: string };
    const dele = (await bateu(outro, `m2-${SUF}`)) as { id: string };
    const pedir = (marcacaoId: string, dia = DIA) =>
      naConta(() =>
        ponto.pedirCorrecao(user, {
          dia,
          tipo: "DESCONSIDERACAO",
          marcacaoId,
          motivoCodigo: "BATEU_SEM_QUERER",
          motivo: "Bati sem querer",
        }),
      );

    await expect(pedir(dele.id)).rejects.toThrow("não é sua");
    await expect(pedir(minha.id, "2026-10-02")).rejects.toThrow("não é desse dia");
    const pedido = await pedir(minha.id);
    await expect(pedir(minha.id)).rejects.toThrow("já pediu");

    const aviso = (await naConta(() => inbox.listar(decide, { tipos: ["correcao-ponto"] }))).itens[0];
    expect(aviso?.corpo).toBe("Dia 01/10: não contar a batida das 08:00.");

    // O escritório aceita → push pra pessoa, e a batida não abre pedido de novo.
    await naConta(() => admin.decidirCorrecao(pedido.id, "APROVADA", decide));
    expect(push.enviarParaIdentidade).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identidadeId,
        titulo: "Seu pedido de correção foi aceito",
        dados: expect.objectContaining({ kind: "ponto-correcao", dia: DIA }),
      }),
    );
    await expect(pedir(minha.id)).rejects.toThrow("já não conta");
    // E o vínculo que faltava ficou gravado.
    const f = await naConta(() =>
      prisma.funcionario.findFirst({ where: { id: user.funcionarioId }, select: { identidadeId: true } }),
    );
    expect(f?.identidadeId).toBe(identidadeId);

    // A lista do escritório diz QUAL batida.
    const lista = await naConta(() => admin.listarCorrecoes());
    expect(lista.find((c) => c.id === pedido.id)?.marcacaoEm).toBe("2026-10-01T11:00:00.000Z");
  });

  it("recusa leva o motivo no push e no Hoje", async () => {
    const hoje = await naConta(() => ponto.hoje(user, DIA));
    const inclusao = hoje.correcoes.find((c) => c.tipo === "INCLUSAO")!;
    await naConta(() => admin.decidirCorrecao(inclusao.id, "RECUSADA", decide, "Você estava de folga"));
    expect(push.enviarParaIdentidade).toHaveBeenLastCalledWith(
      expect.objectContaining({ corpo: "Dia 01/10: Você estava de folga" }),
    );
    const depois = await naConta(() => ponto.hoje(user, DIA));
    expect(depois.correcoes.find((c) => c.id === inclusao.id)).toMatchObject({
      status: "RECUSADA",
      decisaoMotivo: "Você estava de folga",
    });
  });

  it("motorista CLT: vai pelo cadastro de motorista (entra no sininho do app), sem repetir o aparelho", async () => {
    await naConta(() =>
      prisma.motorista.create({
        data: { nome: "Joana", cpf: CPF_JOANA, senhaHash: "x", expoPushToken: "ExponentPushToken[joana]" },
      }),
    );
    push.enviar.mockClear();
    push.enviarParaIdentidade.mockClear();
    const p = await naConta(() =>
      ponto.pedirCorrecao(user, {
        dia: DIA,
        tipo: "INCLUSAO",
        instantePretendido: "2026-10-01T20:00:00.000Z",
        motivoCodigo: "ESQUECEU",
        motivo: "Esqueci",
      }),
    );
    await naConta(() => admin.decidirCorrecao(p.id, "APROVADA", decide));
    expect(push.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "ExponentPushToken[joana]",
        tipo: "ponto-correcao",
        titulo: "Seu pedido de correção foi aceito",
      }),
    );
    // Mesmo token na pessoa e no cadastro = mesmo aparelho: um push só.
    expect(push.enviarParaIdentidade).not.toHaveBeenCalled();
  });
});
