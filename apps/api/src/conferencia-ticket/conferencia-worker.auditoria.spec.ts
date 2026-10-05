import { describe, it, expect, vi } from "vitest";
import { ConferenciaWorkerService } from "./conferencia-worker.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConferenciaConfig } from "./conferencia.config";
import type { ConferenciaTicket } from "@prisma/client";

/**
 * A auditoria às cegas relê viagens que a IA JÁ aprovou (revisadoEm
 * preenchido) e viagens já em fechamento — e nunca age sobre elas.
 *
 * As duas metades travadas aqui:
 *   - o worker não descarta esses jobs por "um humano conferiu antes";
 *   - o resultado vai pro `aplicar` em modo só-registro, seja qual for.
 */
function montar(origem: string) {
  const prisma = {
    viagem: {
      findUnique: async () => ({
        revisadoEm: new Date("2026-10-01"),
        status: "OK",
        ticket: "46779",
        toneladas: 39.85,
        _count: { matchesFechamento: 1 },
      }),
    },
  } as unknown as PrismaService;
  const finalizar = vi.fn(async () => undefined);
  const aplicar = { aplicar: vi.fn(async () => undefined) };
  // A foto some do storage: é o primeiro Descartar DEPOIS das travas de
  // revisão/fechamento — chegar nele prova que elas foram puladas.
  const uploads = { getObjectBuffer: vi.fn(async () => Promise.reject(new Error("NoSuchKey"))) };
  const worker = new ConferenciaWorkerService(
    prisma,
    { finalizar } as never,
    { modoSombra: false, timeoutMs: 5_000 } as unknown as ConferenciaConfig,
    uploads as never,
    {} as never,
    aplicar as never,
    {} as never,
  );
  const job = {
    id: "j1",
    viagemId: "v1",
    contaId: "c1",
    origem,
    declarado: { ticket: "46779", toneladas: 39.85 },
    storageKey: "k.jpg",
    tentativas: 0,
    criadoEm: new Date(),
  } as unknown as ConferenciaTicket;
  return { worker, job, finalizar, uploads };
}

const processar = (w: ConferenciaWorkerService, j: ConferenciaTicket) =>
  (w as unknown as { processar(j: ConferenciaTicket): Promise<void> }).processar(j);

describe("worker × auditoria às cegas", () => {
  it("leitura normal de viagem já revisada é descartada (robô não passa por cima de gente)", async () => {
    const { worker, job, finalizar, uploads } = montar("reconferencia");
    await processar(worker, job);
    expect(uploads.getObjectBuffer).not.toHaveBeenCalled();
    expect(finalizar).toHaveBeenCalledWith(job, expect.objectContaining({ erro: "um humano conferiu antes" }));
  });

  it("auditoria passa pelas travas de revisão e fechamento e vai ler a foto", async () => {
    const { worker, job, finalizar, uploads } = montar("auditoria-cega");
    await processar(worker, job);
    expect(uploads.getObjectBuffer).toHaveBeenCalled();
    expect(finalizar).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ erro: "a foto não está mais no storage" }),
    );
  });
});
