import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaisService } from "./locais.service";
import { comConta } from "../../common/conta/conta-context";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AuditoriaService } from "../../auditoria/auditoria.service";

/**
 * As duplicatas ficam guardadas por empresa. O que não pode acontecer: a
 * etiqueta "Provável duplicata" apontar pra um local que já foi mesclado ou
 * excluído — clicar nela daria erro. Por isso escrita aqui descarta na hora.
 */
function montar() {
  const prisma = {
    local: {
      delete: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ id: "x" })),
    },
    viagem: { count: vi.fn(async () => 0) },
    trechoViagem: { count: vi.fn(async () => 0) },
  } as unknown as PrismaService;
  const servico = new LocaisService(prisma, {} as AuditoriaService);
  let rodada = 0;
  const calcular = vi
    .spyOn(servico as unknown as { calcularDuplicatas: () => Promise<unknown> }, "calcularDuplicatas")
    .mockImplementation(async () => [{ rodada: ++rodada }]);
  return { servico, calcular };
}

afterEach(() => vi.useRealTimers());

describe("duplicatas guardadas por empresa", () => {
  it("a segunda abertura não recalcula", async () => {
    const { servico, calcular } = montar();
    await comConta("A", () => servico.duplicatas());
    expect(await comConta("A", () => servico.duplicatas())).toEqual([{ rodada: 1 }]);
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it("cada empresa tem o seu", async () => {
    const { servico, calcular } = montar();
    await comConta("A", () => servico.duplicatas());
    expect(await comConta("B", () => servico.duplicatas())).toEqual([{ rodada: 2 }]);
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it("vencido responde na hora e recalcula por trás", async () => {
    vi.useFakeTimers();
    const { servico, calcular } = montar();
    await comConta("A", () => servico.duplicatas());
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(await comConta("A", () => servico.duplicatas())).toEqual([{ rodada: 1 }]);
    expect(calcular).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(await comConta("A", () => servico.duplicatas())).toEqual([{ rodada: 2 }]);
  });

  it("excluir um local descarta na hora", async () => {
    const { servico } = montar();
    await comConta("A", () => servico.duplicatas());
    await comConta("A", () => servico.remove("x"));
    expect(await comConta("A", () => servico.duplicatas())).toEqual([{ rodada: 2 }]);
  });

  it("cálculo que começou antes da escrita não guarda o resultado velho", async () => {
    const { servico, calcular } = montar();
    let soltar!: () => void;
    calcular.mockImplementationOnce(
      () => new Promise((ok) => (soltar = () => ok([{ velho: true }]))),
    );
    const antes = comConta("A", () => servico.duplicatas());
    await comConta("A", () => servico.remove("x"));
    soltar();
    await antes;
    expect(await comConta("A", () => servico.duplicatas())).toEqual([{ rodada: 1 }]);
  });
});
