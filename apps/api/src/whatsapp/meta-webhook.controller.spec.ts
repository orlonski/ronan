import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { MetaWebhookController } from "./meta-webhook.controller";
import type { PrismaService } from "../prisma/prisma.service";
import type { ErrorsService } from "../errors/errors.service";
import type { ChatwootRepasseService } from "./chatwoot-repasse.service";
import type { ConferenciaAlcanceService } from "../admin/conferencia-diaria/conferencia-alcance.service";
import type { ConferenciaRespostaService } from "../admin/conferencia-diaria/conferencia-resposta.service";

const SEGREDO = "app-secret-de-teste";
const VERIFY = "verify-token-de-teste";

function controller(
  env: Record<string, string> = { META_APP_SECRET: SEGREDO, META_WEBHOOK_VERIFY_TOKEN: VERIFY },
  linha: { telefone: string; direcao: string; statusEntrega: string | null } | null = {
    telefone: "5542991088125",
    direcao: "SAIDA",
    statusEntrega: "sent",
  },
) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findFirst = vi.fn(async () => linha);
  const reportar = vi.fn(async (_input: { message: string; extra?: unknown }) => ({}));
  const repassar = vi.fn((_corpo: Buffer, _assinatura?: string) => {});
  const tratarMensagem = vi.fn(async (_m: unknown) => ({ tratada: false as const, motivo: "x" }));
  const aoEntregar = vi.fn(async (_t: string) => {});
  const aoFalhar = vi.fn(async (_t: string, _c: unknown) => true);
  const confFindFirst = vi.fn(async (_a: unknown) => null as unknown);
  const confUpdateMany = vi.fn(async (_a: unknown) => ({ count: 1 }));
  const confRaw = vi.fn(async (..._a: unknown[]) => 1);
  const c = new MetaWebhookController(
    { get: (k: string) => env[k] } as unknown as ConfigService,
    {
      whatsappMensagem: { updateMany, findFirst },
      conferenciaDiaria: { findFirst: confFindFirst, updateMany: confUpdateMany },
      $executeRaw: confRaw,
    } as unknown as PrismaService,
    { reportar } as unknown as ErrorsService,
    { repassar, configurado: () => true } as unknown as ChatwootRepasseService,
    { tratarMensagem } as unknown as ConferenciaRespostaService,
    { aoEntregar, aoFalhar } as unknown as ConferenciaAlcanceService,
  );
  return { c, confFindFirst, confUpdateMany, confRaw, updateMany, reportar, repassar, tratarMensagem, aoEntregar, aoFalhar };
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
      { reportar: vi.fn(async () => ({})) } as unknown as ErrorsService,
      { repassar: vi.fn(), configurado: () => false } as unknown as ChatwootRepasseService,
      { tratarMensagem: vi.fn() } as unknown as ConferenciaRespostaService,
      { aoEntregar: vi.fn(), aoFalhar: vi.fn() } as unknown as ConferenciaAlcanceService,
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

describe("status de template", () => {
  const enviarEvento = async (value: unknown) => {
    const { c, reportar } = controller();
    const body = { entry: [{ changes: [{ field: "message_template_status_update", value }] }] };
    const raw = Buffer.from(JSON.stringify(body));
    const hex = createHmac("sha256", SEGREDO).update(raw).digest("hex");
    const r = await c.receber(body as never, `sha256=${hex}`, {
      rawBody: raw,
    } as Request & { rawBody?: Buffer });
    return { r, reportar };
  };

  it("reprovação vira erro no painel, com o motivo da Meta", async () => {
    // Sem isto, template reprovado só aparece quando a mensagem tenta sair —
    // às 20h no cron, ou quando um motorista pede o código.
    const { reportar } = await enviarEvento({
      event: "REJECTED",
      message_template_name: "resumo_motorista",
      message_template_language: "pt_BR",
      reason: "INVALID_FORMAT",
    });
    expect(reportar).toHaveBeenCalledOnce();
    const arg = reportar.mock.calls[0]?.[0];
    expect(arg?.message).toContain("resumo_motorista");
    expect(arg?.message).toContain("REJECTED");
    expect((arg?.extra as { reason?: string })?.reason).toBe("INVALID_FORMAT");
  });

  it("aprovação não polui a tela de erros", async () => {
    const { reportar } = await enviarEvento({
      event: "APPROVED",
      message_template_name: "aviso_peso",
      message_template_language: "pt_BR",
    });
    expect(reportar).not.toHaveBeenCalled();
  });

  it("evento de template não é confundido com status de entrega", async () => {
    const { r, reportar } = await enviarEvento({
      event: "REJECTED",
      message_template_name: "x",
      statuses: [{ id: "wamid.NAO", status: "delivered" }],
    });
    expect(r).toBe("ok");
    expect(reportar).toHaveBeenCalledOnce();
  });
});

describe("repasse pro Chatwoot", () => {
  const enviar = async (body: unknown) => {
    const { c, repassar } = controller();
    const e = evento(body);
    const r = await c.receber(e.body as never, e.header, {
      rawBody: e.raw,
    } as Request & { rawBody?: Buffer });
    return { r, repassar, e };
  };

  it("repassa o corpo CRU e a assinatura", async () => {
    // Reserializar o JSON mudaria espaço e ordem de chave, e a assinatura que
    // o Chatwoot confere deixaria de bater.
    const { repassar, e } = await enviar({
      entry: [{ changes: [{ value: { messages: [{ id: "wamid.X", from: "5542988887777" }] } }] }],
    });
    expect(repassar).toHaveBeenCalledOnce();
    expect(repassar.mock.calls[0]?.[0]).toBe(e.raw);
    expect(repassar.mock.calls[0]?.[1]).toBe(e.header);
  });

  it("não repassa evento com assinatura inválida", async () => {
    // O repasse acontece DEPOIS de autenticar: senão a nossa URL viraria um
    // encaminhador aberto pra dentro do Chatwoot.
    const { c, repassar } = controller();
    const e = evento(STATUS(), { segredo: "outro-segredo" });
    await expect(
      c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).rejects.toThrow(UnauthorizedException);
    expect(repassar).not.toHaveBeenCalled();
  });
});

describe("alcance do número (conferência diária)", () => {
  const rodar = async (
    body: unknown,
    linha?: { telefone: string; direcao: string; statusEntrega: string | null } | null,
  ) => {
    const k = controller(undefined, linha);
    const e = evento(body);
    const r = await k.c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer });
    return { r, ...k };
  };

  it("delivered zera o contador do número", async () => {
    const { aoEntregar, aoFalhar } = await rodar(STATUS({ status: "delivered" }));
    expect(aoEntregar).toHaveBeenCalledWith("5542991088125");
    expect(aoFalhar).not.toHaveBeenCalled();
  });

  it("read também conta como entregue", async () => {
    const { aoEntregar } = await rodar(STATUS({ status: "read" }));
    expect(aoEntregar).toHaveBeenCalledOnce();
  });

  it("failed repassa o código pra allowlist decidir", async () => {
    const { aoFalhar } = await rodar(STATUS({ status: "failed", errors: [{ code: 131026 }] }));
    expect(aoFalhar).toHaveBeenCalledWith("5542991088125", 131026);
  });

  it("o mesmo status reenviado pela Meta não conta duas vezes", async () => {
    const { aoFalhar } = await rodar(STATUS({ status: "failed", errors: [{ code: 131026 }] }), {
      telefone: "5542991088125",
      direcao: "SAIDA",
      statusEntrega: "failed",
    });
    expect(aoFalhar).not.toHaveBeenCalled();
  });

  it("status de mensagem que não é nossa (sem linha) só é ignorado", async () => {
    const { r, aoEntregar } = await rodar(STATUS({ status: "delivered" }), null);
    expect(r).toBe("ok");
    expect(aoEntregar).not.toHaveBeenCalled();
  });

  it("erro no alcance não derruba o 200", async () => {
    const k = controller();
    k.aoEntregar.mockRejectedValueOnce(new Error("banco"));
    const e = evento(STATUS({ status: "delivered" }));
    await expect(
      k.c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).resolves.toBe("ok");
    expect(k.updateMany).toHaveBeenCalled();
  });
});

describe("resposta da conferência diária", () => {
  const rodar = async (messages: unknown[]) => {
    const k = controller();
    const body = { entry: [{ changes: [{ field: "messages", value: { messages } }] }] };
    const e = evento(body);
    const r = await k.c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer });
    return { r, ...k, e };
  };

  it("entrega cada mensagem ao serviço da conferência e SEMPRE repassa ao Chatwoot", async () => {
    const m = { id: "wamid.T", from: "554291088125", type: "button", button: { payload: "cv:x:PARAR", text: "Parar" } };
    const { r, tratarMensagem, repassar, e } = await rodar([m]);
    expect(r).toBe("ok");
    expect(tratarMensagem).toHaveBeenCalledWith(m);
    expect(repassar.mock.calls[0]?.[0]).toBe(e.raw);
  });

  it("falha na conferência responde 200 e as outras mensagens seguem", async () => {
    const k = controller();
    k.tratarMensagem.mockRejectedValueOnce(new Error("boom"));
    const body = {
      entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "a" }, { id: "b" }] } }] }],
    };
    const e = evento(body);
    await expect(
      k.c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).resolves.toBe("ok");
    expect(k.tratarMensagem).toHaveBeenCalledTimes(2);
  });
});

describe("avisos da conta (qualidade do número, restrição)", () => {
  const rodar = async (field: string, value: unknown) => {
    const k = controller();
    const e = evento({ entry: [{ changes: [{ field, value }] }] });
    const r = await k.c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer });
    return { r, ...k };
  };

  it("phone_number_quality_update vai pro ErrorLog", async () => {
    const { r, reportar } = await rodar("phone_number_quality_update", {
      display_phone_number: "554299999999",
      event: "DOWNGRADE",
      current_limit: "TIER_1K",
    });
    expect(r).toBe("ok");
    expect(reportar).toHaveBeenCalledOnce();
    expect(reportar.mock.calls[0]?.[0].message).toContain("phone_number_quality_update");
  });

  it("account_update vai pro ErrorLog", async () => {
    const { reportar } = await rodar("account_update", { event: "ACCOUNT_RESTRICTION" });
    expect(reportar).toHaveBeenCalledOnce();
  });

  it("erro ao reportar não derruba o 200", async () => {
    const k = controller();
    k.reportar.mockRejectedValueOnce(new Error("banco"));
    const e = evento({ entry: [{ changes: [{ field: "account_update", value: { event: "X" } }] }] });
    await expect(
      k.c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer }),
    ).resolves.toBe("ok");
  });
});

describe("recibo da Meta na conferência + categoria do template", () => {
  const enviar = (c: MetaWebhookController, e: ReturnType<typeof evento>) =>
    c.receber(e.body as never, e.header, { rawBody: e.raw } as Request & { rawBody?: Buffer });

  it("status com wamid da conferência anexa o STATUS à trilha da linha (com o contaId dela)", async () => {
    const { c, confFindFirst, confRaw } = controller();
    confFindFirst.mockResolvedValueOnce({ id: "L1", contaId: "conta-A", trilha: [], wamid: "wamid.ABC", lembreteWamid: null });
    await enviar(c, evento(STATUS({ status: "delivered", timestamp: "1790000000" })));
    expect(confRaw).toHaveBeenCalledOnce();
    const args = confRaw.mock.calls[0]!;
    expect(args.slice(-2)).toEqual(["L1", "conta-A"]);
    expect(JSON.parse(args[1] as string)).toMatchObject({ evento: "STATUS", detalhe: { status: "delivered", alvo: "PERGUNTA" } });
  });

  it("failed 131049 grava erroEnvio e devolve 200 mesmo se o wamid é desconhecido", async () => {
    const { c, confFindFirst, confUpdateMany, confRaw } = controller();
    const falha = { status: "failed", errors: [{ code: 131049, title: "Undeliverable", message: "marketing limit" }] };
    confFindFirst.mockResolvedValueOnce({ id: "L1", contaId: "conta-A", trilha: [], wamid: "wamid.ABC", lembreteWamid: null });
    await enviar(c, evento(STATUS(falha)));
    expect(confUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "L1", contaId: "conta-A" } }));
    confRaw.mockClear();
    await expect(enviar(c, evento(STATUS(falha)))).resolves.toBe("ok");
    expect(confRaw).not.toHaveBeenCalled();
  });

  it("template_category_update UTILITY -> MARKETING vai pro ErrorLog; o inverso não", async () => {
    const { c, reportar } = controller();
    const cat = (previous_category: string, new_category: string) => ({
      entry: [{ changes: [{ field: "template_category_update", value: { message_template_name: "conferencia_diaria", message_template_language: "pt_BR", previous_category, new_category } }] }],
    });
    await enviar(c, evento(cat("UTILITY", "MARKETING")));
    expect(reportar).toHaveBeenCalledOnce();
    expect(reportar.mock.calls[0]![0].message).toContain("conferencia_diaria");
    reportar.mockClear();
    await enviar(c, evento(cat("MARKETING", "UTILITY")));
    expect(reportar).not.toHaveBeenCalled();
  });
});
