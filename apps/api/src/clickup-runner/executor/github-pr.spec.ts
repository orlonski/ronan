import { afterEach, describe, expect, it, vi } from "vitest";
import { abrirPullRequest, mesclarPullRequest, repoDaUrl } from "./github-pr";

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
      json: async () => ({ html_url: "https://github.com/orlonski/ronan/pull/7", number: 7 }),
    });
    vi.stubGlobal("fetch", fetchFake);

    const r = await abrirPullRequest(base);

    expect(r).toEqual({
      url: "https://github.com/orlonski/ronan/pull/7",
      numero: 7,
      jaExistia: false,
    });
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
        json: async () => [{ html_url: "https://github.com/orlonski/ronan/pull/7", number: 7 }],
      });
    vi.stubGlobal("fetch", fetchFake);

    const r = await abrirPullRequest(base);

    expect(r).toEqual({
      url: "https://github.com/orlonski/ronan/pull/7",
      numero: 7,
      jaExistia: true,
    });
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

describe("mesclarPullRequest", () => {
  const merge = {
    repoUrl: "https://github.com/orlonski/ronan.git",
    token: "ghp_x",
    numero: 7,
    branch: "feat/86bb3pm4w",
    metodo: "squash" as const,
    titulo: "Corrigir filtro",
    esperarMs: 1,
  };

  it("mescla e apaga a branch", async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: "deadbee" }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchFake);

    const r = await mesclarPullRequest(merge);

    expect(r.sha).toBe("deadbee");
    const [urlMerge, initMerge] = fetchFake.mock.calls[0]!;
    expect(urlMerge).toBe("https://api.github.com/repos/orlonski/ronan/pulls/7/merge");
    expect(JSON.parse((initMerge as { body: string }).body).merge_method).toBe("squash");
    const [urlDelete, initDelete] = fetchFake.mock.calls[1]!;
    expect(urlDelete).toContain("/git/refs/heads/feat%2F86bb3pm4w");
    expect((initDelete as { method: string }).method).toBe("DELETE");
  });

  it("espera o GitHub calcular a mesclabilidade antes de desistir", async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 405, text: async () => "not mergeable yet" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: "abc" }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchFake);

    await expect(mesclarPullRequest(merge)).resolves.toEqual({ sha: "abc" });
  });

  it("desiste em conflito real e deixa claro o motivo (PR fica aberto)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 405, text: async () => "not mergeable" }),
    );

    await expect(mesclarPullRequest(merge)).rejects.toThrow(/405/);
  });

  it("não fica insistindo em erro que não é de mesclabilidade", async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: async () => "sem permissão" });
    vi.stubGlobal("fetch", fetchFake);

    await expect(mesclarPullRequest(merge)).rejects.toThrow(/403/);
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });
});
