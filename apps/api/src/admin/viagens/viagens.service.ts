import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, StatusViagem } from "@prisma/client";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { serializarViagemComMinimos } from "../../common/viagem-minimos";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { paginate, type PaginationQuery } from "../../common/pagination";

type ListViagensParams = PaginationQuery & {
  motoristaId?: string;
  veiculoId?: string;
  clienteId?: string;
  status?: StatusViagem;
  de?: string;
  ate?: string;
};

@Injectable()
export class ViagensAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly uploads: UploadsService,
  ) {}

  async list(params: ListViagensParams) {
    const where: Prisma.ViagemWhereInput = {};
    if (params.motoristaId) where.motoristaId = params.motoristaId;
    if (params.veiculoId) where.veiculoId = params.veiculoId;
    if (params.clienteId) where.clienteId = params.clienteId;
    if (params.status) where.status = params.status;
    if (params.de || params.ate) {
      where.data = {};
      if (params.de) where.data.gte = new Date(params.de);
      if (params.ate) where.data.lte = new Date(params.ate);
    }

    const result = await paginate<
      Prisma.ViagemGetPayload<{
        include: {
          veiculo: { select: { id: true; placa: true } };
          motorista: { select: { id: true; nome: true } };
          cliente: { select: { id: true; nome: true; toneladasMinimas: true; kmMinimos: true } };
          material: { select: { id: true; nome: true } };
          localCarga: { select: { id: true; nome: true; cidade: true; uf: true } };
          localDescarga: { select: { id: true; nome: true; cidade: true; uf: true } };
          fotos: { select: { id: true; storageKey: true } };
          _count: { select: { matchesFechamento: true } };
        };
      }>,
      ListViagensParams
    >(this.prisma.viagem, {
      params,
      where: where as Record<string, unknown>,
      searchFields: [
        "ticket",
        "observacao",
        "motorista.nome",
        "veiculo.placa",
        "cliente.nome",
        "material.nome",
      ],
      sortable: {
        data: "data",
        status: "status",
        ticket: "ticket",
        toneladas: "toneladas",
        km: "km",
        motorista: "motorista.nome",
        placa: "veiculo.placa",
        cliente: "cliente.nome",
      },
      defaultSort: { field: "data", order: "desc" },
      include: {
        veiculo: { select: { id: true, placa: true } },
        motorista: { select: { id: true, nome: true } },
        cliente: { select: { id: true, nome: true, toneladasMinimas: true, kmMinimos: true } },
        material: { select: { id: true, nome: true } },
        localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        fotos: { select: { id: true, storageKey: true } },
        _count: { select: { matchesFechamento: true } },
      },
    });

    return { ...result, data: result.data.map(serializarViagemComMinimos) };
  }

  async detalhe(id: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      include: {
        veiculo: true,
        motorista: { select: { id: true, nome: true, cpf: true } },
        cliente: {
          select: {
            id: true,
            nome: true,
            toneladasMinimas: true,
            kmMinimos: true,
            empresa: { select: { id: true, nome: true } },
          },
        },
        material: true,
        localCarga: true,
        localDescarga: true,
        fotos: true,
        pontos: {
          select: {
            lat: true,
            lng: true,
            capturadoEm: true,
            velocidade: true,
            precisao: true,
          },
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
                empresa: { select: { nome: true } },
              },
            },
          },
        },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    return serializarViagemComMinimos(viagem);
  }

  async historico(viagemId: string) {
    const viagem = await this.prisma.viagem.findUnique({ where: { id: viagemId } });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    return this.auditoria.historicoDe("Viagem", viagemId);
  }

  /**
   * Hard delete da viagem. Bloqueado se há pedágios vinculados ou linha de
   * fechamento usando viagemMatchId. TicketFoto e ViagemPonto saem cascade.
   * Apaga fotos do MinIO antes de deletar a viagem.
   */
  async excluir(id: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: {
        id: true,
        fotos: { select: { storageKey: true } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");

    const [pedagios, linhasMatch] = await Promise.all([
      this.prisma.pedagio.count({ where: { viagemId: id } }),
      this.prisma.fechamentoLinha.count({ where: { viagemMatchId: id } }),
    ]);
    const partes: string[] = [];
    if (pedagios > 0)
      partes.push(`${pedagios} pedágio${pedagios === 1 ? "" : "s"}`);
    if (linhasMatch > 0)
      partes.push(`${linhasMatch} linha${linhasMatch === 1 ? "" : "s"} de fechamento`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}.`,
      );
    }

    await Promise.all(
      viagem.fotos.map((f) => this.uploads.removeObject(f.storageKey)),
    );
    await this.prisma.viagem.delete({ where: { id } });
    return { ok: true };
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
