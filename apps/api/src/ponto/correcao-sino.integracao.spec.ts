import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comConta, comoSistema } from "../common/conta/conta-context";
import type { PrismaService } from "../prisma/prisma.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import type { AuthFuncionario } from "../auth/types";
import { PontoService } from "./ponto.service";

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

describe.skipIf(!URL_TESTE)("correção de ponto → Hoje + sininho — Prisma real", () => {
  let prisma: PrismaService;
  let ponto: PontoService;
  let inbox: AdminInboxService;
  let contaId: string;
  let decide: string;
  let soVe: string;
  let user: AuthFuncionario;

  const naConta = <T>(fn: () => Promise<T>) => comConta(contaId, fn);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    inbox = new AdminInboxService(prisma);
    ponto = new PontoService(prisma, {} as never, inbox);

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
        data: { nome: "Joana Teste", cpf: "52998224725", admitidoEm: new Date("2026-01-01") },
      });
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
});
