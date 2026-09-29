import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CODIGO_MODULO_NAO_CONTRATADO } from "@ronan/shared-types";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { comConta } from "../conta/conta-context";
import { ModuloGuard } from "./modulo.guard";

class Fake {
  @RequerPermissao("ponto.ver") ponto() {}
  @RequerPermissao("viagens.ver") viagens() {}
  @RequerPermissao("ponto.ver", "viagens.ver") ou() {}
  semPermissao() {}
}

function ctx(handler: () => void, user: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Fake,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const ADMIN = { kind: "ADMIN_USER", id: "u", permissoes: [] };

/** Cada teste usa uma conta própria: o cache do guard é por conta e dura 15s. */
let n = 0;
const nova = () => `conta-guard-${++n}`;

function guard(
  modulosDaConta: { chave: string; vigenteDe: Date | null; vigenteAte: Date | null }[] | Error,
  ehPlataforma = false,
) {
  const prisma = {
    conta: { findUnique: async () => ({ ehPlataforma, permissoesPermitidas: [], permissoesExtras: [] }) },
    moduloContratado: {
      findMany: async () => {
        if (modulosDaConta instanceof Error) throw modulosDaConta;
        return modulosDaConta;
      },
    },
  };
  return new ModuloGuard(new Reflector(), prisma as never);
}
const ligado = (chave: string) => ({ chave, vigenteDe: null, vigenteAte: null });
const codigo = async (p: Promise<unknown>) =>
  p.then(() => "passou", (e: ForbiddenException) => (e.getResponse() as { code?: string }).code ?? "403");

describe("ModuloGuard", () => {
  it("conta só com núcleo: recurso de módulo vendido à parte é barrado", async () => {
    const g = guard([ligado("operacao")]);
    const id = nova();
    expect(await codigo(comConta(id, () => g.canActivate(ctx(Fake.prototype.ponto, ADMIN))))).toBe(
      CODIGO_MODULO_NAO_CONTRATADO,
    );
    expect(await comConta(id, () => g.canActivate(ctx(Fake.prototype.viagens, ADMIN)))).toBe(true);
  });

  it("conta SEM nenhuma linha vale como só núcleo, não como tudo liberado", async () => {
    const g = guard([]);
    expect(await codigo(comConta(nova(), () => g.canActivate(ctx(Fake.prototype.ponto, ADMIN))))).toBe(
      CODIGO_MODULO_NAO_CONTRATADO,
    );
  });

  it("módulo desligado, vencido ou que ainda não começou não libera", async () => {
    const ontem = new Date(Date.now() - 2 * 86_400_000);
    const amanha = new Date(Date.now() + 2 * 86_400_000);
    for (const linha of [
      { chave: "ponto", vigenteDe: null, vigenteAte: ontem },
      { chave: "ponto", vigenteDe: amanha, vigenteAte: null },
    ]) {
      const g = guard([ligado("operacao"), linha]);
      expect(await codigo(comConta(nova(), () => g.canActivate(ctx(Fake.prototype.ponto, ADMIN))))).toBe(
        CODIGO_MODULO_NAO_CONTRATADO,
      );
    }
  });

  it("a casa (ehPlataforma) passa em todo módulo, mesmo sem nenhuma linha", async () => {
    const g = guard([], true);
    for (const h of [Fake.prototype.ponto, Fake.prototype.viagens, Fake.prototype.ou]) {
      expect(await comConta(nova(), () => g.canActivate(ctx(h, ADMIN)))).toBe(true);
    }
  });

  it("com o módulo contratado, passa", async () => {
    const g = guard([ligado("operacao"), ligado("ponto")]);
    expect(await comConta(nova(), () => g.canActivate(ctx(Fake.prototype.ponto, ADMIN)))).toBe(true);
  });

  it("@RequerPermissao é OR: basta um dos módulos", async () => {
    const g = guard([ligado("operacao")]);
    expect(await comConta(nova(), () => g.canActivate(ctx(Fake.prototype.ou, ADMIN)))).toBe(true);
  });

  it("FAIL-CLOSED: se a leitura dos módulos falhar, o módulo à parte NÃO abre", async () => {
    // Antes: o padrão era um conjunto vazio e `size === 0` liberava — um soluço
    // do banco abria Ponto, Fiscal, Financeiro… pra qualquer administrador.
    const g = guard(new Error("conexão caiu"));
    expect(await codigo(comConta(nova(), () => g.canActivate(ctx(Fake.prototype.ponto, ADMIN))))).toBe(
      CODIGO_MODULO_NAO_CONTRATADO,
    );
  });

  it("FAIL-CLOSED: sem conta no contexto, não libera", async () => {
    const g = guard([ligado("operacao"), ligado("ponto")]);
    expect(await codigo(g.canActivate(ctx(Fake.prototype.ponto, ADMIN)))).toBe(CODIGO_MODULO_NAO_CONTRATADO);
  });

  it("fora do escopo do guard: handler sem permissão e quem não é admin passam", async () => {
    const g = guard([]);
    expect(await g.canActivate(ctx(Fake.prototype.semPermissao, ADMIN))).toBe(true);
    expect(await g.canActivate(ctx(Fake.prototype.ponto, { kind: "MOTORISTA" }))).toBe(true);
  });
});
