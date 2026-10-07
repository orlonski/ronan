import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ImportacaoService } from "./importacao.service";

/** Importação de viagem: o km que já existe e o preço na hora. */
function montar(existente: { km: string | null; kmAlteradoEm: Date | null } | null) {
  const updates: Record<string, unknown>[] = [];
  const precificadas: string[] = [];
  const prisma = {
    motorista: { findMany: async () => [{ id: "m1", cpf: "11144477735", nome: "Joao" }] },
    veiculo: { findMany: async () => [{ id: "v1", placa: "ABC1D23" }] },
    cliente: { findMany: async () => [] },
    material: { findMany: async () => [] },
    local: { findMany: async () => [] },
    viagem: {
      findUnique: async () =>
        existente ? { id: "via1", km: existente.km == null ? null : new Prisma.Decimal(existente.km), kmAlteradoEm: existente.kmAlteradoEm } : null,
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { id: "via1" };
      }),
      create: vi.fn(async () => ({ id: "via-nova" })),
    },
    viagemValor: { upsert: vi.fn(async () => ({})) },
  };
  const svc = new ImportacaoService(prisma as never, null as never, null as never, {
    recalcularSeguro: async (id: string) => void precificadas.push(id),
  } as never);
  const gravar = (valores: Record<string, string | number>, avisos: string[] = []) =>
    (svc as unknown as { gravarViagem: (l: unknown, a: string[]) => Promise<string> }).gravarViagem(
      { numero: 2, valores: { data: "2026-09-10", motorista: "111.444.777-35", placa: "ABC1D23", ...valores } },
      avisos,
    );
  return { gravar, updates, precificadas, prisma };
}

describe("importação de viagem", () => {
  it("reimportar não passa por cima do km corrigido no painel com motivo", async () => {
    const { gravar, updates } = montar({ km: "120", kmAlteradoEm: new Date() });
    const avisos: string[] = [];
    await gravar({ km: 95 }, avisos);
    expect(String(updates[0]!.km)).toBe("120");
    expect(avisos[0]).toMatch(/corrigido no painel/);
  });

  it("planilha sem a coluna de km não apaga o km que a viagem já tem", async () => {
    const { gravar, updates } = montar({ km: "88.5", kmAlteradoEm: null });
    await gravar({});
    expect(String(updates[0]!.km)).toBe("88.5");
  });

  it("km novo da planilha vale quando ninguém corrigiu no painel", async () => {
    const { gravar, updates } = montar({ km: "88.5", kmAlteradoEm: null });
    await gravar({ km: 90 });
    expect(String(updates[0]!.km)).toBe("90");
  });

  it("sem valor na planilha: preço da tabela na hora; com valor: fica o da planilha", async () => {
    const a = montar(null);
    await a.gravar({});
    expect(a.precificadas).toEqual(["via-nova"]);
    const b = montar(null);
    await b.gravar({ valorFrete: 500 });
    expect(b.precificadas).toEqual([]);
    expect(b.prisma.viagemValor.upsert).toHaveBeenCalled();
  });
});
