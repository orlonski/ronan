import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarViagemInput } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const VIAGEM_INCLUDE = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
  obra: { select: { id: true, nome: true } },
  material: { select: { id: true, nome: true } },
  localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  fotos: { select: { id: true, storageKey: true } },
} satisfies Prisma.ViagemInclude;

@Injectable()
export class ViagensMotoristaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(motoristaId: string) {
    return this.prisma.viagem.findMany({
      where: { motoristaId },
      include: VIAGEM_INCLUDE,
      orderBy: { data: "desc" },
      take: 100,
    });
  }

  async create(motoristaId: string, input: CriarViagemInput & { fotoKey?: string }) {
    const exists = await this.prisma.viagem.findUnique({ where: { clientId: input.clientId } });
    if (exists) {
      // Idempotência: já recebido (sync duplicado), retorna o existente
      return this.prisma.viagem.findUnique({
        where: { clientId: input.clientId },
        include: VIAGEM_INCLUDE,
      });
    }

    // Ticket é único por empresa-cliente (regra de negócio).
    const obra = await this.prisma.obra.findUnique({
      where: { id: input.obraId },
      select: { empresaClienteId: true },
    });
    if (!obra) throw new NotFoundException("Obra não encontrada");

    const ticketDuplicado = await this.prisma.viagem.findFirst({
      where: {
        ticket: input.ticket,
        obra: { empresaClienteId: obra.empresaClienteId },
      },
      select: { id: true },
    });
    if (ticketDuplicado) {
      throw new ConflictException(
        `Ticket ${input.ticket} já foi lançado para essa empresa.`,
      );
    }

    const { fotoKey, clientId, ...rest } = input;
    return this.prisma.viagem.create({
      data: {
        clientId,
        motoristaId,
        veiculoId: rest.veiculoId,
        obraId: rest.obraId,
        materialId: rest.materialId,
        data: rest.data,
        toneladas: rest.toneladas,
        ticket: rest.ticket,
        km: rest.km,
        observacao: rest.observacao,
        localCargaId: rest.localCargaId,
        localDescargaId: rest.localDescargaId,
        valorPedagioTotal: rest.valorPedagioTotal,
        lat: rest.lat,
        lng: rest.lng,
        criadoOfflineEm: rest.criadoOfflineEm,
        ...(fotoKey
          ? {
              fotos: {
                create: { storageKey: fotoKey, capturadaEm: new Date() },
              },
            }
          : {}),
      },
      include: VIAGEM_INCLUDE,
    });
  }
}
