import { describe, expect, it } from "vitest";
import { MensalService } from "./mensal.service";

/**
 * As travas do mensal.
 *
 * Cada teste aqui existe por uma decisão tomada com o dono em 19/09/2026, e
 * quebrar qualquer um deles não é "teste chato": é o produto voltando a fazer
 * o que se decidiu que ele não faz.
 */

function servico(estado: {
  alocacaoAtiva?: Record<string, unknown> | null;
  registroExistente?: Record<string, unknown> | null;
  alocacao?: Record<string, unknown> | null;
}) {
  const escritas: { tabela: string; op: string; data: Record<string, unknown> }[] = [];
  const prisma = {
    cliente: { findFirst: async () => ({ id: "cli1", nome: "Obra Centro" }) },
    motorista: {
      findFirst: async () => ({ id: "mot1", nome: "Joao", status: "APROVADO" }),
      findUnique: async () => ({ status: "APROVADO" }),
    },
    veiculo: { findFirst: async () => ({ id: "vei1", placa: "ABC1D23" }) },
    alocacaoObra: {
      findFirst: async () => estado.alocacaoAtiva ?? estado.alocacao ?? null,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "alocacao", op: "create", data });
        return { id: "aloc1", ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "alocacao", op: "update", data });
        return { id: "aloc1", ...data };
      },
    },
    registroPresenca: {
      findFirst: async () => estado.registroExistente ?? null,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "presenca", op: "create", data });
        return { id: "p1", ...data };
      },
      delete: async () => ({}),
    },
  };
  return { s: new MensalService(prisma as never), escritas };
}

const ONTEM = "2026-09-18";

describe("uma obra por vez", () => {
  it("recusa segunda alocação dizendo QUAL obra já ocupa o motorista", async () => {
    // Decisão do dono: uma obra por vez. É o que sustenta o botão único no app
    // — com duas alocações vivas a tela teria que perguntar "qual obra?".
    const { s, escritas } = servico({
      alocacaoAtiva: { id: "a0", ativa: true, cliente: { nome: "Obra Norte" } },
    });

    await expect(
      s.criarAlocacao(
        { clienteId: "cli1", motoristaId: "mot1", veiculoId: "vei1", inicio: "2026-09-01" },
        "u1",
      ),
    ).rejects.toThrow(/Obra Norte/);
    expect(escritas).toHaveLength(0);
  });

  it("a alocação nasce com a chave de vigência, que é o que o índice único usa", async () => {
    const { s, escritas } = servico({ alocacaoAtiva: null });
    await s.criarAlocacao(
      { clienteId: "cli1", motoristaId: "mot1", veiculoId: "vei1", inicio: "2026-09-01" },
      "u1",
    );
    expect(escritas[0]!.data.vigenteDe).toBe("mot1");
  });

  it("encerrar limpa a chave no MESMO update — senão a próxima alocação não entra", async () => {
    // Se `vigenteDe` continuasse valendo o motoristaId depois de encerrada, o
    // índice único recusaria a alocação seguinte e o motorista ficaria preso na
    // obra antiga pra sempre.
    const { s, escritas } = servico({ alocacao: { id: "a1", ativa: true } });
    await s.encerrarAlocacao("a1", "obra terminou");
    expect(escritas[0]!.data.ativa).toBe(false);
    expect(escritas[0]!.data.vigenteDe).toBeNull();
  });
});

describe("o toque", () => {
  const alocacaoViva = {
    id: "a1",
    ativa: true,
    inicio: new Date("2026-09-01T00:00:00.000Z"),
    fim: null,
  };

  it("tocar de novo no mesmo dia devolve o mesmo registro, nunca erro", async () => {
    // O motorista não tem o que fazer com um 409. Segundo toque = mesma tela
    // verde. Sem isto, 4G ruim vira duplicata ou vira erro na cara dele.
    const existente = { id: "p0", data: new Date(`${ONTEM}T00:00:00.000Z`) };
    const { s, escritas } = servico({ alocacao: alocacaoViva, registroExistente: existente });

    const r = await s.registrarPresenca("mot1", { data: ONTEM, clientId: "a1|2026-09-18|CHEGADA" });
    expect(r).toBe(existente);
    expect(escritas).toHaveLength(0);
  });

  it("grava como APP e guarda o GPS quando veio", async () => {
    const { s, escritas } = servico({ alocacao: alocacaoViva, registroExistente: null });
    await s.registrarPresenca("mot1", {
      data: ONTEM,
      clientId: "a1|2026-09-18|CHEGADA",
      latitude: -25.4,
      longitude: -49.2,
      precisao: 12,
    });
    expect(escritas[0]!.data.origem).toBe("APP");
    expect(escritas[0]!.data.latitude).toBe(-25.4);
  });

  it("registra igual SEM GPS — sinal de obra é ruim e isso não é culpa dele", async () => {
    // GPS é evidência, nunca porteiro. Recusar por falta de sinal puniria o
    // motorista por um problema que não é dele.
    const { s, escritas } = servico({ alocacao: alocacaoViva, registroExistente: null });
    await s.registrarPresenca("mot1", { data: ONTEM, clientId: "x" });
    expect(escritas).toHaveLength(1);
    expect(escritas[0]!.data.latitude).toBeNull();
  });

  it("sem alocação, é 4xx e não 500 — 500 trava o outbox em loop", async () => {
    const { s } = servico({ alocacao: null });
    await expect(
      s.registrarPresenca("mot1", { data: ONTEM, clientId: "x" }),
    ).rejects.toThrow(/não está alocado/i);
  });

  it("recusa dia anterior ao início na obra", async () => {
    const { s } = servico({ alocacao: alocacaoViva, registroExistente: null });
    await expect(
      s.registrarPresenca("mot1", { data: "2026-08-30", clientId: "x" }),
    ).rejects.toThrow(/anterior ao início/i);
  });
});

describe("o painel não apaga a prova do motorista", () => {
  it("dia marcado no app não pode ser removido pelo painel", async () => {
    // O registro dele é a prova dele contra a medição do contratante. Apagar
    // prova de alguém sem que ele saiba é poder que o sistema não deve ter —
    // divergência se resolve no espelho, onde ele pode responder.
    const prisma = {
      registroPresenca: {
        findFirst: async () => ({ id: "p1", origem: "APP" }),
        delete: async () => ({}),
      },
    };
    const s = new MensalService(prisma as never);
    await expect(s.removerPresenca("p1", "achei errado")).rejects.toThrow(/marcado pelo motorista/i);
  });

  it("dia lançado pelo painel pode ser removido com motivo", async () => {
    const prisma = {
      registroPresenca: {
        findFirst: async () => ({ id: "p1", origem: "PAINEL" }),
        delete: async () => ({}),
      },
    };
    const s = new MensalService(prisma as never);
    await expect(s.removerPresenca("p1", "lancei na obra errada")).resolves.toEqual({
      removido: true,
    });
  });

  it("lançamento do painel fica carimbado como PAINEL, não como APP", async () => {
    // O espelho precisa distinguir: a prova que vale contra a medição é a que
    // veio do aparelho do motorista.
    const { s, escritas } = servico({
      alocacao: { id: "a1", inicio: new Date("2026-09-01T00:00:00.000Z"), fim: null },
      registroExistente: null,
    });
    await s.lancarPelaPainel({ alocacaoId: "a1", data: ONTEM, motivo: "ele avisou por telefone" }, "u1");
    expect(escritas[0]!.data.origem).toBe("PAINEL");
    expect(escritas[0]!.data.motivoPainel).toBe("ele avisou por telefone");
  });
});

describe("o motorista desfaz o próprio toque", () => {
  it("apaga o dia que ELE marcou", async () => {
    // É o que torna honesto não perguntar "tem certeza?" antes de marcar. Sem
    // desfazer, um toque errado seria definitivo e a tela precisaria de um
    // diálogo todo dia — que é justamente o toque a mais que não pode existir.
    const apagados: string[] = [];
    const prisma = {
      alocacaoObra: { findFirst: async () => ({ id: "a1" }) },
      registroPresenca: {
        findFirst: async () => ({ id: "p1", origem: "APP" }),
        delete: async ({ where }: { where: { id: string } }) => {
          apagados.push(where.id);
          return {};
        },
      },
    };
    const s = new MensalService(prisma as never);
    await expect(s.desmarcarPresenca("mot1", ONTEM)).resolves.toEqual({ desmarcado: true });
    expect(apagados).toEqual(["p1"]);
  });

  it("não apaga o que o ESCRITÓRIO lançou", async () => {
    const prisma = {
      alocacaoObra: { findFirst: async () => ({ id: "a1" }) },
      registroPresenca: {
        findFirst: async () => ({ id: "p1", origem: "PAINEL" }),
        delete: async () => ({}),
      },
    };
    const s = new MensalService(prisma as never);
    await expect(s.desmarcarPresenca("mot1", ONTEM)).rejects.toThrow(/escritório/i);
  });

  it("desfazer o que nunca subiu é sucesso, não erro", async () => {
    // O app pode estar desfazendo um item que ainda estava no outbox. Devolver
    // 404 faria a tela mostrar falha num sucesso.
    const prisma = {
      alocacaoObra: { findFirst: async () => ({ id: "a1" }) },
      registroPresenca: { findFirst: async () => null, delete: async () => ({}) },
    };
    const s = new MensalService(prisma as never);
    await expect(s.desmarcarPresenca("mot1", ONTEM)).resolves.toEqual({ desmarcado: true });
  });
});

/**
 * O léxico é regra, não estilo.
 *
 * Ponto, jornada, falta e atraso somados a pagamento por diária e habitualidade
 * são os elementos do vínculo empregatício. O motorista é parceiro autônomo, e
 * quem pagaria essa conta é a transportadora.
 */
describe("léxico", () => {
  it("o módulo do mensal não usa palavra de vínculo em identificador", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname);
    const proibidas = /\b(ponto|jornada|hora ?extra|falta[sr]?|atraso|escala|expediente)\b/i;

    // O próprio spec fica de fora: pra proibir uma palavra é preciso escrevê-la,
    // e o que vai pro ar é o código, não o teste.
    const alvos = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
    expect(alvos.length).toBeGreaterThan(0);

    for (const arquivo of alvos) {
      // Só o que é código: comentário explica POR QUE a palavra é proibida e
      // precisa poder citá-la. Varrer prosa faria este teste proibir a própria
      // explicação.
      const codigo = readFileSync(join(dir, arquivo), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(proibidas.test(codigo), `${arquivo} usa palavra de vínculo`).toBe(false);
    }
  });
});
