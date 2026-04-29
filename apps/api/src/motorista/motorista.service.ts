import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MotoristaService {
  constructor(private readonly prisma: PrismaService) {}

  me(id: string) {
    return this.prisma.motorista.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        nome: true,
        usuario: true,
        telefone: true,
        veiculoDefaultId: true,
        veiculoDefault: { select: { id: true, placa: true, modelo: true } },
        ultimoLoginEm: true,
      },
    });
  }

  async catalogos() {
    const [veiculos, materiais, obras, locais] = await Promise.all([
      this.prisma.veiculo.findMany({
        where: { ativo: true },
        select: { id: true, placa: true, modelo: true },
        orderBy: { placa: "asc" },
      }),
      this.prisma.material.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }),
      this.prisma.obra.findMany({
        where: { ativa: true },
        select: {
          id: true,
          nome: true,
          empresaCliente: { select: { id: true, nome: true } },
        },
        orderBy: { nome: "asc" },
      }),
      this.prisma.local.findMany({
        where: { ativo: true },
        select: {
          id: true,
          nome: true,
          logradouro: true,
          numero: true,
          bairro: true,
          cidade: true,
          uf: true,
          pontoReferencia: true,
          tipo: true,
          obraId: true,
        },
        orderBy: { nome: "asc" },
      }),
    ]);
    return { veiculos, materiais, obras, locais };
  }
}
