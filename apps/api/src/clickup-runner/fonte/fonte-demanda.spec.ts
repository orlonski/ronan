import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickupFonteDemanda } from "./clickup.fonte";
import { PayloadFonteDemanda } from "./payload.fonte";
import { criarFonte } from "../agente-worker.module";
import type { RunnerConfig } from "../runner.config";

const job = { id: "job-1", taskId: "abc", tentativas: 0 };

function config(over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    clickupToken: "pk_123",
    clickupApiUrl: "https://api.clickup.com/api/v2",
    ...over,
  } as RunnerConfig;
}

afterEach(() => vi.unstubAllGlobals());

describe("criarFonte", () => {
  it("registra o provider pedido", () => {
    expect(criarFonte(config({ fonte: "clickup" }))).toBeInstanceOf(ClickupFonteDemanda);
    expect(criarFonte(config({ fonte: "payload" }))).toBeInstanceOf(PayloadFonteDemanda);
  });

  it("explode no boot com fonte desconhecida", () => {
    expect(() => criarFonte(config({ fonte: "jira" }))).toThrow(/desconhecida/);
  });
});

describe("ClickupFonteDemanda.ler", () => {
  it("traz título e descrição da task", async () => {
    const fetchFake = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "Corrigir filtros",
        description: "descrição em markdown",
        url: "https://app.clickup.com/t/abc",
      }),
    });
    vi.stubGlobal("fetch", fetchFake);

    const demanda = await new ClickupFonteDemanda(config()).ler("abc", {});

    expect(demanda).toEqual({
      titulo: "Corrigir filtros",
      descricao: "descrição em markdown",
      url: "https://app.clickup.com/t/abc",
    });
    expect(fetchFake.mock.calls[0]![0]).toBe("https://api.clickup.com/api/v2/task/abc");
  });

  it("aceita task sem descrição (título já é demanda)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "Só o título" }) }),
    );

    const demanda = await new ClickupFonteDemanda(config()).ler("abc", {});

    expect(demanda.titulo).toBe("Só o título");
    expect(demanda.descricao).toBe("");
  });

  it("estoura quando o ClickUp recusa (vira falha de infra no worker)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" }),
    );

    await expect(new ClickupFonteDemanda(config()).ler("abc", {})).rejects.toThrow(/404/);
  });

  it("estoura sem token, em vez de seguir com demanda vazia", async () => {
    const fetchFake = vi.fn();
    vi.stubGlobal("fetch", fetchFake);

    await expect(
      new ClickupFonteDemanda(config({ clickupToken: "" })).ler("abc", {}),
    ).rejects.toThrow(/CLICKUP_API_TOKEN/);
    expect(fetchFake).not.toHaveBeenCalled();
  });
});

describe("ClickupFonteDemanda.reportar", () => {
  it("publica o comentário na API v2", async () => {
    const fetchFake = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchFake);

    const ok = await new ClickupFonteDemanda(config()).reportar(
      "abc",
      { status: "CONCLUIDA", resumo: "feito" },
      { job, duracaoMs: 1_000 },
    );

    expect(ok).toBe(true);
    const [url, init] = fetchFake.mock.calls[0]!;
    expect(url).toBe("https://api.clickup.com/api/v2/task/abc/comment");
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe("pk_123");
    expect((init as { body: string }).body).toContain("feito");
  });

  it("tenta de novo e desiste sem explodir quando o ClickUp recusa", async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => "erro" });
    vi.stubGlobal("fetch", fetchFake);

    const ok = await new ClickupFonteDemanda(config()).reportar(
      "abc",
      { status: "FALHOU", resumo: "x" },
      { job, duracaoMs: 10 },
    );

    expect(ok).toBe(false);
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });
});

describe("PayloadFonteDemanda", () => {
  const fonte = new PayloadFonteDemanda();

  it("lê titulo/descricao do corpo do webhook (caminho do Postman)", async () => {
    const demanda = await fonte.ler("abc", { titulo: "Fazer X", descricao: "detalhe" });
    expect(demanda).toEqual({ titulo: "Fazer X", descricao: "detalhe" });
  });

  it("aceita as variantes em inglês e aninhadas em task", async () => {
    expect((await fonte.ler("abc", { title: "T", description: "D" })).titulo).toBe("T");
    expect((await fonte.ler("abc", { task: { name: "T2", description: "D2" } })).descricao).toBe(
      "D2",
    );
  });

  it("estoura com payload vazio, dizendo o que mandar", async () => {
    await expect(fonte.ler("abc", {})).rejects.toThrow(/titulo/);
  });

  it("reporta no log e não faz chamada externa nenhuma", async () => {
    const fetchFake = vi.fn();
    vi.stubGlobal("fetch", fetchFake);

    const ok = await fonte.reportar(
      "abc",
      { status: "CONCLUIDA", resumo: "feito" },
      { job, duracaoMs: 5 },
    );

    expect(ok).toBe(true);
    expect(fetchFake).not.toHaveBeenCalled();
  });
});
