import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, StatusViagem } from "@prisma/client";
import type { CriarViagemInput } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { ValidacaoLocalService } from "./validacao-local.service";

const VIAGEM_INCLUDE = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
  cliente: { select: { id: true, nome: true } },
  material: { select: { id: true, nome: true } },
  localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  fotos: { select: { id: true, storageKey: true } },
} satisfies Prisma.ViagemInclude;

const VIAGEM_DETALHE_INCLUDE = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
  cliente: {
    select: {
      id: true,
      nome: true,
      empresa: { select: { id: true, nome: true } },
    },
  },
  material: { select: { id: true, nome: true } },
  localCarga: {
    select: { id: true, nome: true, logradouro: true, cidade: true, uf: true, lat: true, lng: true },
  },
  localDescarga: {
    select: { id: true, nome: true, logradouro: true, cidade: true, uf: true, lat: true, lng: true },
  },
  fotos: { select: { id: true, storageKey: true } },
  pontos: {
    select: { lat: true, lng: true, capturadoEm: true },
    orderBy: { capturadoEm: "asc" },
  },
} satisfies Prisma.ViagemInclude;

@Injectable()
export class ViagensMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly validacao: ValidacaoLocalService,
  ) {}

  async list(
    motoristaId: string,
    filtros: {
      mes?: string;
      grupoStatus?: "AGUARDANDO" | "CONFERIDA" | "DIVERGENTE";
      cursor?: string;
      limit: number;
    },
  ) {
    const where = this.buildWhere(motoristaId, filtros);

    const itens = await this.prisma.viagem.findMany({
      where,
      include: VIAGEM_INCLUDE,
      orderBy: [{ data: "desc" }, { id: "desc" }],
      take: filtros.limit + 1,
      ...(filtros.cursor
        ? { cursor: { id: filtros.cursor }, skip: 1 }
        : {}),
    });

    const hasMore = itens.length > filtros.limit;
    const pageItens = hasMore ? itens.slice(0, filtros.limit) : itens;
    const nextCursor = hasMore ? pageItens[pageItens.length - 1].id : null;

    return { itens: pageItens, nextCursor };
  }

  async resumoMes(motoristaId: string, mes: string) {
    const where = this.buildWhere(motoristaId, { mes });
    const { inicio, fim } = mesRange(mes);
    const wherePedagio = {
      motoristaId,
      data: { gte: inicio, lt: fim },
    } satisfies Prisma.PedagioWhereInput;

    const [agg, porStatus, pedagiosAgg] = await this.prisma.$transaction([
      this.prisma.viagem.aggregate({
        where,
        _count: { _all: true },
        _sum: { toneladas: true, km: true, valorPedagioTotal: true },
      }),
      this.prisma.viagem.groupBy({
        where,
        by: ["status"],
        _count: { _all: true },
        orderBy: { status: "asc" },
      }),
      this.prisma.pedagio.aggregate({
        where: wherePedagio,
        _count: { _all: true },
        _sum: { valor: true },
      }),
    ]);

    const contadores = { aguardando: 0, conferida: 0, divergente: 0 };
    for (const linha of porStatus) {
      const grupo = mapStatusToGrupo(linha.status);
      const total = (linha._count as { _all: number })._all;
      if (grupo === "AGUARDANDO") contadores.aguardando += total;
      else if (grupo === "CONFERIDA") contadores.conferida += total;
      else if (grupo === "DIVERGENTE") contadores.divergente += total;
    }

    return {
      mes,
      totalViagens: agg._count._all,
      totalToneladas: (agg._sum.toneladas ?? "0").toString(),
      totalKm: (agg._sum.km ?? "0").toString(),
      totalPedagio: (agg._sum.valorPedagioTotal ?? "0").toString(),
      porStatus: contadores,
      pedagios: {
        count: pedagiosAgg._count._all,
        totalValor: (pedagiosAgg._sum.valor ?? "0").toString(),
      },
    };
  }

  private buildWhere(
    motoristaId: string,
    filtros: {
      mes?: string;
      grupoStatus?: "AGUARDANDO" | "CONFERIDA" | "DIVERGENTE";
    },
  ): Prisma.ViagemWhereInput {
    const where: Prisma.ViagemWhereInput = { motoristaId };
    if (filtros.mes) {
      const { inicio, fim } = mesRange(filtros.mes);
      where.data = { gte: inicio, lt: fim };
    }
    if (filtros.grupoStatus) {
      where.status = { in: grupoToStatus(filtros.grupoStatus) };
    }
    return where;
  }

  async detalhe(motoristaId: string, viagemId: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      include: VIAGEM_DETALHE_INCLUDE,
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    return viagem;
  }

  async fotoBuffer(motoristaId: string, viagemId: string, fotoId: string) {
    const foto = await this.prisma.ticketFoto.findFirst({
      where: { id: fotoId, viagemId, viagem: { motoristaId } },
      select: { storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada.");
    const buffer = await this.uploads.getObjectBuffer(foto.storageKey);
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    const contentType = ext === "png" ? "image/png" : "image/jpeg";
    return { buffer, contentType };
  }

  /**
   * Motorista pode apagar a propria viagem APENAS enquanto status=ENVIADA
   * (ainda nao foi conferida pela operadora). Apaga fotos no MinIO + DB.
   */
  async delete(motoristaId: string, viagemId: string): Promise<void> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        motoristaId: true,
        status: true,
        fotos: { select: { storageKey: true } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Você não pode apagar esta viagem.");
    }
    if (viagem.status !== "ENVIADA") {
      throw new ForbiddenException(
        "Esta viagem já foi conferida pela operadora e não pode mais ser apagada.",
      );
    }

    // Apaga fotos do MinIO em paralelo (best-effort, se falhar nao bloqueia)
    await Promise.all(
      viagem.fotos.map((f) => this.uploads.removeObject(f.storageKey)),
    );

    // Cascade no schema apaga TicketFoto/Pedagio relacionados
    await this.prisma.viagem.delete({ where: { id: viagemId } });
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

    // Ticket é único por empresa (regra de negócio).
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: input.clienteId },
      select: { empresaId: true },
    });
    if (!cliente) throw new NotFoundException("Cliente não encontrado");

    const ticketDuplicado = await this.prisma.viagem.findFirst({
      where: {
        ticket: input.ticket,
        cliente: { empresaId: cliente.empresaId },
      },
      select: { id: true },
    });
    if (ticketDuplicado) {
      throw new ConflictException(
        `Ticket ${input.ticket} já foi lançado para essa empresa.`,
      );
    }

    const { fotoKey, clientId, pontos, ...rest } = input;
    const viagem = await this.prisma.viagem.create({
      data: {
        clientId,
        motoristaId,
        veiculoId: rest.veiculoId,
        clienteId: rest.clienteId,
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
        iniciadoEm: rest.iniciadoEm,
        kmReal: rest.kmReal,
        criadoOfflineEm: rest.criadoOfflineEm,
        ...(fotoKey
          ? {
              fotos: {
                create: { storageKey: fotoKey, capturadaEm: new Date() },
              },
            }
          : {}),
        ...(pontos && pontos.length > 0
          ? {
              pontos: {
                createMany: {
                  data: pontos.map((p) => ({
                    lat: p.lat,
                    lng: p.lng,
                    capturadoEm: p.capturadoEm,
                    velocidade: p.velocidade,
                    precisao: p.precisao,
                  })),
                },
              },
            }
          : {}),
      },
      include: VIAGEM_INCLUDE,
    });

    // Valida locais cadastrados em rascunho. Camada 1 (GPS do registro) sempre
    // roda; camada 2 (dwell por tracking) só faz diferença se a viagem trouxe
    // pontos. Falhas aqui não derrubam a criação da viagem.
    try {
      await this.validacao.revalidarApos(viagem.id);
      if (pontos && pontos.length > 0) {
        await this.validacao.revalidarComDwell(viagem.id);
      }
    } catch (err) {
      // best-effort; logado pelo próprio service.
    }

    return viagem;
  }
}

function grupoToStatus(
  grupo: "AGUARDANDO" | "CONFERIDA" | "DIVERGENTE",
): StatusViagem[] {
  if (grupo === "AGUARDANDO") return ["ENVIADA", "EM_CONFERENCIA"];
  if (grupo === "CONFERIDA") return ["OK", "AJUSTADA"];
  return ["DIVERGENTE"];
}

function mapStatusToGrupo(
  status: StatusViagem,
): "AGUARDANDO" | "CONFERIDA" | "DIVERGENTE" | null {
  if (status === "ENVIADA" || status === "EM_CONFERENCIA") return "AGUARDANDO";
  if (status === "OK" || status === "AJUSTADA") return "CONFERIDA";
  if (status === "DIVERGENTE") return "DIVERGENTE";
  return null;
}

/** mes = "YYYY-MM" → [primeiro dia 00:00, primeiro dia mes seguinte 00:00) */
export function mesRange(mes: string): { inicio: Date; fim: Date } {
  const [anoStr, mesStr] = mes.split("-");
  const ano = Number(anoStr);
  const m = Number(mesStr);
  const inicio = new Date(Date.UTC(ano, m - 1, 1));
  const fim = new Date(Date.UTC(ano, m, 1));
  return { inicio, fim };
}
