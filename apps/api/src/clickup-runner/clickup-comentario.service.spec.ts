import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickupComentarioService, montarComentario } from "./clickup-comentario.service";
import type { RunnerConfig } from "./runner.config";

const job = { id: "job-1", taskId: "abc", tentativas: 0 };

function config(over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    clickupToken: "pk_123",
    clickupApiUrl: "https://api.clickup.com/api/v2",
    ...over,
  } as RunnerConfig;
}

afterEach(() => vi.unstubAllGlobals());

describe("montarComentario", () => {
  it("traz status, resumo, arquivos, branch, duração e custo", () => {
    const texto = montarComentario(
      job,
      {
        status: "CONCLUIDA",
        resumo: "ajustei o filtro",
        arquivosAlterados: ["src/a.ts", "src/b.ts"],
        branch: "feat/abc",
        custoUsd: 1.234,
        exitCode: 0,
      },
      2_500,
    );

    expect(texto).toContain("✅ Concluída");
    expect(texto).toContain("ajustei o filtro");
    expect(texto).toContain("`src/a.ts`");
    expect(texto).toContain("`feat/abc`");
    expect(texto).toContain("2.5s");
    expect(texto).toContain("US$ 1.23");
    expect(texto).toContain("job-1");
  });

  it("diz explicitamente quando não mudou arquivo nenhum", () => {
    const texto = montarComentario(job, { status: "CONCLUIDA", resumo: "nada a fazer" }, 100);
    expect(texto).toContain("nenhum");
  });

  it("resume a lista quando são muitos arquivos", () => {
    const arquivos = Array.from({ length: 45 }, (_, i) => `src/f${i}.ts`);
    const texto = montarComentario(
      job,
      { status: "CONCLUIDA", resumo: "grande", arquivosAlterados: arquivos },
      100,
    );
    expect(texto).toContain("e mais 5");
  });
});

describe("ClickupComentarioService.comentar", () => {
  it("publica na API v2 com o token no header", async () => {
    const fetchFake = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchFake);

    const ok = await new ClickupComentarioService(config()).comentar("abc", "texto");

    expect(ok).toBe(true);
    const [url, init] = fetchFake.mock.calls[0]!;
    expect(url).toBe("https://api.clickup.com/api/v2/task/abc/comment");
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe("pk_123");
    expect((init as { body: string }).body).toContain("texto");
  });

  it("tenta de novo e desiste sem explodir quando o ClickUp recusa", async () => {
    const fetchFake = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "erro" });
    vi.stubGlobal("fetch", fetchFake);

    const ok = await new ClickupComentarioService(config()).comentar("abc", "texto");

    expect(ok).toBe(false);
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });

  it("não tenta nada sem token configurado", async () => {
    const fetchFake = vi.fn();
    vi.stubGlobal("fetch", fetchFake);

    const ok = await new ClickupComentarioService(config({ clickupToken: "" })).comentar("a", "t");

    expect(ok).toBe(false);
    expect(fetchFake).not.toHaveBeenCalled();
  });
});
