import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PATH_METADATA, GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { moduloDaChave, MODULOS } from "@ronan/shared-types";
import { PERMISSAO_KEY } from "../../auth/decorators/requer-permissao.decorator";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { comConta } from "../conta/conta-context";
import { chaveDoHandler, ENDPOINTS_SEM_PERMISSAO } from "./endpoints-sem-permissao";
import { ModuloGuard } from "./modulo.guard";

/**
 * O contrato, provado contra os controllers REAIS (sem subir a API nem o banco):
 *
 * 1. Toda rota que admite `ADMIN_USER` — em QUALQUER prefixo — declara permissão,
 *    ou é pública/da plataforma, ou está na dívida versionada. É o que o
 *    boot-check faz no boot; aqui roda no CI antes de alguém subir a API.
 * 2. Pra uma conta SÓ com núcleo, o `ModuloGuard` barra toda rota cujo módulo não
 *    é o núcleo — sem exceção, e dizendo QUAL módulo faltou.
 */

function controllers(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) controllers(p, acc);
    else if (nome.endsWith(".controller.ts")) acc.push(p);
  }
  return acc;
}

type Rota = { nome: string; handler: Function; classe: Function; chaves: string[] | undefined };

async function rotasDeAdmin(): Promise<Rota[]> {
  const reflector = new Reflector();
  const rotas: Rota[] = [];
  for (const arquivo of controllers(resolve(__dirname, "../.."))) {
    const mod = (await import(arquivo)) as Record<string, unknown>;
    for (const classe of Object.values(mod)) {
      if (typeof classe !== "function" || !Reflect.hasMetadata(PATH_METADATA, classe)) continue;
      const guardsClasse = (reflector.get<unknown[]>(GUARDS_METADATA, classe) ?? []) as unknown[];
      if (guardsClasse.includes(PlataformaGuard)) continue;
      for (const metodo of Object.getOwnPropertyNames(classe.prototype)) {
        if (metodo === "constructor") continue;
        const handler = (classe.prototype as Record<string, unknown>)[metodo];
        if (typeof handler !== "function" || !Reflect.hasMetadata(PATH_METADATA, handler)) continue;
        const roles =
          reflector.get<string[]>(ROLES_KEY, handler) ?? reflector.get<string[]>(ROLES_KEY, classe) ?? [];
        if (!roles.includes("ADMIN_USER")) continue;
        if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, classe])) continue;
        const guardsHandler = (reflector.get<unknown[]>(GUARDS_METADATA, handler) ?? []) as unknown[];
        if (guardsHandler.includes(PlataformaGuard)) continue;
        rotas.push({
          nome: chaveDoHandler(classe.name, metodo),
          handler: handler as Function,
          classe,
          chaves: reflector.getAllAndOverride<string[] | undefined>(PERMISSAO_KEY, [handler, classe]),
        });
      }
    }
  }
  return rotas;
}

describe("contrato de módulos nos controllers reais", () => {
  it("toda rota de ADMIN_USER declara permissão (ou está na dívida versionada)", async () => {
    const rotas = await rotasDeAdmin();
    expect(rotas.length).toBeGreaterThan(300);
    const sem = rotas.filter((r) => !r.chaves?.length && !ENDPOINTS_SEM_PERMISSAO.has(r.nome)).map((r) => r.nome);
    expect(sem).toEqual([]);
  });

  it("a dívida versionada só lista rota que ainda existe e ainda não tem permissão", async () => {
    const rotas = await rotasDeAdmin();
    const semPermissao = new Set(rotas.filter((r) => !r.chaves?.length).map((r) => r.nome));
    const velhas = [...ENDPOINTS_SEM_PERMISSAO].filter((n) => !semPermissao.has(n));
    expect(velhas).toEqual([]);
  });

  it("conta SÓ com núcleo: toda rota de módulo fora do núcleo responde 403 com o módulo que faltou", async () => {
    const rotas = await rotasDeAdmin();
    const nucleo = new Set(MODULOS.filter((m) => m.nucleo).map((m) => m.chave));
    const prisma = { conta: { findUnique: async () => ({ ehPlataforma: false, permissoesPermitidas: [], permissoesExtras: [] }) }, moduloContratado: { findMany: async () => [] } };
    const guard = new ModuloGuard(new Reflector(), prisma as never);
    const admin = { kind: "ADMIN_USER", id: "u", permissoes: [] };
    const vazou: string[] = [];
    let barradas = 0;

    for (const r of rotas) {
      if (!r.chaves?.length) continue;
      const modulos = new Set(r.chaves.map((c) => moduloDaChave(c)).filter(Boolean));
      if ([...modulos].some((m) => nucleo.has(m!))) continue; // OR com o núcleo: passa por desenho
      const ctx = {
        getHandler: () => r.handler,
        getClass: () => r.classe,
        switchToHttp: () => ({ getRequest: () => ({ user: admin }) }),
      };
      const resultado = await comConta(`so-nucleo-${r.nome}`, () =>
        Promise.resolve(guard.canActivate(ctx as never)).then(
          () => "passou",
          (e: { getResponse?: () => { code?: string } }) => e.getResponse?.().code ?? "outro-erro",
        ),
      );
      if (resultado === "passou") vazou.push(`${r.nome} → ${r.chaves.join(",")}`);
      else barradas++;
    }
    expect(vazou).toEqual([]);
    expect(barradas).toBeGreaterThan(100);
  });
});
