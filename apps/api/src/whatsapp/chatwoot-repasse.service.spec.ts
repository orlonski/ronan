import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { ChatwootRepasseService } from "./chatwoot-repasse.service";

const TRANSACIONAL = "1231832726688475";
const COMERCIAL = "9999999999";
const URL_T = "https://atendimento.movatruck.com.br/webhooks/whatsapp/+5542984223261";
const URL_C = "https://atendimento.movatruck.com.br/webhooks/whatsapp/+5542991563750";

function servico(env: Record<string, string>) {
  return new ChatwootRepasseService({ get: (k: string) => env[k] } as unknown as ConfigService);
}

/** As URLs que o repasse chamou, na ordem. */
function urlsChamadas(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c) => c[0] as string);
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** O repasse dispara sem `await` de propósito; os testes esperam a microtask. */
const assentar = () => new Promise((r) => setTimeout(r, 0));

describe("um número só (como era antes)", () => {
  it("sem mapa, tudo vai pra URL única", async () => {
    servico({ CHATWOOT_WEBHOOK_URL: URL_T }).repassar(Buffer.from("{}"), "sha", [TRANSACIONAL]);
    await assentar();
    expect(urlsChamadas(fetchMock)).toEqual([URL_T]);
  });

  it("sem nada configurado, não toca a rede", async () => {
    servico({}).repassar(Buffer.from("{}"), "sha", [TRANSACIONAL]);
    await assentar();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("dois números", () => {
  const ENV = {
    CHATWOOT_WEBHOOK_URLS: `${TRANSACIONAL}=${URL_T}, ${COMERCIAL}=${URL_C}`,
  };

  it("cada número cai no inbox dele", async () => {
    servico(ENV).repassar(Buffer.from("{}"), "sha", [COMERCIAL]);
    await assentar();
    expect(urlsChamadas(fetchMock)).toEqual([URL_C]);
  });

  it("evento com os dois números entrega uma vez em cada inbox", async () => {
    servico(ENV).repassar(Buffer.from("{}"), "sha", [TRANSACIONAL, COMERCIAL]);
    await assentar();
    expect(urlsChamadas(fetchMock).sort()).toEqual([URL_C, URL_T].sort());
  });

  it("número fora do mapa não é entregue em lugar nenhum", async () => {
    servico(ENV).repassar(Buffer.from("{}"), "sha", ["000"]);
    await assentar();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o mapa vence a URL única — nada vaza pro inbox errado", async () => {
    servico({ ...ENV, CHATWOOT_WEBHOOK_URL: URL_T }).repassar(Buffer.from("{}"), "sha", ["000"]);
    await assentar();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o corpo vai cru e a assinatura junto", async () => {
    const corpo = Buffer.from('{"entry":[]}');
    servico(ENV).repassar(corpo, "sha256=abc", [COMERCIAL]);
    await assentar();
    const opts = fetchMock.mock.calls[0]![1] as { body: Buffer; headers: Record<string, string> };
    expect(opts.body).toBe(corpo);
    expect(opts.headers["X-Hub-Signature-256"]).toBe("sha256=abc");
  });

  it("par torto no mapa não derruba o resto", async () => {
    servico({ CHATWOOT_WEBHOOK_URLS: `lixo,,${COMERCIAL}=${URL_C}` }).repassar(
      Buffer.from("{}"),
      "sha",
      [COMERCIAL],
    );
    await assentar();
    expect(urlsChamadas(fetchMock)).toEqual([URL_C]);
  });
});
