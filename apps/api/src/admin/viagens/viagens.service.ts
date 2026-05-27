import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AcaoAuditoria, type Prisma, type StatusViagem } from "@prisma/client";
import type { AtualizarViagemInput } from "@ronan/shared-types";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { serializarViagemComMinimos } from "../../common/viagem-minimos";
import { PrismaService } from "../../prisma/prisma.service";
import { RoteamentoService } from "../../roteamento/roteamento.service";
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
    private readonly roteamento: RoteamentoService,
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

    const rota = await this.prisma.rotaCache.findUnique({
      where: {
        localOrigemId_localDestinoId: {
          localOrigemId: viagem.localCargaId,
          localDestinoId: viagem.localDescargaId,
        },
      },
      select: { geometria: true },
    });

    return { ...serializarViagemComMinimos(viagem), rotaGeometria: rota?.geometria ?? null };
  }

  async atualizar(id: string, input: AtualizarViagemInput, usuarioId: string) {
    const antes = await this.prisma.viagem.findUnique({
      where: { id },
      include: { _count: { select: { matchesFechamento: true } } },
    });
    if (!antes) throw new NotFoundException("Viagem não encontrada");
    if (antes._count.matchesFechamento > 0) {
      throw new ConflictException(
        "Não é possível editar: viagem já vinculada a fechamento. Desfaça o match primeiro.",
      );
    }

    // Se trocou ticket OU clienteId, valida unicidade ticket+empresa
    const novoTicket = input.ticket ?? antes.ticket;
    const novoClienteId = input.clienteId ?? antes.clienteId;
    if (novoTicket !== antes.ticket || novoClienteId !== antes.clienteId) {
      const cliente = await this.prisma.cliente.findUnique({
        where: { id: novoClienteId },
        select: { empresaId: true },
      });
      if (!cliente) throw new NotFoundException("Cliente não encontrado");
      const dup = await this.prisma.viagem.findFirst({
        where: {
          id: { not: id },
          ticket: novoTicket,
          cliente: { empresaId: cliente.empresaId },
        },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(`Ticket ${novoTicket} já existe pra essa empresa.`);
      }
    }

    const depois = await this.prisma.viagem.update({
      where: { id },
      data: input,
    });

    // Remove o _count antes de gravar o diff — ele não é campo da entidade.
    const { _count: _ignored, ...antesPlain } = antes;

    // Enriquece campos FK pra log legível: troca UUID por { id, nome } onde
    // possível. Frontend mostra o nome direto, sem precisar fazer lookup.
    const [antesEnriquecido, depoisEnriquecido] = await Promise.all([
      this.enriquecerCamposFK(antesPlain),
      this.enriquecerCamposFK(depois),
    ]);

    await this.auditoria.logDiff(
      { usuarioId, entidade: "Viagem", entidadeId: id, acao: AcaoAuditoria.UPDATE },
      antesEnriquecido,
      depoisEnriquecido,
    );

    return this.detalhe(id);
  }

  /**
   * Resolve os campos FK da viagem em { id, nome } pra log legível.
   * Mantém os outros campos inalterados. Best-effort: se a FK não existir
   * mais (ex: cliente deletado), grava só o id.
   */
  private async enriquecerCamposFK(
    viagem: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...viagem };

    const clienteId = typeof out.clienteId === "string" ? out.clienteId : null;
    const materialId = typeof out.materialId === "string" ? out.materialId : null;
    const veiculoId = typeof out.veiculoId === "string" ? out.veiculoId : null;
    const localCargaId = typeof out.localCargaId === "string" ? out.localCargaId : null;
    const localDescargaId =
      typeof out.localDescargaId === "string" ? out.localDescargaId : null;

    const [cliente, material, veiculo, localCarga, localDescarga] = await Promise.all([
      clienteId
        ? this.prisma.cliente.findUnique({
            where: { id: clienteId },
            select: { nome: true },
          })
        : null,
      materialId
        ? this.prisma.material.findUnique({
            where: { id: materialId },
            select: { nome: true },
          })
        : null,
      veiculoId
        ? this.prisma.veiculo.findUnique({
            where: { id: veiculoId },
            select: { placa: true, modelo: true },
          })
        : null,
      localCargaId
        ? this.prisma.local.findUnique({
            where: { id: localCargaId },
            select: { nome: true, cidade: true, uf: true },
          })
        : null,
      localDescargaId
        ? this.prisma.local.findUnique({
            where: { id: localDescargaId },
            select: { nome: true, cidade: true, uf: true },
          })
        : null,
    ]);

    if (cliente) out.clienteId = { id: clienteId, nome: cliente.nome };
    if (material) out.materialId = { id: materialId, nome: material.nome };
    if (veiculo) {
      out.veiculoId = {
        id: veiculoId,
        nome: veiculo.modelo ? `${veiculo.placa} (${veiculo.modelo})` : veiculo.placa,
      };
    }
    if (localCarga) {
      out.localCargaId = {
        id: localCargaId,
        nome: `${localCarga.nome} (${localCarga.cidade}/${localCarga.uf})`,
      };
    }
    if (localDescarga) {
      out.localDescargaId = {
        id: localDescargaId,
        nome: `${localDescarga.nome} (${localDescarga.cidade}/${localDescarga.uf})`,
      };
    }

    return out;
  }

  async recalcularTrajeto(id: string, usuarioId: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: { id: true, localCargaId: true, localDescargaId: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");

    const cacheAntes = await this.prisma.rotaCache.findUnique({
      where: {
        localOrigemId_localDestinoId: {
          localOrigemId: viagem.localCargaId,
          localDestinoId: viagem.localDescargaId,
        },
      },
      select: { km: true, geometria: true },
    });

    const resultado = await this.roteamento.calcularKm(
      viagem.localCargaId,
      viagem.localDescargaId,
      { force: true },
    );
    if (resultado.km === null) {
      throw new BadRequestException(resultado.erro);
    }

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagem.id,
      acao: AcaoAuditoria.RECALCULAR_TRAJETO,
      metadata: {
        kmAntes: cacheAntes?.km.toString() ?? null,
        kmDepois: resultado.km,
        tinhaGeometria: cacheAntes?.geometria != null,
        temGeometria: resultado.geometria != null,
      },
    });

    return {
      ok: true,
      km: resultado.km,
      duracaoSegundos: resultado.duracaoSegundos,
      geometria: resultado.geometria,
    };
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
