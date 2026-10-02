import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { EuService } from "./eu.service";

function montar(over: { jaTem?: boolean; telefone?: string | null; contaAceita?: boolean } = {}) {
  const contas = [{ id: "c1", nome: "Freitas Transportes", municipio: "Curitiba", uf: "PR", logoUrl: null }];
  const prisma = {
    conta: {
      findMany: vi.fn(async () => contas),
      findFirst: vi.fn(async () => (over.contaAceita === false ? null : { id: "c1", nome: "Freitas Transportes" })),
    },
    motoristaIdentidade: {
      findUniqueOrThrow: vi.fn(async () => ({
        cpf: "11144477735",
        nome: "João",
        telefone: over.telefone === undefined ? "41999990000" : over.telefone,
        email: null,
        senhaHash: "x",
        placas: null,
      })),
    },
    motorista: { findFirst: vi.fn(async () => (over.jaTem ? { id: "m1" } : null)) },
  };
  const cadastro = { criarVinculoPendente: vi.fn(async () => ({ id: "m1", contaId: "c1", status: "PENDENTE_APROVACAO", ativo: true, aceite: "ACEITO", ultimoLoginEm: null })) };
  const auth = { abrirSessao: vi.fn(async (m: { id: string }) => ({ motoristaId: m.id, contaNome: "Freitas Transportes" })) };
  const svc = new EuService(prisma as never, auth as never, {} as never, {} as never, {} as never, cadastro as never);
  return { svc, prisma, cadastro, auth };
}

describe("EuService — busca de empresa e pedido de entrada", () => {
  it("só busca empresa ativa que aceita pedido, e devolve só o essencial", async () => {
    const { svc, prisma } = montar();
    const r = await svc.buscarEmpresas("i1", "freit");
    const where = (prisma.conta.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ ativa: true, aceitaPedidoMotorista: true });
    expect(r).toEqual([{ id: "c1", nome: "Freitas Transportes", local: "Curitiba - PR", logoUrl: null }]);
  });

  it("recusa termo com menos de 3 letras", async () => {
    await expect(montar().svc.buscarEmpresas("i2", "fr")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("limita buscas por pessoa", async () => {
    const { svc } = montar();
    for (let i = 0; i < 40; i++) await svc.buscarEmpresas("i3", "freit");
    await expect(svc.buscarEmpresas("i3", "freit")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("pedir entrada cria o vínculo pendente", async () => {
    const { svc, cadastro } = montar();
    await expect(svc.pedirEntrada("i4", "c1")).resolves.toMatchObject({ motoristaId: "m1" });
    expect(cadastro.criarVinculoPendente).toHaveBeenCalledWith("c1", "i4", expect.objectContaining({ cpf: "11144477735" }));
  });

  it("recusa empresa que não aceita pedido", async () => {
    await expect(montar({ contaAceita: false }).svc.pedirEntrada("i5", "c1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("409 quando já tem cadastro ou pedido na empresa", async () => {
    await expect(montar({ jaTem: true }).svc.pedirEntrada("i6", "c1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("pede o celular antes quando o perfil não tem", async () => {
    await expect(montar({ telefone: null }).svc.pedirEntrada("i7", "c1")).rejects.toBeInstanceOf(BadRequestException);
  });
});
