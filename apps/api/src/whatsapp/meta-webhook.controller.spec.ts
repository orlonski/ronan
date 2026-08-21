import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { MetaWebhookController } from "./meta-webhook.controller";
import type { PrismaService } from "../prisma/prisma.service";

const SEGREDO = "app-secret-de-teste";
const VERIFY = "verify-token-de-teste";

function controller(env: Record<string, string> = { META_APP_SECRET: SEGREDO, META_WEBHOOK_VERIFY_TOKEN: VERIFY }) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const c = new MetaWebhookController(
    { get: (k: string) => env[k] } as unknown as ConfigService,
    { whatsappMensagem: { updateMany } } as unknown as PrismaService,
  );
  return { c, updateMany };
}

/** Monta o POST como a Meta monta: corpo cru + assinatura hex do HMAC dele. */
function evento(body: unknown, opts: { segredo?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const hex = createHmac("sha256", opts.segredo ?? SEGREDO).update(raw).digest("hex");
  return { body, raw, header: `sha256=${hex}` };
}

const STATUS = (over: Record<string, unknown> = {}) => ({
  entry: [{ changes: [{ value: { statuses: [{ id: "wamid.ABC", status: "delivered", ...over }] } }] }],
});

describe("handshake de verificação", () => {
  it("devolve o challenge CRU quando o token confere", () => {
    // Com aspas de JSON em volta a Meta recusa a URL: ela compara byte a byte.
    const { c } = controller();
    expect(c.verificar("subscribe", VERIFY, "1158201444")).toBe("1158201444");
  });

  it("recusa token errado", () => {
    const { c } = controller();
    expect(() => c.verificar("subscribe", "chutado", "123")).toThrow(UnauthorizedException);
  });

  it("recusa quando o verify token não está configurado", () => {
    // Sem env var, aceitar qualquer coisa deixaria um estranho registrar o
    // webhook dele no lugar do nosso.
    const { c } = controller({});
    expect(() => c.verificar("subscribe", "qualquer", "123")).toThrow(UnauthorizedException);
  });

  it("recusa modo diferente de subscribe", () => {
    const { c } = controller();
    expect(() => c.verificar("unsubscribe", VERIFY, "123")).toThrow(UnauthorizedException);
  });
});

describe("assinatura do evento", () => {
  it("aceita corpo assinado com o app secret", async () => {
    const { c, updateMany } = controller();
    const e = evento(STATUS());
    await expect(
      c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).resolves.toBe("ok");
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("recusa corpo assinado com outro segredo", async () => {
    const { c, updateMany } = controller();
    const e = evento(STATUS(), { segredo: "segredo-do-atacante" });
    await expect(
      c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).rejects.toThrow(UnauthorizedException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa sem o header de assinatura", async () => {
    const { c } = controller();
    const e = evento(STATUS());
    await expect(
      c.receber(e.body as never, undefined, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("recusa quando o corpo cru não chegou", async () => {
    // É o sintoma de o `verify` do json() ter sido removido do main.ts. Aceitar
    // sem validar seria pior que recusar: o endpoint é público.
    const { c } = controller();
    const e = evento(STATUS());
    await expect(c.receber(e.body as never, e.header, {} as Request)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("assinatura tem que ser do corpo CRU, não do JSON reserializado", async () => {
    // Reserializar muda espaço e ordem de chave. Este teste morre se alguém
    // trocar `req.rawBody` por `JSON.stringify(body)`.
    const { c } = controller();
    const raw = Buffer.from('{"entry":[  {"changes":[]}  ]}');
    const hex = createHmac("sha256", SEGREDO).update(raw).digest("hex");
    await expect(
      c.receber(JSON.parse(raw.toString()) as never, `sha256=${hex}`, {
        rawBody: raw,
      } as Request & { rawBody?: Buffer }),
    ).resolves.toBe("ok");
  });
});

describe("status de entrega", () => {
  const enviar = async (body: unknown) => {
    const { c, updateMany } = controller();
    const e = evento(body);
    const r = await c.receber(e.body as never, e.header, {
      rawBody: e.raw,
    } as Request & { rawBody?: Buffer });
    return { r, updateMany };
  };

  it("grava o status pela wamid", async () => {
    const { updateMany } = await enviar(STATUS());
    expect(updateMany).toHaveBeenCalledWith({
      where: { idExterno: "wamid.ABC" },
      data: { statusEntrega: "delivered", erroCodigo: null },
    });
  });

  it("guarda o código do erro quando falha", async () => {
    // 131047 (janela expirada) e 131026 (número sem WhatsApp) pedem respostas
    // opostas. Sem o código, as duas viram "não entregou".
    const { updateMany } = await enviar(
      STATUS({ status: "failed", errors: [{ code: 131047, title: "Re-engagement" }] }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { idExterno: "wamid.ABC" },
      data: { statusEntrega: "failed", erroCodigo: "131047" },
    });
  });

  it("erro ao gravar ainda responde 200", async () => {
    // A Meta desliga o webhook depois de muita resposta não-200 seguida. Um
    // banco fora do ar não pode custar o webhook inteiro.
    const c = new MetaWebhookController(
      { get: (k: string) => ({ META_APP_SECRET: SEGREDO })[k] } as unknown as ConfigService,
      {
        whatsappMensagem: {
          updateMany: vi.fn(async () => {
            throw new Error("banco fora do ar");
          }),
        },
      } as unknown as PrismaService,
    );
    const e = evento(STATUS());
    await expect(
      c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).resolves.toBe("ok");
  });

  it("evento sem status nenhum não quebra", async () => {
    const { r } = await enviar({ entry: [{ changes: [{ value: { messages: [{ id: "x" }] } }] }] });
    expect(r).toBe("ok");
  });
});
