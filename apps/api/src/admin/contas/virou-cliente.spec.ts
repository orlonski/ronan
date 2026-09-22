import { describe, expect, it } from "vitest";
import { ContasService } from "./contas.service";
import { estadoDaConta } from "../../common/conta/estado-da-conta";

/**
 * O bug que este arquivo existe pra impedir de voltar:
 *
 * o cron do teste LIGA `somenteLeitura` e nunca desliga, e `estadoDaConta`
 * recalcula "venceu?" a cada requisição a partir de `trialExpiraEm`, que
 * ninguém limpava. Resultado: a empresa que assinava depois do teste vencido
 * continuava sem poder lançar PARA SEMPRE, e a única saída era UPDATE no banco.
 */

type ContaFake = {
  nome: string;
  trialExpiraEm: Date | null;
  somenteLeitura: boolean;
  motivoBloqueio: string | null;
};

function montar(conta: ContaFake) {
  const updates: Record<string, unknown>[] = [];
  const auditorias: Record<string, unknown>[] = [];
  let atual = { ...conta };

  const prisma = {
    conta: {
      findUnique: async () => atual,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        atual = { ...atual, ...(data as Partial<ContaFake>) };
        return { id: "c1", ...atual };
      },
    },
  };
  const auditoria = {
    log: async (e: Record<string, unknown>) => {
      auditorias.push(e);
    },
  };

  const s = new ContasService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    auditoria as never,
  );
  return { s, updates, auditorias, conta: () => atual };
}

const ONTEM = new Date(Date.now() - 86_400_000);

describe("virouCliente", () => {
  it("destrava a conta cujo teste já tinha vencido", async () => {
    const { s, conta } = montar({
      nome: "Transportes Freitas",
      trialExpiraEm: ONTEM,
      somenteLeitura: true,
      motivoBloqueio: "Seu período de teste terminou.",
    });

    // Antes: entra, mas não escreve.
    expect(estadoDaConta({ ativa: true, ...conta() }).podeEscrever).toBe(false);

    await s.virouCliente("c1", "u1");

    const depois = conta();
    expect(depois.trialExpiraEm).toBeNull();
    expect(depois.somenteLeitura).toBe(false);
    expect(depois.motivoBloqueio).toBeNull();
    // E não volta a travar na próxima requisição: sem data, não há o que vencer.
    expect(estadoDaConta({ ativa: true, ...depois }).podeEscrever).toBe(true);
    expect(estadoDaConta({ ativa: true, ...depois }).emTeste).toBe(false);
  });

  it("destrava também quem assina ANTES de o teste vencer", async () => {
    const emBreve = new Date(Date.now() + 3 * 86_400_000);
    const { s, conta } = montar({
      nome: "Pedreira Boa Vista",
      trialExpiraEm: emBreve,
      somenteLeitura: false,
      motivoBloqueio: null,
    });

    await s.virouCliente("c1", "u1");

    // Sem isto a faixa seguiria contando "faltam 3 dias" pra quem já é cliente.
    expect(conta().trialExpiraEm).toBeNull();
    expect(estadoDaConta({ ativa: true, ...conta() }).diasRestantes).toBeNull();
  });

  it("é idempotente: conta que já é cliente não gera UPDATE nem auditoria", async () => {
    const { s, updates, auditorias } = montar({
      nome: "Schaba",
      trialExpiraEm: null,
      somenteLeitura: false,
      motivoBloqueio: null,
    });

    await s.virouCliente("c1", "u1");

    expect(updates).toEqual([]);
    expect(auditorias).toEqual([]);
  });

  it("deixa rastro do que estava travado", async () => {
    const { s, auditorias } = montar({
      nome: "Transportes Freitas",
      trialExpiraEm: ONTEM,
      somenteLeitura: true,
      motivoBloqueio: "Seu período de teste terminou.",
    });

    await s.virouCliente("c1", "u7");

    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({
      usuarioId: "u7",
      entidade: "Conta",
      entidadeId: "c1",
      campo: "somenteLeitura",
      motivo: "Virou cliente: assinatura ativa",
    });
    expect(auditorias[0]!.valorAntes).toMatchObject({ somenteLeitura: true });
  });

  it("não derruba o fluxo quando a auditoria falha", async () => {
    const prisma = {
      conta: {
        findUnique: async () => ({
          nome: "X",
          trialExpiraEm: ONTEM,
          somenteLeitura: true,
          motivoBloqueio: null,
        }),
        update: async () => ({}),
      },
    };
    const s = new ContasService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        log: async () => {
          throw new Error("banco caiu");
        },
      } as never,
    );

    // A assinatura já existe no gateway: o destravamento não pode explodir
    // porque a linha de auditoria não entrou.
    await expect(s.virouCliente("c1", "u1")).resolves.toBeUndefined();
  });
});
