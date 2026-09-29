import { describe, expect, it } from "vitest";
import { acrescentarNaTrilha, lerTrilha, novoEvento } from "./conferencia-trilha";

describe("trilha da conferência", () => {
  it("acrescenta em ordem e guarda só os N mais recentes", () => {
    let t: unknown = [];
    for (let i = 0; i < 25; i++) t = acrescentarNaTrilha(t, novoEvento("TOQUE", { i }), 20);
    const l = t as { detalhe: { i: number } }[];
    expect(l).toHaveLength(20);
    expect(l[0]!.detalhe.i).toBe(5);
    expect(l[19]!.detalhe.i).toBe(24);
  });

  it("linha antiga (sem trilha) ou coluna com lixo lê como vazia", () => {
    expect(lerTrilha(null)).toEqual([]);
    expect(lerTrilha({})).toEqual([]);
    expect(lerTrilha([1, null, { em: "x" }, { em: "2026-09-29T12:00:00Z", evento: "ENVIO", detalhe: {} }])).toHaveLength(1);
  });
});

// ─── Recibo da Meta na trilha ─────────────────────────────────────────────
import { registrarStatusMetaNaConferencia, resumoFalhaMeta, statusJaNaTrilha } from "./conferencia-trilha";

type Linha = { id: string; contaId: string; wamid: string | null; lembreteWamid: string | null; trilha: unknown[]; erroEnvio: string | null; estado: string };

/** Prisma de mentira com o mesmo contrato que o helper usa (append do $executeRaw simulado). */
function bancoFake(linhas: Linha[]) {
  const updates: unknown[] = [];
  const raws: { id: string; contaId: string }[] = [];
  return {
    linhas,
    updates,
    raws,
    prisma: {
      conferenciaDiaria: {
        findFirst: async ({ where }: { where: { OR: { wamid?: string; lembreteWamid?: string }[] } }) => {
          const w = where.OR[0]!.wamid;
          const l = linhas.find((x) => x.wamid === w || x.lembreteWamid === w);
          return l ? { ...l, trilha: [...l.trilha] } : null;
        },
        updateMany: async ({ where, data }: { where: { id: string; contaId: string }; data: { erroEnvio: string } }) => {
          updates.push({ where, data });
          const l = linhas.find((x) => x.id === where.id && x.contaId === where.contaId);
          if (l) l.erroEnvio = data.erroEnvio;
          return { count: l ? 1 : 0 };
        },
      },
      $executeRaw: async (_q: TemplateStringsArray, ev: string, max: number, id: string, contaId: string) => {
        raws.push({ id, contaId });
        const l = linhas.find((x) => x.id === id && x.contaId === contaId);
        if (!l) return 0;
        l.trilha = [...l.trilha, JSON.parse(ev)].slice(-max);
        return 1;
      },
    },
  };
}

const linha = (over: Partial<Linha> = {}): Linha => ({
  id: "L1", contaId: "conta-A", wamid: "wamid.P", lembreteWamid: "wamid.L", trilha: [], erroEnvio: null, estado: "ENVIADA", ...over,
});

describe("recibo da Meta na trilha da conferência", () => {
  it("sent -> delivered -> read entram uma vez cada, mesmo reenviados", async () => {
    const b = bancoFake([linha()]);
    for (const status of ["sent", "delivered", "delivered", "read", "sent", "read"]) {
      await registrarStatusMetaNaConferencia(b.prisma, { wamid: "wamid.P", status, timestamp: "1790000000" });
    }
    const t = b.linhas[0]!.trilha as { evento: string; detalhe: { status: string; alvo: string; metaEm: string } }[];
    expect(t.map((e) => e.detalhe.status)).toEqual(["sent", "delivered", "read"]);
    expect(t.every((e) => e.evento === "STATUS" && e.detalhe.alvo === "PERGUNTA")).toBe(true);
    expect(t[0]!.detalhe.metaEm).toBe("2026-09-21T14:13:20.000Z");
    expect(b.updates).toHaveLength(0);
  });

  it("failed 131049 vira evento e erroEnvio, sem mudar o estado", async () => {
    const b = bancoFake([linha()]);
    await registrarStatusMetaNaConferencia(b.prisma, {
      wamid: "wamid.P", status: "failed", codigo: 131049, titulo: "Message undeliverable", mensagem: "Limite de marketing por usuário", timestamp: "1790000100",
    });
    const l = b.linhas[0]!;
    const ev = l.trilha[0] as { detalhe: Record<string, unknown> };
    expect(ev.detalhe).toMatchObject({ status: "failed", codigo: 131049, titulo: "Message undeliverable", alvo: "PERGUNTA" });
    expect(l.erroEnvio).toContain("131049");
    expect(l.erroEnvio).toContain("Message undeliverable");
    expect(l.estado).toBe("ENVIADA");
  });

  it("failed sempre entra mesmo depois de sent; só o mesmo webhook repetido é cortado", async () => {
    const b = bancoFake([linha()]);
    const f = { wamid: "wamid.P", status: "failed", codigo: 131049, timestamp: "1790000100" };
    await registrarStatusMetaNaConferencia(b.prisma, { wamid: "wamid.P", status: "sent" });
    await registrarStatusMetaNaConferencia(b.prisma, f);
    await registrarStatusMetaNaConferencia(b.prisma, f);
    await registrarStatusMetaNaConferencia(b.prisma, { ...f, timestamp: "1790000900" });
    expect(b.linhas[0]!.trilha).toHaveLength(3);
  });

  it("wamid do lembrete marca alvo LEMBRETE", async () => {
    const b = bancoFake([linha()]);
    await registrarStatusMetaNaConferencia(b.prisma, { wamid: "wamid.L", status: "delivered" });
    expect((b.linhas[0]!.trilha[0] as { detalhe: { alvo: string } }).detalhe.alvo).toBe("LEMBRETE");
  });

  it("wamid desconhecido não quebra e não escreve nada", async () => {
    const b = bancoFake([linha()]);
    await expect(registrarStatusMetaNaConferencia(b.prisma, { wamid: "wamid.X", status: "failed", codigo: 1 })).resolves.toBe(false);
    expect(b.raws).toHaveLength(0);
    expect(b.updates).toHaveLength(0);
  });

  it("erro do banco é engolido (nunca derruba o webhook)", async () => {
    await expect(registrarStatusMetaNaConferencia({ conferenciaDiaria: { findFirst: async () => { throw new Error("db caiu"); } } }, { wamid: "w", status: "sent" })).resolves.toBe(false);
    await expect(registrarStatusMetaNaConferencia({}, { wamid: "w", status: "sent" })).resolves.toBe(false);
  });

  it("isola por conta: escreve só na linha do wamid, com o contaId dela", async () => {
    const b = bancoFake([
      linha({ id: "LA", contaId: "conta-A", wamid: "wamid.A", lembreteWamid: null }),
      linha({ id: "LB", contaId: "conta-B", wamid: "wamid.B", lembreteWamid: null }),
    ]);
    await registrarStatusMetaNaConferencia(b.prisma, { wamid: "wamid.B", status: "failed", codigo: 131049 });
    expect(b.raws).toEqual([{ id: "LB", contaId: "conta-B" }]);
    expect(b.updates).toEqual([expect.objectContaining({ where: { id: "LB", contaId: "conta-B" } })]);
    expect(b.linhas[0]!.trilha).toHaveLength(0);
    expect(b.linhas[0]!.erroEnvio).toBeNull();
  });

  it("statusJaNaTrilha e resumoFalhaMeta", () => {
    expect(statusJaNaTrilha([], { wamid: "a", status: "sent" })).toBe(false);
    expect(resumoFalhaMeta({ wamid: "a", status: "failed", codigo: 131049, titulo: "T" })).toBe("A Meta aceitou o envio mas não entregou (131049): T");
    expect(resumoFalhaMeta({ wamid: "a", status: "failed" })).toBe("A Meta aceitou o envio mas não entregou.");
  });
});
