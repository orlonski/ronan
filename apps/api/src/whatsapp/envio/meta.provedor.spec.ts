import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { MetaProvedor } from "./meta.provedor";
import type { EnvioWhatsapp } from "./envio.types";

const ENV: Record<string, string> = {
  META_WHATSAPP_TOKEN: "TOKEN",
  META_WHATSAPP_PHONE_NUMBER_ID: "999",
};

function provedor(env = ENV) {
  return new MetaProvedor({ get: (k: string) => env[k] } as unknown as ConfigService);
}

/** Devolve o corpo JSON que o provedor mandou pra Graph API. */
function corpoEnviado(fetchMock: ReturnType<typeof vi.fn>): Record<string, any> {
  return JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
}

function respondeCom(status: number, json: unknown) {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => json }));
}

const OK = { messages: [{ id: "wamid.ABC" }] };

/**
 * Envio padrão: rota SEM template, pra os testes de transporte chegarem na
 * rede. Rota com template exige os params certos e falha antes disso — que é o
 * comportamento desejado, testado em "payload que a Meta recusaria".
 */
const envio = (over: Partial<EnvioWhatsapp> = {}): EnvioWhatsapp => ({
  destino: { tipo: "TELEFONE", numero: "5541999998888" },
  rota: "RESPOSTA_AGENTE",
  texto: "oi",
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = respondeCom(200, OK);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("MetaProvedor.configurado", () => {
  it("falso sem token ou sem phone number id", () => {
    expect(provedor({}).configurado()).toBe(false);
    expect(provedor({ META_WHATSAPP_TOKEN: "T" }).configurado()).toBe(false);
    expect(provedor().configurado()).toBe(true);
  });
});

describe("template de autenticação", () => {
  /**
   * O caso que mais dói errar: o envio manda `[nomeConta, codigo, ttl]` porque
   * é o que o texto do Evolution usa, mas o corpo do template de autenticação é
   * FIXO pela Meta e só cabe o código. Índice errado aqui manda o NOME DA
   * EMPRESA como se fosse o código — e o motorista não entra no app.
   */
  it("manda só o código, e o mesmo código no botão de copiar", async () => {
    await provedor().enviar(
      envio({ rota: "OTP_CADASTRO", params: ["Schaba", "123456", "10"] }),
    );
    const c = corpoEnviado(fetchMock);
    expect(c.type).toBe("template");
    expect(c.template.name).toBe("otp_cadastro");
    expect(c.template.components[0].parameters).toEqual([{ type: "text", text: "123456" }]);
    expect(c.template.components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "123456" }],
    });
  });

  it("OTP_SENHA tem o código na posição 0, não na 1", async () => {
    await provedor().enviar(envio({ rota: "OTP_SENHA", params: ["654321", "10"] }));
    const c = corpoEnviado(fetchMock);
    expect(c.template.components[0].parameters).toEqual([{ type: "text", text: "654321" }]);
  });
});

describe("rota sem template", () => {
  it("vai como texto livre — que só chega dentro da janela de 24h", async () => {
    await provedor().enviar(envio({ rota: "RESPOSTA_AGENTE", texto: "beleza!" }));
    const c = corpoEnviado(fetchMock);
    expect(c.type).toBe("text");
    expect(c.text.body).toBe("beleza!");
  });
});

describe("payload que a Meta recusaria", () => {
  it("param faltando falha ANTES da rede, dizendo qual", async () => {
    const r = await provedor().enviar(envio({ rota: "OTP_SENHA", params: [] }));
    expect(r.enviado).toBe(false);
    expect(r.erro?.codigo).toBe("PAYLOAD_INVALIDO");
    expect(r.erro?.detalhe).toContain("params[0]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("param com quebra de linha falha ANTES da rede", async () => {
    const r = await provedor().enviar(
      envio({ rota: "AVISO_PESO", params: ["2 viagens", "Cliente A\nCliente B"] }),
    );
    expect(r.enviado).toBe(false);
    expect(r.erro?.detalhe).toContain("achatarParam");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("grupo", () => {
  it("é recusado com o motivo, não com um erro cru da Meta", async () => {
    const r = await provedor().enviar(
      envio({ destino: { tipo: "GRUPO", jid: "12036@g.us" }, rota: "AVISO_GRUPO" }),
    );
    expect(r.erro?.codigo).toBe("GRUPO_NAO_SUPORTADO");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("classificação do erro", () => {
  /**
   * A distinção existe pra uma regra só: fallback pro Evolution é aceitável em
   * falha de TRANSPORTE e nunca em falha de POLÍTICA. Desviar pro Evolution
   * porque a Meta recusou é usar de propósito o canal que fez o número cair.
   */
  it("5xx é transporte", async () => {
    vi.stubGlobal("fetch", respondeCom(503, { error: { message: "instável", code: 1 } }));
    const r = await provedor().enviar(envio());
    expect(r.erro?.tipo).toBe("TRANSPORTE");
  });

  it("janela de 24h expirada é política", async () => {
    vi.stubGlobal("fetch", respondeCom(400, { error: { message: "Re-engagement", code: 131047 } }));
    const r = await provedor().enviar(envio());
    expect(r.erro).toMatchObject({ tipo: "POLITICA", codigo: "META_131047" });
  });

  it("rede caindo é transporte", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const r = await provedor().enviar(envio());
    expect(r.erro).toMatchObject({ tipo: "TRANSPORTE", codigo: "META_INDISPONIVEL" });
  });

  it("200 sem wamid não conta como enviado", async () => {
    vi.stubGlobal("fetch", respondeCom(200, { messages: [] }));
    const r = await provedor().enviar(envio());
    expect(r.enviado).toBe(false);
    expect(r.erro?.codigo).toBe("META_SEM_WAMID");
  });
});

describe("aceite", () => {
  it("o wamid é a prova, e vira idExterno", async () => {
    const r = await provedor().enviar(envio());
    expect(r).toMatchObject({ enviado: true, provedor: "meta", idExterno: "wamid.ABC" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://graph.facebook.com/v25.0/999/messages");
  });

  it("respeita META_GRAPH_VERSION — a Meta quebra em major", async () => {
    await provedor({ ...ENV, META_GRAPH_VERSION: "v25.0" }).enviar(envio());
    expect(fetchMock.mock.calls[0]![0]).toContain("/v25.0/");
  });
});
