import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { EncarregadoGuard } from "./encarregado.guard";
import { gerarTokenSessao } from "./encarregado-regras";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * O guard do portal é fail-closed: o que não for uma sessão de portal válida,
 * de obra ativa, em empresa que pode entrar e que tem o módulo, não passa.
 */

function contexto(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function prismaCom(sessao: unknown, modulos: string[] = ["torre"]) {
  return {
    sessaoEncarregado: {
      findUnique: vi.fn().mockResolvedValue(sessao),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    conta: { findUnique: vi.fn().mockResolvedValue({ ehPlataforma: false }) },
    moduloContratado: {
      findMany: vi.fn().mockResolvedValue(modulos.map((chave) => ({ chave, vigenteDe: null, vigenteAte: null }))),
    },
  } as unknown as PrismaService;
}

const sessaoBoa = () => ({
  id: "s1",
  contaId: "c1",
  expiraEm: new Date(Date.now() + 86_400_000),
  revogadaEm: null,
  ultimoUsoEm: new Date(),
  encarregado: {
    id: "e1",
    clienteId: "obra1",
    nome: "Carlos",
    ativo: true,
    podeVerValores: false,
    podePedirCaminhao: true,
    cliente: { ativa: true },
  },
  conta: { ativa: true, somenteLeitura: false, trialExpiraEm: null, motivoBloqueio: null },
});

describe("EncarregadoGuard", () => {
  it("sem token: 401 sem nem consultar o banco", async () => {
    const prisma = prismaCom(sessaoBoa());
    const guard = new EncarregadoGuard(prisma);
    await expect(guard.canActivate(contexto({ headers: {}, method: "GET" }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.sessaoEncarregado.findUnique).not.toHaveBeenCalled();
  });

  it("JWT do painel/app não serve aqui (não é token de portal)", async () => {
    const prisma = prismaCom(sessaoBoa());
    const guard = new EncarregadoGuard(prisma);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsImtpbmQiOiJBRE1JTl9VU0VSIn0.assinatura-qualquer";
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${jwt}` }, method: "GET" })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sessaoEncarregado.findUnique).not.toHaveBeenCalled();
  });

  it("token desconhecido: 401", async () => {
    const guard = new EncarregadoGuard(prismaCom(null));
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${gerarTokenSessao()}` }, method: "GET" })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("encarregado desativado: 401", async () => {
    const s = sessaoBoa();
    s.encarregado.ativo = false;
    const guard = new EncarregadoGuard(prismaCom(s));
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${gerarTokenSessao()}` }, method: "GET" })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("empresa sem o módulo da torre: 401", async () => {
    const guard = new EncarregadoGuard(prismaCom(sessaoBoa(), []));
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${gerarTokenSessao()}` }, method: "GET" })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("empresa em somente leitura: consulta, mas não pede caminhão", async () => {
    const s = sessaoBoa();
    s.conta.somenteLeitura = true;
    const guard = new EncarregadoGuard(prismaCom(s));
    const token = `Bearer ${gerarTokenSessao()}`;
    await expect(guard.canActivate(contexto({ headers: { authorization: token }, method: "GET" }))).resolves.toBe(true);
    await expect(
      guard.canActivate(contexto({ headers: { authorization: token }, method: "POST" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("sessão boa: passa e pendura o encarregado em req.encarregado (nunca em req.user)", async () => {
    const guard = new EncarregadoGuard(prismaCom(sessaoBoa()));
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${gerarTokenSessao()}` },
      method: "GET",
    };
    await expect(guard.canActivate(contexto(req))).resolves.toBe(true);
    expect(req.user).toBeUndefined();
    expect(req.encarregado).toMatchObject({ kind: "ENCARREGADO", clienteId: "obra1", contaId: "c1" });
  });
});
