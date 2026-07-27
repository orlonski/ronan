import { afterEach, describe, expect, it, vi } from "vitest";
import { abrirPullRequest, repoDaUrl } from "./github-pr";

afterEach(() => vi.unstubAllGlobals());

const base = {
  repoUrl: "https://github.com/orlonski/ronan.git",
  token: "ghp_x",
  branch: "feat/86bb3pm4w",
  base: "main",
  titulo: "Corrigir filtro",
  corpo: "detalhes",
};

describe("repoDaUrl", () => {
  it("entende https e ssh, com e sem .git", () => {
    expect(repoDaUrl("https://github.com/orlonski/ronan.git")).toEqual({
      dono: "orlonski",
      repo: "ronan",
    });
    expect(repoDaUrl("git@github.com:orlonski/ronan.git")).toEqual({
      dono: "orlonski",
      repo: "ronan",
    });
    expect(repoDaUrl("https://github.com/orlonski/ronan")).toEqual({
      dono: "orlonski",
      repo: "ronan",
    });
  });

  it("devolve null pro que não é GitHub", () => {
    expect(repoDaUrl("/caminho/local/origem.git")).toBeNull();
  });
});

describe("abrirPullRequest", () => {
  it("abre o PR contra a base e devolve a URL", async () => {
    const fetchFake = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/orlonski/ronan/pull/7" }),
    });
    vi.stubGlobal("fetch", fetchFake);

    const r = await abrirPullRequest(base);

    expect(r).toEqual({ url: "https://github.com/orlonski/ronan/pull/7", jaExistia: false });
    const [url, init] = fetchFake.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/orlonski/ronan/pulls");
    const corpo = JSON.parse((init as { body: string }).body);
    expect(corpo.head).toBe("feat/86bb3pm4w");
    expect(corpo.base).toBe("main");
  });

  it("reaproveita o PR existente quando a task roda de novo (não duplica)", async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => "already exists" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ html_url: "https://github.com/orlonski/ronan/pull/7" }],
      });
    vi.stubGlobal("fetch", fetchFake);

    const r = await abrirPullRequest(base);

    expect(r).toEqual({ url: "https://github.com/orlonski/ronan/pull/7", jaExistia: true });
  });

  it("estoura com mensagem útil quando o token não pode abrir PR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Resource not accessible" }),
    );

    await expect(abrirPullRequest(base)).rejects.toThrow(/403/);
  });

  it("nem tenta sem token", async () => {
    const fetchFake = vi.fn();
    vi.stubGlobal("fetch", fetchFake);

    await expect(abrirPullRequest({ ...base, token: "" })).rejects.toThrow(/GITHUB_TOKEN/);
    expect(fetchFake).not.toHaveBeenCalled();
  });
});
