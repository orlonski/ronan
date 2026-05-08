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
        cpf: true,
        telefone: true,
        veiculoDefaultId: true,
        veiculoDefault: { select: { id: true, placa: true, modelo: true } },
        ultimoLoginEm: true,
      },
    });
  }

  async catalogos(motoristaId: string) {
    // Motorista vê só a placa que está vinculada como veículo default dele.
    // Se admin não vinculou nenhuma, mostra a frota inteira como fallback
    // (motorista escolhe e admin completa o cadastro depois).
    const motorista = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { veiculoDefaultId: true },
    });
    const veiculosWhere = motorista?.veiculoDefaultId
      ? { ativo: true, id: motorista.veiculoDefaultId }
      : { ativo: true };

    const [veiculos, materiais, obras, locais] = await Promise.all([
      this.prisma.veiculo.findMany({
        where: veiculosWhere,
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
          lat: true,
          lng: true,
        },
        orderBy: { nome: "asc" },
      }),
    ]);
    return { veiculos, materiais, obras, locais };
  }

  /**
   * Busca fuzzy por nome em catálogos. Usado pela IA do WhatsApp pra resolver
   * referências naturais ("pedreira nova" → localId). ILIKE simples + limit 5.
   * Filtra só ativos.
   */
  async buscarCatalogo(
    motoristaId: string,
    tipo: "material" | "obra" | "local" | "veiculo",
    q: string,
  ) {
    const termo = q.trim();
    if (!termo) return [];
    const like = { contains: termo, mode: "insensitive" as const };

    if (tipo === "material") {
      return this.prisma.material.findMany({
        where: { ativo: true, nome: like },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
        take: 5,
      });
    }
    if (tipo === "obra") {
      return this.prisma.obra.findMany({
        where: { ativa: true, nome: like },
        select: {
          id: true,
          nome: true,
          empresaCliente: { select: { nome: true } },
        },
        orderBy: { nome: "asc" },
        take: 5,
      });
    }
    if (tipo === "local") {
      return this.prisma.local.findMany({
        where: {
          ativo: true,
          OR: [{ nome: like }, { logradouro: like }, { bairro: like }],
        },
        select: {
          id: true,
          nome: true,
          tipo: true,
          logradouro: true,
          cidade: true,
          uf: true,
        },
        orderBy: { nome: "asc" },
        take: 5,
      });
    }
    if (tipo === "veiculo") {
      // Motorista vê só a frota que ele pode usar (default + outros ativos)
      const motorista = await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { veiculoDefaultId: true },
      });
      const where: Record<string, unknown> = {
        ativo: true,
        OR: [
          { placa: like },
          { modelo: like },
        ],
      };
      if (motorista?.veiculoDefaultId) {
        where.id = motorista.veiculoDefaultId;
      }
      return this.prisma.veiculo.findMany({
        where,
        select: { id: true, placa: true, modelo: true },
        orderBy: { placa: "asc" },
        take: 5,
      });
    }
    return [];
  }
}
