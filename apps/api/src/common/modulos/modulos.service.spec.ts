import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { comConta, contaAtual } from "../conta/conta-context";
import { ModulosService } from "./modulos.service";

/**
 * Regressão do incidente de 29/09/2026: a tela de Módulos da Schaba mostrava
 * TODOS os módulos desligados (e ligar/desligar caía na conta errada) porque
 * `ModuloContratado` é escopado pela trava e o service rodava no contexto de
 * QUEM chama — a casa —, não da empresa alvo.
 *
 * O prisma de mentira faz o que a trava faz: filtra e carimba pela conta do
 * contexto (`contaAtual()`), ignorando o `contaId` que o código pediu.
 */
type Linha = { id: string; contaId: string; chave: string; ativo: boolean; vigenteDe: Date | null; vigenteAte: Date | null };

function prismaDeMentira(linhas: Linha[]) {
  const daConta = () => contaAtual()!.contaId!;
  return {
    linhas,
    conta: { findUnique: async () => ({ ehPlataforma: false, permissoesPermitidas: [], permissoesExtras: [] }) },
    moduloContratado: {
      findMany: async (args?: { where?: { ativo?: boolean } }) =>
        linhas
          .filter((l) => l.contaId === daConta())
          .filter((l) => args?.where?.ativo === undefined || l.ativo === args.where.ativo)
          .map((l) => ({ ...l, ligadoPor: null, observacao: null })),
      upsert: async (args: { where: { contaId_chave: { contaId: string; chave: string } }; create: Partial<Linha>; update: Partial<Linha> }) => {
        const alvo = daConta();
        const chave = args.where.contaId_chave.chave;
        const existente = linhas.find((l) => l.contaId === alvo && l.chave === chave);
        if (existente) return Object.assign(existente, args.update);
        const nova = { id: `l${linhas.length}`, contaId: alvo, chave, ativo: true, vigenteDe: null, vigenteAte: null, ...args.create } as Linha;
        nova.contaId = alvo; // a trava carimba a conta do contexto
        linhas.push(nova);
        return nova;
      },
    },
  };
}

function servico(linhas: Linha[]) {
  const prisma = prismaDeMentira(linhas);
  const semeadosEm: (string | null)[] = [];
  const permissoes = { seedPapeisSistema: async () => void semeadosEm.push(contaAtual()?.contaId ?? null) };
  return { prisma, semeadosEm, svc: new ModulosService(prisma as never, permissoes as never) };
}

const linha = (contaId: string, chave: string, ativo = true): Linha => ({
  id: `${contaId}-${chave}`, contaId, chave, ativo, vigenteDe: null, vigenteAte: null,
});

describe("ModulosService — sempre na conta ALVO, nunca na de quem chama", () => {
  it("a tela mostra os módulos da empresa mesmo quando quem olha é a casa", async () => {
    const { svc } = servico([
      linha("schaba", "operacao"),
      linha("schaba", "ponto"),
      linha("schaba", "torre"),
      linha("casa", "operacao"),
    ]);

    const modulos = await comConta("casa", () => svc.daConta("schaba"));
    const por = Object.fromEntries(modulos.map((m) => [m.chave, m]));

    expect(por.ponto.contratado).toBe(true);
    expect(por.ponto.vigente).toBe(true);
    expect(por.torre.contratado).toBe(true);
    // O que a empresa NÃO tem segue desligado.
    expect(por.fiscal.contratado).toBe(false);
    expect(por.fiscal.vigente).toBe(false);
  });

  it("não mistura com os módulos da casa", async () => {
    const { svc } = servico([linha("casa", "ponto"), linha("cliente", "operacao")]);
    const modulos = await comConta("casa", () => svc.daConta("cliente"));
    expect(modulos.find((m) => m.chave === "ponto")!.contratado).toBe(false);
  });

  it("ligar grava na empresa alvo e não na de quem clicou", async () => {
    const { svc, prisma } = servico([]);

    await comConta("casa", () =>
      svc.definir({ contaId: "cliente", chave: "ponto", ativo: true, usuarioId: "u1" }),
    );

    expect(prisma.linhas.map((l) => `${l.contaId}:${l.chave}`)).toEqual(["cliente:ponto"]);
  });

  it("desligar atinge a linha da empresa alvo e re-sincroniza os papéis DELA", async () => {
    const { svc, prisma, semeadosEm } = servico([linha("cliente", "ponto"), linha("casa", "ponto")]);

    await comConta("casa", () =>
      svc.definir({ contaId: "cliente", chave: "ponto", ativo: false, usuarioId: "u1" }),
    );

    expect(prisma.linhas.find((l) => l.contaId === "cliente" && l.chave === "ponto")!.ativo).toBe(false);
    // A casa não foi tocada.
    expect(prisma.linhas.find((l) => l.contaId === "casa" && l.chave === "ponto")!.ativo).toBe(true);
    expect(semeadosEm).toEqual(["cliente"]);
  });

  it("o núcleo continua não se desligando", async () => {
    const { svc } = servico([]);
    await expect(
      svc.definir({ contaId: "cliente", chave: "operacao", ativo: false, usuarioId: "u1" }),
    ).rejects.toThrow(/núcleo/);
  });
});
