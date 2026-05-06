import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, StatusViagem } from "@prisma/client";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";

@Injectable()
export class ViagensAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(filtros: {
    motoristaId?: string;
    veiculoId?: string;
    obraId?: string;
    status?: StatusViagem;
    de?: string;
    ate?: string;
    take?: number;
  }) {
    const where: Prisma.ViagemWhereInput = {};
    if (filtros.motoristaId) where.motoristaId = filtros.motoristaId;
    if (filtros.veiculoId) where.veiculoId = filtros.veiculoId;
    if (filtros.obraId) where.obraId = filtros.obraId;
    if (filtros.status) where.status = filtros.status;
    if (filtros.de || filtros.ate) {
      where.data = {};
      if (filtros.de) where.data.gte = new Date(filtros.de);
      if (filtros.ate) where.data.lte = new Date(filtros.ate);
    }

    return this.prisma.viagem.findMany({
      where,
      include: {
        veiculo: { select: { id: true, placa: true } },
        motorista: { select: { id: true, nome: true } },
        obra: { select: { id: true, nome: true } },
        material: { select: { id: true, nome: true } },
        localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        fotos: { select: { id: true, storageKey: true } },
        _count: { select: { matchesFechamento: true } },
      },
      orderBy: { data: "desc" },
      take: filtros.take ?? 200,
    });
  }

  async detalhe(id: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      include: {
        veiculo: true,
        motorista: { select: { id: true, nome: true, usuario: true } },
        obra: { select: { id: true, nome: true, empresaCliente: { select: { id: true, nome: true } } } },
        material: true,
        localCarga: true,
        localDescarga: true,
        fotos: true,
        pontos: {
          select: { lat: true, lng: true, capturadoEm: true },
          orderBy: { capturadoEm: "asc" },
        },
        pedagios: { include: { veiculo: { select: { placa: true } } } },
        matchesFechamento: {
          include: {
            fechamento: {
              select: {
                id: true,
                periodoInicio: true,
                periodoFim: true,
                versao: true,
                empresaCliente: { select: { nome: true } },
              },
            },
          },
        },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    return viagem;
  }

  async historico(viagemId: string) {
    const viagem = await this.prisma.viagem.findUnique({ where: { id: viagemId } });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    return this.auditoria.historicoDe("Viagem", viagemId);
  }

  async fotoBuffer(viagemId: string, fotoId: string) {
    const foto = await this.prisma.ticketFoto.findFirst({
      where: { id: fotoId, viagemId },
      select: { storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    const buffer = await this.uploads.getObjectBuffer(foto.storageKey);
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    return { buffer, contentType };
  }
}
