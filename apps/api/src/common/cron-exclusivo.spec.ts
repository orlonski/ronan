import { describe, expect, it, vi } from "vitest";
import { chaveDoLock, comLockDeCron } from "./cron-exclusivo";

/** Postgres de mentira: diz se o lock foi concedido e registra o que rodou. */
function prismaCom(concede: boolean) {
  const chamadas: string[] = [];
  return {
    chamadas,
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      chamadas.push(sql.includes("try_advisory") ? "lock" : "unlock");
      return sql.includes("try_advisory") ? [{ ok: concede }] : [{}];
    }) as never,
  };
}

describe("chaveDoLock", () => {
  it("o mesmo nome sempre dá a mesma chave", () => {
    expect(chaveDoLock("resumo-motorista")).toBe(chaveDoLock("resumo-motorista"));
  });

  it("nomes diferentes dão chaves diferentes", () => {
    expect(chaveDoLock("resumo-motorista")).not.toBe(chaveDoLock("expurgar-posicoes"));
  });

  it("a chave cabe num inteiro positivo", () => {
    for (const nome of ["a", "expurgar-posicoes", "x".repeat(200)]) {
      const k = chaveDoLock(nome);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(2_000_000_000);
      expect(Number.isInteger(k)).toBe(true);
    }
  });
});

describe("comLockDeCron", () => {
  it("roda e solta o lock quando consegue pegar", async () => {
    const prisma = prismaCom(true);
    const fn = vi.fn(async () => {});
    const rodou = await comLockDeCron(prisma, "job", fn);

    expect(rodou).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(prisma.chamadas).toEqual(["lock", "unlock"]);
  });

  it("NÃO roda quando outra instância já está com o lock", async () => {
    // É o caso que o lock existe pra evitar: a segunda réplica disparando o
    // mesmo job no mesmo segundo.
    const prisma = prismaCom(false);
    const fn = vi.fn(async () => {});
    const rodou = await comLockDeCron(prisma, "job", fn);

    expect(rodou).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    // Sem lock, não solta lock nenhum — soltar o de outro seria pior que não
    // travar.
    expect(prisma.chamadas).toEqual(["lock"]);
  });

  it("solta o lock mesmo quando o job explode", async () => {
    // Sem isto, um job que falha deixaria o lock preso até a conexão cair, e o
    // job não rodaria de novo por horas.
    const prisma = prismaCom(true);
    const fn = vi.fn(async () => {
      throw new Error("estourou");
    });

    await expect(comLockDeCron(prisma, "job", fn)).rejects.toThrow("estourou");
    expect(prisma.chamadas).toEqual(["lock", "unlock"]);
  });
});
