import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardService } from "./dashboard.service";
import { comConta } from "../../common/conta/conta-context";
import type { PrismaService } from "../../prisma/prisma.service";

/**
 * A home guarda a resposta por um minuto. O que não pode: mostrar número de
 * horas atrás a quem abre depois de um tempo parado, nem misturar a home de
 * uma empresa ou de um recorte de frota com a de outro.
 */
function montar() {
  const servico = new DashboardService({} as PrismaService);
  let rodada = 0;
  const calcular = vi
    .spyOn(servico as unknown as { calcular: () => Promise<unknown> }, "calcular")
    .mockImplementation(async () => ({ rodada: ++rodada }));
  return { servico, calcular };
}
const abrir = (s: DashboardService, conta = "A", escopo: { transportadoraIds: string[] } | null = null) =>
  comConta(conta, () => s.snapshot(escopo));

afterEach(() => vi.useRealTimers());

describe("home guardada", () => {
  it("dentro de um minuto não recalcula", async () => {
    const { servico, calcular } = montar();
    await abrir(servico);
    expect(await abrir(servico)).toEqual({ rodada: 1 });
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it("empresa e recorte de frota não se misturam", async () => {
    const { servico, calcular } = montar();
    await abrir(servico, "A");
    expect(await abrir(servico, "B")).toEqual({ rodada: 2 });
    expect(await abrir(servico, "A", { transportadoraIds: ["t2", "t1"] })).toEqual({ rodada: 3 });
    // mesma frota em outra ordem é o mesmo recorte
    expect(await abrir(servico, "A", { transportadoraIds: ["t1", "t2"] })).toEqual({ rodada: 3 });
    expect(calcular).toHaveBeenCalledTimes(3);
  });

  it("entre 1 e 5 minutos responde o guardado e recalcula por trás", async () => {
    vi.useFakeTimers();
    const { servico, calcular } = montar();
    await abrir(servico);
    vi.advanceTimersByTime(2 * 60_000);
    expect(await abrir(servico)).toEqual({ rodada: 1 });
    await vi.runAllTimersAsync();
    expect(calcular).toHaveBeenCalledTimes(2);
    expect(await abrir(servico)).toEqual({ rodada: 2 });
  });

  it("depois de 5 minutos espera o número novo", async () => {
    vi.useFakeTimers();
    const { servico } = montar();
    await abrir(servico);
    vi.advanceTimersByTime(6 * 60_000);
    expect(await abrir(servico)).toEqual({ rodada: 2 });
  });
});
