import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AcaoAuditoria, Prisma, type StatusViagem } from "@prisma/client";
import type { CriarViagemInput } from "@ronan/shared-types";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { aplicarMinimosCliente, serializarViagemComMinimos } from "../common/viagem-minimos";
import { EventosService } from "../eventos/eventos.service";
import { PrismaService } from "../prisma/prisma.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { UploadsService } from "../uploads/uploads.service";
import { ValidacaoLocalService } from "./validacao-local.service";

const VIAGEM_INCLUDE = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
  cliente: { select: { id: true, nome: true, toneladasMinimas: true, kmMinimos: true } },
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
      toneladasMinimas: true,
      kmMinimos: true,
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
    private readonly auditoria: AuditoriaService,
    private readonly eventos: EventosService,
    private readonly roteamento: RoteamentoService,
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

    return { itens: pageItens.map(serializarViagemComMinimos), nextCursor };
  }

  async resumoMes(motoristaId: string, mes: string) {
    const where = this.buildWhere(motoristaId, { mes });
    const { inicio, fim } = mesRange(mes);
    const wherePedagio = {
      motoristaId,
      data: { gte: inicio, lt: fim },
    } satisfies Prisma.PedagioWhereInput;

    // findMany pra somar toneladas/km com mínimo do cliente aplicado.
    // Volume típico < 300 viagens/mês — custo irrelevante vs aggregate.
    const [viagens, pedagioAgg, porStatus, pedagiosAgg] = await this.prisma.$transaction([
      this.prisma.viagem.findMany({
        where,
        select: {
          toneladas: true,
          km: true,
          cliente: { select: { toneladasMinimas: true, kmMinimos: true } },
        },
      }),
      this.prisma.viagem.aggregate({
        where,
        _count: { _all: true },
        _sum: { valorPedagioTotal: true },
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

    let totalToneladas = new Prisma.Decimal(0);
    let totalKm = new Prisma.Decimal(0);
    for (const v of viagens) {
      const m = aplicarMinimosCliente(v, v.cliente);
      totalToneladas = totalToneladas.plus(m.toneladasEfetiva);
      totalKm = totalKm.plus(m.kmEfetivo);
    }

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
      totalViagens: pedagioAgg._count._all,
      totalToneladas: totalToneladas.toFixed(3),
      totalKm: totalKm.toFixed(2),
      totalPedagio: (pedagioAgg._sum.valorPedagioTotal ?? "0").toString(),
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
   * Anexa foto a viagem existente (motorista). storageKey já foi obtida via
   * POST /m/uploads/ticket. Valida ownership pra não anexar foto em viagem
   * de outro motorista.
   */
  /**
   * Motorista informa o valor do pedágio que ele tinha esquecido. Só funciona
   * em viagem que admin marcou como DIVERGENTE com tipoDivergencia
   * PEDAGIO_SEM_VALOR. Atualiza o valor, vira AJUSTADA, limpa o tipo da
   * divergência (volta o motivo pro histórico mas o card especial some).
   */
  async informarValorPedagio(
    motoristaId: string,
    viagemId: string,
    valor: number,
  ) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        motoristaId: true,
        status: true,
        tipoDivergencia: true,
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    if (
      viagem.status !== "DIVERGENTE" ||
      viagem.tipoDivergencia !== "PEDAGIO_SEM_VALOR"
    ) {
      throw new ConflictException(
        "Essa viagem não está aguardando informação de pedágio.",
      );
    }
    if (valor <= 0) {
      throw new ConflictException("Valor de pedágio precisa ser positivo.");
    }

    await this.prisma.viagem.update({
      where: { id: viagemId },
      data: {
        valorPedagioTotal: valor,
        status: "AJUSTADA",
        tipoDivergencia: null,
      },
    });

    try {
      await this.auditoria.log({
        usuarioId: null,
        entidade: "Viagem",
        entidadeId: viagemId,
        acao: AcaoAuditoria.MOTORISTA_INFORMOU_PEDAGIO,
        motivo: `Motorista informou valor de pedágio: R$ ${valor.toFixed(2)}`,
        metadata: { motoristaId, valorInformado: valor },
      });
    } catch {
      // best-effort: nao quebra a resposta pro motorista se audit falhar
    }

    return this.detalhe(motoristaId, viagemId);
  }

  /**
   * Motorista responde divergência tipo FOTO_ILEGIVEL anexando uma foto nova.
   * Backend cria a TicketFoto (mantém antigas — conferente compara), muda
   * status pra AJUSTADA e limpa tipoDivergencia. Side-effect equivalente ao
   * adicionarFoto + transição de status numa transação.
   */
  async responderFotoDivergente(
    motoristaId: string,
    viagemId: string,
    storageKey: string,
  ) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        motoristaId: true,
        status: true,
        tipoDivergencia: true,
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    if (
      viagem.status !== "DIVERGENTE" ||
      viagem.tipoDivergencia !== "FOTO_ILEGIVEL"
    ) {
      throw new ConflictException(
        "Essa viagem não está aguardando nova foto.",
      );
    }

    const foto = await this.prisma.$transaction(async (tx) => {
      const novaFoto = await tx.ticketFoto.create({
        data: { viagemId, storageKey, capturadaEm: new Date() },
        select: { id: true, storageKey: true },
      });
      await tx.viagem.update({
        where: { id: viagemId },
        data: { status: "AJUSTADA", tipoDivergencia: null },
      });
      return novaFoto;
    });

    try {
      await this.auditoria.log({
        usuarioId: null,
        entidade: "Viagem",
        entidadeId: viagemId,
        acao: AcaoAuditoria.MOTORISTA_SUBSTITUIU_FOTO,
        motivo: "Motorista enviou nova foto após divergência FOTO_ILEGIVEL",
        metadata: { motoristaId, fotoId: foto.id, storageKey: foto.storageKey },
      });
    } catch {
      // best-effort
    }

    return this.detalhe(motoristaId, viagemId);
  }

  async adicionarFoto(motoristaId: string, viagemId: string, storageKey: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { id: true, motoristaId: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Você não pode anexar foto nesta viagem.");
    }
    return this.prisma.ticketFoto.create({
      data: { viagemId, storageKey, capturadaEm: new Date() },
      select: { id: true, storageKey: true },
    });
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

  /**
   * Garante que um Local com o id passado exista. Se não existir e o app
   * mandou snapshot (nome+lat+lng), recria com aquele id. Usado pra
   * auto-recovery quando motorista lança viagem offline com local cacheado
   * que entrementes foi excluído. Se não existe E não há snapshot,
   * devolve 4xx claro pro motorista corrigir manual.
   */
  private async garantirLocal(args: {
    id: string;
    snapshot?: { nome: string; lat: number; lng: number };
    lado: "carga" | "descarga";
    motoristaId: string;
  }): Promise<void> {
    const existe = await this.prisma.local.findUnique({
      where: { id: args.id },
      select: { id: true },
    });
    if (existe) return;

    if (!args.snapshot) {
      throw new ConflictException(
        `Local de ${args.lado} não foi encontrado no servidor. Pode ter sido removido. Edite a viagem na lista de Pendentes e selecione outro.`,
      );
    }
    // Cria com o id que o app já está usando — idempotente: se duas viagens
    // pendentes do mesmo local sincronizarem ao mesmo tempo, a segunda
    // bate em findUnique e segue.
    await this.prisma.local.create({
      data: {
        id: args.id,
        nome: args.snapshot.nome,
        lat: args.snapshot.lat,
        lng: args.snapshot.lng,
        // Defaults seguros — admin pode completar endereço depois.
        logradouro: "",
        cidade: "",
        uf: "",
        tipo: args.lado === "carga" ? "CARGA" : "DESCARGA",
        criadoPorMotoristaId: args.motoristaId,
        nivelConfianca: "RASCUNHO",
      },
    });
  }

  async create(motoristaId: string, input: CriarViagemInput & { fotoKey?: string }) {
    const exists = await this.prisma.viagem.findUnique({ where: { clientId: input.clientId } });
    if (exists) {
      // Idempotência: já recebido (sync duplicado), retorna o existente
      const existente = await this.prisma.viagem.findUnique({
        where: { clientId: input.clientId },
        include: VIAGEM_INCLUDE,
      });
      return existente ? serializarViagemComMinimos(existente) : null;
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

    // Valida que os locais existem antes de inserir. Auto-recovery:
    // se o ID nao existe mas o app enviou um snapshot (nome+lat+lng), o
    // backend recria o local com o MESMO id. Cobre o caso do motorista
    // ter usado um local do cache offline que ja foi excluido por outro
    // usuario. Sem snapshot, devolve 4xx claro pro motorista editar a
    // viagem na lista de Pendentes.
    await this.garantirLocal({
      id: input.localCargaId,
      snapshot: input.localCargaDados,
      lado: "carga",
      motoristaId,
    });
    await this.garantirLocal({
      id: input.localDescargaId,
      snapshot: input.localDescargaDados,
      lado: "descarga",
      motoristaId,
    });

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
        kmCalculado: rest.kmCalculado,
        observacao: rest.observacao,
        localCargaId: rest.localCargaId,
        localDescargaId: rest.localDescargaId,
        valorPedagioTotal: rest.valorPedagioTotal,
        lat: rest.lat,
        lng: rest.lng,
        iniciadoEm: rest.iniciadoEm,
        kmReal: rest.kmReal,
        criadoOfflineEm: rest.criadoOfflineEm,
        ocrCampos: rest.ocrCampos ?? [],
        ocrConfidence: rest.ocrConfidence,
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

    // Backfill: eventos enviados antes da viagem chegar (offline) usam
    // viagemClientId. Agora que a viagem existe, linka viagemId pros eventos
    // ficarem visíveis na aba de Diagnóstico do dashboard.
    try {
      await this.eventos.reconciliarPorClientId(clientId, viagem.id);
    } catch {
      /* best-effort — eventos sem reconciliação ainda batem por clientId no fallback */
    }

    // Se motorista sobrescreveu o km calculado pelo OSRM, registra na timeline.
    // Best-effort: falha no log não derruba a criação da viagem.
    if (
      rest.kmCalculado != null &&
      Math.abs(rest.kmCalculado - rest.km) > 0.001
    ) {
      try {
        const motorista = await this.prisma.motorista.findUnique({
          where: { id: motoristaId },
          select: { nome: true },
        });
        await this.auditoria.log({
          usuarioId: null,
          entidade: "Viagem",
          entidadeId: viagem.id,
          acao: AcaoAuditoria.MOTORISTA_AJUSTOU_KM,
          campo: "km",
          valorAntes: rest.kmCalculado,
          valorDepois: rest.km,
          metadata: { motoristaId, motoristaNome: motorista?.nome ?? null },
        });
      } catch {
        // best-effort
      }
    }

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

    // Garante que rotaCache exista pro par origem→destino. Cobre 2 casos:
    // - Local recém recriado via auto-recovery (sem rotaCache no banco)
    // - Motorista sincronizou viagem mas nao abriu /m/rotas/calcular pra esse par
    // Sem isso, o dashboard nao mostra polilinha no mapa de trajeto e
    // a query de "pedagios na rota" volta vazia. Best-effort em background.
    void this.roteamento
      .calcularKm(rest.localCargaId, rest.localDescargaId)
      .catch(() => {
        /* best-effort: OSRM down, fora de cobertura, etc — nao bloqueia */
      });

    return serializarViagemComMinimos(viagem);
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
