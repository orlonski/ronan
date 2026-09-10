import { describe, expect, it } from "vitest";
import { CHAVES_PLATAFORMA, PERMISSOES_ADMIN_EMPRESA, TODAS_AS_CHAVES } from "@ronan/shared-types";
import { acimaDoTeto, tetoDaConta } from "./teto-da-conta";

/** Prisma de mentira: devolve a conta que o teste quiser. */
function prismaCom(conta: { ehPlataforma: boolean; permissoesPermitidas: string[] } | null) {
  return { conta: { findUnique: async () => conta } };
}

describe("tetoDaConta", () => {
  it("a casa concede o catálogo inteiro", async () => {
    const teto = await tetoDaConta(prismaCom({ ehPlataforma: true, permissoesPermitidas: [] }), "x");
    expect(teto.size).toBe(TODAS_AS_CHAVES.length);
  });

  it("empresa sem customização cai no padrão de antes do teto existir", async () => {
    // É o que garante que a migration não mudou o comportamento de ninguém:
    // toda empresa nasce com a lista vazia.
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: [] }),
      "x",
    );
    expect([...teto].sort()).toEqual([...PERMISSOES_ADMIN_EMPRESA].sort());
  });

  it("empresa sem customização não recebe nenhuma chave de plataforma", async () => {
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: [] }),
      "x",
    );
    for (const chave of CHAVES_PLATAFORMA) expect(teto.has(chave)).toBe(false);
  });

  it("lista preenchida vale exatamente como está — inclusive liberando o que é de plataforma", async () => {
    // O caso de uso do teto: a plataforma abrir uma tela pra um cliente
    // específico. Se a lista não pudesse conter chave de plataforma, o recurso
    // não serviria pra nada.
    const liberada = CHAVES_PLATAFORMA[0]!;
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: ["viagens.ver", liberada] }),
      "x",
    );
    expect([...teto].sort()).toEqual(["viagens.ver", liberada].sort());
  });

  it("chave que saiu do catálogo não volta à vida por estar guardada no banco", async () => {
    const teto = await tetoDaConta(
      prismaCom({ ehPlataforma: false, permissoesPermitidas: ["viagens.ver", "modulo.extinto"] }),
      "x",
    );
    expect(teto.has("modulo.extinto")).toBe(false);
    expect(teto.has("viagens.ver")).toBe(true);
  });

  it("conta que não existe cai no padrão, nunca no catálogo inteiro", async () => {
    // Fail-closed: some a conta, some o poder — não o contrário.
    const teto = await tetoDaConta(prismaCom(null), "sumiu");
    expect([...teto].sort()).toEqual([...PERMISSOES_ADMIN_EMPRESA].sort());
  });
});

describe("acimaDoTeto", () => {
  it("aponta só o que passa do teto", () => {
    const teto = new Set(["a", "b"]);
    expect(acimaDoTeto(["a", "c", "d"], teto)).toEqual(["c", "d"]);
  });

  it("nada acima do teto devolve lista vazia", () => {
    expect(acimaDoTeto(["a"], new Set(["a", "b"]))).toEqual([]);
  });
});
