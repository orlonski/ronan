import { describe, expect, it, vi } from "vitest";
import { ClienteHttp, RespostaHttpError } from "./cliente-http";

/** Resposta falsa mínima, com o que o cliente lê. */
function resposta(status: number, corpo: unknown = {}, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  } as unknown as Response;
}

/** Não espera de verdade, mas registra quanto teria esperado. */
function relogio() {
  const esperas: number[] = [];
  return { esperas, dormir: async (ms: number) => void esperas.push(ms) };
}

describe("ClienteHttp", () => {
  it("devolve o JSON no caminho feliz", async () => {
    const buscar = vi.fn().mockResolvedValue(resposta(200, { razao_social: "X LTDA" }));
    const c = new ClienteHttp({ buscar, dormir: relogio().dormir });

    expect(await c.obterJson<{ razao_social: string }>("https://api.x/cnpj/1")).toEqual({
      razao_social: "X LTDA",
    });
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("404 vira null, não exceção — 'não achei' é resposta válida", async () => {
    const buscar = vi.fn().mockResolvedValue(resposta(404));
    const c = new ClienteHttp({ buscar, dormir: relogio().dormir });

    expect(await c.obterJson("https://api.x/cnpj/1")).toBeNull();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("tenta de novo em 429 e entrega quando o servidor libera", async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(resposta(429))
      .mockResolvedValueOnce(resposta(200, { ok: true }));
    const c = new ClienteHttp({ buscar, dormir: relogio().dormir });

    expect(await c.obterJson("https://api.x/1")).toEqual({ ok: true });
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("respeita o Retry-After quando o servidor manda", async () => {
    const r = relogio();
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(resposta(429, {}, { "retry-after": "5" }))
      .mockResolvedValueOnce(resposta(200, {}));
    const c = new ClienteHttp({ buscar, dormir: r.dormir, intervaloMs: 0 });

    await c.obterJson("https://api.x/1");
    expect(r.esperas).toContain(5000);
  });

  it("NÃO tenta de novo em 400 — repetir só gasta a cota", async () => {
    const buscar = vi.fn().mockResolvedValue(resposta(400, { erro: "cnpj inválido" }));
    const c = new ClienteHttp({ buscar, dormir: relogio().dormir });

    await expect(c.obterJson("https://api.x/1")).rejects.toBeInstanceOf(RespostaHttpError);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("desiste depois do número de tentativas e propaga o erro", async () => {
    const buscar = vi.fn().mockResolvedValue(resposta(503));
    const c = new ClienteHttp({ buscar, dormir: relogio().dormir, tentativas: 3 });

    await expect(c.obterJson("https://api.x/1")).rejects.toBeInstanceOf(RespostaHttpError);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it("tenta de novo em erro de rede", async () => {
    const buscar = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(resposta(200, { ok: 1 }));
    const c = new ClienteHttp({ buscar, dormir: relogio().dormir });

    expect(await c.obterJson("https://api.x/1")).toEqual({ ok: 1 });
  });

  it("serializa as chamadas do mesmo host — nunca duas ao mesmo tempo", async () => {
    let simultaneas = 0;
    let pico = 0;
    const buscar = vi.fn().mockImplementation(async () => {
      simultaneas++;
      pico = Math.max(pico, simultaneas);
      await new Promise((r) => setTimeout(r, 5));
      simultaneas--;
      return resposta(200, {});
    });

    const c = new ClienteHttp({ buscar, dormir: async () => {}, intervaloMs: 0 });
    await Promise.all([
      c.obterJson("https://api.x/1"),
      c.obterJson("https://api.x/2"),
      c.obterJson("https://api.x/3"),
    ]);

    expect(pico).toBe(1);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it("espera o intervalo entre chamadas do mesmo host", async () => {
    const r = relogio();
    const buscar = vi.fn().mockResolvedValue(resposta(200, {}));
    const c = new ClienteHttp({ buscar, dormir: r.dormir, intervaloMs: 1000 });

    await c.obterJson("https://api.x/1");
    await c.obterJson("https://api.x/2");

    expect(r.esperas.filter((e) => e === 1000)).toHaveLength(2);
  });

  it("uma chamada que falha não trava a fila do host", async () => {
    const buscar = vi
      .fn()
      .mockRejectedValueOnce(new Error("caiu"))
      .mockRejectedValueOnce(new Error("caiu"))
      .mockRejectedValueOnce(new Error("caiu"))
      .mockResolvedValue(resposta(200, { depois: true }));

    const c = new ClienteHttp({ buscar, dormir: async () => {}, intervaloMs: 0, tentativas: 3 });

    await expect(c.obterJson("https://api.x/1")).rejects.toThrow();
    // A seguinte precisa funcionar normalmente.
    expect(await c.obterJson("https://api.x/2")).toEqual({ depois: true });
  });

  it("hosts diferentes não competem pela mesma fila", async () => {
    const ordem: string[] = [];
    const buscar = vi.fn().mockImplementation(async (url: string) => {
      ordem.push(url);
      return resposta(200, {});
    });
    const c = new ClienteHttp({ buscar, dormir: async () => {}, intervaloMs: 0 });

    await Promise.all([c.obterJson("https://a.x/1"), c.obterJson("https://b.x/1")]);
    expect(ordem).toHaveLength(2);
  });
});
