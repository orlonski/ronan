import { describe, expect, it, vi } from "vitest";
import { KmReprocessamentoService } from "./km-reprocessamento.service";

function montar(viagem: Record<string, unknown>) {
  const update = vi.fn().mockResolvedValue({});
  const enviar = vi.fn().mockResolvedValue({});
  const prisma = {
    viagem: {
      findUnique: vi.fn().mockResolvedValue({
        id: "v1",
        motoristaId: "m1",
        status: "ENVIADA",
        km: null,
        kmCalculado: null,
        kmEditadoManual: false,
        kmFonte: null,
        kmRecalculadoEm: null,
        kmAlteradoEm: null,
        trechos: [],
        localCargaId: "a",
        localDescargaId: "b",
        material: null,
        motorista: { expoPushToken: "tok" },
        _count: { matchesFechamento: 0 },
        ...viagem,
      }),
      update,
    },
  };
  const roteamento = { calcularKm: vi.fn().mockResolvedValue({ km: "120.00" }) };
  const svc = new KmReprocessamentoService(
    prisma as never,
    roteamento as never,
    { enviar } as never,
    { avaliarViagem: vi.fn().mockResolvedValue(undefined) } as never,
    { recalcularSeguro: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return { svc, update, enviar };
}

describe("KmReprocessamentoService — viagem importada", () => {
  it("importada sem km: preenche o km e não manda push pro motorista", async () => {
    const { svc, update, enviar } = montar({ clientId: "import:abc" });
    await svc.reprocessar("v1");
    expect(update.mock.calls[0]![0].data.km).toBe(120);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("importada com km da planilha: mantém o km faturado e não manda push", async () => {
    const { svc, update, enviar } = montar({ clientId: "import:abc", km: "95" });
    await svc.reprocessar("v1");
    const data = update.mock.calls[0]![0].data;
    expect(data.km).toBeUndefined();
    expect(data.kmCalculado).toBe(120);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("lançada pelo app sem sinal: segue avisando o motorista", async () => {
    const { svc, enviar } = montar({ clientId: "app-123", km: "80" });
    await svc.reprocessar("v1");
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});
