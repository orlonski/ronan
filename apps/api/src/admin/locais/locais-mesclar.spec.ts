import { describe, expect, it, vi } from "vitest";
import { LocaisService } from "./locais.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AuditoriaService } from "../../auditoria/auditoria.service";
import type { KmAtipicoService } from "../../km-atipico/km-atipico.service";
import type { ProgramacaoService } from "../pedidos/programacao.service";

/**
 * Mesclar é o fim do local que o motorista cadastrou pelo app. Tudo que aponta
 * pro origem tem que ir pro destino ANTES do delete: Pedido e OrcamentoItem são
 * SetNull, e soltar a carga do pedido em silêncio faz o saldo contar viagem de
 * qualquer carga.
 */
function montar() {
  const contador = (count: number) => vi.fn((_args: unknown) => ({ count }));
  const prisma = {
    local: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        nome: where.id,
        apelidos: [],
        clientes: [],
      })),
      update: vi.fn(() => ({})),
      delete: vi.fn(() => ({})),
    },
    viagem: {
      findMany: vi.fn(async () => [{ id: "v1" }, { id: "v2" }]),
      updateMany: contador(1),
    },
    trechoViagem: { updateMany: contador(0) },
    eventoViagem: { updateMany: contador(0) },
    pedido: { updateMany: contador(1) },
    orcamentoItem: { updateMany: contador(0) },
    localEvidencia: { updateMany: contador(0) },
    localCliente: { createMany: vi.fn(() => ({})) },
    rotaCache: { deleteMany: vi.fn(() => ({})) },
    viagemPlanejada: { findMany: vi.fn(async () => [{ viagemId: "v1" }]) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const kmAtipico = { avaliarViagem: vi.fn(async () => undefined) };
  const programacao = { casarComViagem: vi.fn(async () => undefined) };
  const servico = new LocaisService(
    prisma as unknown as PrismaService,
    { log: vi.fn(async () => undefined) } as unknown as AuditoriaService,
    kmAtipico as unknown as KmAtipicoService,
    programacao as unknown as ProgramacaoService,
  );
  vi.spyOn(servico as unknown as { esquecerDuplicatas: () => void }, "esquecerDuplicatas")
    .mockImplementation(() => undefined);
  return { servico, prisma, kmAtipico, programacao };
}

describe("LocaisService.mesclar", () => {
  it("repassa pedido, orçamento e evidência pro destino antes de apagar o origem", async () => {
    const { servico, prisma } = montar();
    await servico.mesclar("origem", "destino");

    for (const campo of ["localCargaId", "localDescargaId"]) {
      expect(prisma.pedido.updateMany).toHaveBeenCalledWith({
        where: { [campo]: "origem" },
        data: { [campo]: "destino" },
      });
      expect(prisma.orcamentoItem.updateMany).toHaveBeenCalledWith({
        where: { [campo]: "origem" },
        data: { [campo]: "destino" },
      });
    }
    expect(prisma.localEvidencia.updateMany).toHaveBeenCalledWith({
      where: { localId: "origem" },
      data: { localId: "destino" },
    });
    expect(prisma.local.delete).toHaveBeenCalledWith({ where: { id: "origem" } });
  });

  it("reavalia o atípico de toda viagem movida e só casa com a programação quem não casou", async () => {
    const { servico, kmAtipico, programacao } = montar();
    await servico.mesclar("origem", "destino");
    await vi.waitFor(() => expect(kmAtipico.avaliarViagem).toHaveBeenCalledTimes(2));

    expect(kmAtipico.avaliarViagem).toHaveBeenCalledWith("v1");
    expect(kmAtipico.avaliarViagem).toHaveBeenCalledWith("v2");
    // v1 já está casada com uma planejada: casamento é decisão tomada.
    expect(programacao.casarComViagem).toHaveBeenCalledTimes(1);
    expect(programacao.casarComViagem).toHaveBeenCalledWith("v2");
  });
});
