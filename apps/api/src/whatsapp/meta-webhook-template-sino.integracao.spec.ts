import "reflect-metadata";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { comConta, comoSistema } from "../common/conta/conta-context";
import type { PrismaService } from "../prisma/prisma.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { TEMPLATES_CANDIDATOS_WHATSAPP, type TemplateCandidatoWhatsappDef } from "@ronan/shared-types";
import { MetaWebhookController } from "./meta-webhook.controller";

/**
 * Integração com Prisma REAL (banco descartável). Prova que o filtro JSON
 * `dados.path ["chave"]` do aviso de template funciona no Postgres de verdade —
 * se lançasse, o try/catch engoliria e o aviso se perderia em silêncio.
 * Só roda com `CONFERENCIA_TESTE_DATABASE_URL` (banco novo com migrations).
 */
const URL_TESTE = process.env.CONFERENCIA_TESTE_DATABASE_URL;
const SEGREDO = "segredo-integracao";
const SUF = Date.now().toString(36);
const CAND = "template_candidato_ficticio";

describe.skipIf(!URL_TESTE)("aviso de template no sino — Prisma real", () => {
  let prisma: PrismaService;
  let c: MetaWebhookController;
  let casa: string;
  let outra: string;
  let userCasa: string;

  const enviar = (field: string, value: unknown) => {
    const body = { entry: [{ changes: [{ field, value }] }] };
    const raw = Buffer.from(JSON.stringify(body));
    const hex = createHmac("sha256", SEGREDO).update(raw).digest("hex");
    return c.receber(body as never, `sha256=${hex}`, { rawBody: raw } as Request & { rawBody?: Buffer });
  };
  const status = (event: string, nome: string, reason?: string) =>
    enviar("message_template_status_update", { event, message_template_name: nome, message_template_language: "pt_BR", reason });
  const avisos = () =>
    comoSistema(() => prisma.adminNotificacao.findMany({ where: { tipo: "template-whatsapp" }, orderBy: { criadoEm: "asc" } }));

  beforeAll(async () => {
    // Registro vazio de propósito (troca de 01/10/2026): candidato FICTÍCIO só no teste.
    (TEMPLATES_CANDIDATOS_WHATSAPP as Record<string, TemplateCandidatoWhatsappDef>).CANDIDATO_FICTICIO = {
      nome: CAND,
      idioma: "pt_BR",
      substitui: "CONVITE_EMPRESA",
      categoria: "utility",
      corpo: [0, 1],
      textoAprovacao: "Texto fictício {{1}} e {{2}}. Fim.",
      exemplo: ["a", "b"],
    };
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    c = new MetaWebhookController(
      { get: (k: string) => ({ META_APP_SECRET: SEGREDO })[k] } as never,
      prisma,
      { reportar: vi.fn(async () => ({})) } as never,
      { repassar: vi.fn(), configurado: () => false } as never,
      { tratarMensagem: vi.fn() } as never,
      { aoEntregar: vi.fn(), aoFalhar: vi.fn() } as never,
      new AdminInboxService(prisma),
    );
    // As migrations já semeiam uma conta da plataforma; o banco é descartável,
    // então desmarca pra provar o caso "sem plataforma" e criar a nossa depois.
    await comoSistema(() => prisma.conta.updateMany({ data: { ehPlataforma: false } }));
    outra = (await comoSistema(() => prisma.conta.create({ data: { nome: "outra", slug: `outra-${SUF}` } }))).id;
  });

  afterAll(async () => {
    delete (TEMPLATES_CANDIDATOS_WHATSAPP as Record<string, TemplateCandidatoWhatsappDef>).CANDIDATO_FICTICIO;
    await prisma?.$disconnect();
  });

  it("(4) sem conta da plataforma não quebra e não avisa", async () => {
    await expect(status("APPROVED", CAND)).resolves.toBe("ok");
    expect(await avisos()).toHaveLength(0);
  });

  it("(1) aprovação de candidato nasce na conta da plataforma, só pra quem tem whatsapp.ver", async () => {
    casa = (await comoSistema(() => prisma.conta.create({ data: { nome: "casa", slug: `casa-${SUF}`, ehPlataforma: true } }))).id;
    const mk = async (contaId: string, email: string, permissoes: string[]) => {
      const papel = await comConta(contaId, () => prisma.papel.create({ data: { nome: `p-${email}`, permissoes } }));
      return (await comConta(contaId, () => prisma.user.create({ data: { nome: email, email: `${email}-${SUF}@t.com`, senhaHash: "x", papelId: papel.id } }))).id;
    };
    userCasa = await mk(casa, "com", ["whatsapp.ver"]);
    await mk(casa, "sem", ["viagens.ver"]);
    await mk(outra, "outraconta", ["whatsapp.ver"]);

    await status("APPROVED", CAND);
    const lista = await avisos();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ usuarioId: userCasa, contaId: casa });
    expect(lista[0]!.corpo).toContain(CAND);
    expect((lista[0]!.dados as { chave: string }).chave).toBe(`status:${CAND}:APPROVED`);
  });

  it("(2) o mesmo evento reenviado não duplica", async () => {
    await status("APPROVED", CAND);
    await status("APPROVED", CAND);
    expect(await avisos()).toHaveLength(1);
  });

  it("(3) outro estado e outro nome avisam; não candidato continua mudo", async () => {
    await status("REJECTED", CAND, "INVALID_FORMAT");
    // v2 de convite/cobrança agora são templates de rota (não candidatos): mudos.
    await status("APPROVED", "convite_empresa_v2");
    await status("APPROVED", "cobranca_autorizacao_pix_link_v2");
    await status("APPROVED", "aviso_peso");
    await enviar("template_category_update", { message_template_name: "conferencia_diaria", previous_category: "UTILITY", new_category: "MARKETING" });
    await enviar("template_category_update", { message_template_name: "conferencia_diaria", previous_category: "UTILITY", new_category: "MARKETING" });
    const chaves = (await avisos()).map((n) => (n.dados as { chave: string }).chave).sort();
    const esperado = [
      "categoria:conferencia_diaria:MARKETING",
      `status:${CAND}:APPROVED`,
      `status:${CAND}:REJECTED`,
    ].sort();
    expect(chaves).toEqual(esperado);
  });
});
