import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AcaoAuditoria,
  NivelConfiancaLocal,
  OrigemCadastroLocal,
  Prisma,
  StatusViagem,
  TipoLocal,
} from "@prisma/client";
import type { AtualizarViagemInput } from "@ronan/shared-types";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { serializarViagemComMinimos } from "../../common/viagem-minimos";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";
import { RoteamentoService } from "../../roteamento/roteamento.service";
import { UploadsService } from "../../uploads/uploads.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { PedagiosRodoviaConsultaService } from "../pedagios-rodovia/pedagios-rodovia-consulta.service";
import { BuscaLocaisConfigService } from "../busca-locais-config/busca-locais-config.service";
import { GeocodingService } from "../../geocoding/geocoding.service";

type ListViagensParams = PaginationQuery & {
  motoristaId?: string;
  veiculoId?: string;
  clienteId?: string;
  localId?: string;
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
    private readonly push: PushService,
    private readonly pedagiosConsulta: PedagiosRodoviaConsultaService,
    private readonly buscaConfig: BuscaLocaisConfigService,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * Audita viagens cujo GPS de lançamento ficou FORA do raio inicial atual em
   * relação ao local de descarga escolhido — mas existe OUTRO local de descarga
   * dentro do raio inicial do GPS real. São candidatas a erro do raio antigo
   * (busca de 500m), pra admin revisar e corrigir 1 a 1. Não altera nada.
   */
  async descargasSuspeitas(opts?: { limit?: number }) {
    const cfg = await this.buscaConfig.get();
    const raioInicial = cfg.raioInicialM;
    const raioAmpliado = cfg.raioAmpliadoM;
    const LIMITE = opts?.limit ?? 300;

    const locais = await this.prisma.local.findMany({
      where: {
        ativo: true,
        tipo: { in: ["DESCARGA", "AMBOS"] },
        lat: { not: null },
        lng: { not: null },
      },
      select: { id: true, nome: true, cidade: true, uf: true, lat: true, lng: true },
    });

    const viagens = await this.prisma.viagem.findMany({
      where: { lat: { not: null }, lng: { not: null } },
      select: {
        id: true,
        ticket: true,
        data: true,
        lat: true,
        lng: true,
        localDescargaId: true,
        localDescarga: {
          select: { id: true, nome: true, cidade: true, uf: true, lat: true, lng: true },
        },
        motorista: { select: { id: true, nome: true } },
        _count: { select: { matchesFechamento: true } },
      },
      orderBy: { data: "desc" },
    });

    const itens = [];
    for (const v of viagens) {
      if (v.lat == null || v.lng == null) continue;

      const distAtual =
        v.localDescarga?.lat != null && v.localDescarga.lng != null
          ? distHaversine(v.lat, v.lng, v.localDescarga.lat, v.localDescarga.lng)
          : Number.POSITIVE_INFINITY;
      // Dentro do raio inicial: a escolha está ok, não é suspeita.
      if (distAtual <= raioInicial) continue;

      // Local de descarga mais perto do GPS real.
      let melhor: { id: string; nome: string; cidade: string; uf: string; dist: number } | null =
        null;
      for (const l of locais) {
        if (l.lat == null || l.lng == null) continue;
        const d = distHaversine(v.lat, v.lng, l.lat, l.lng);
        if (melhor == null || d < melhor.dist) {
          melhor = { id: l.id, nome: l.nome, cidade: l.cidade, uf: l.uf, dist: d };
        }
      }
      const dMelhor = melhor ? melhor.dist : Number.POSITIVE_INFINITY;
      let tipo: "COM_SUGESTAO" | "SEM_LOCAL";
      let sugestao:
        | { id: string; nome: string; cidade: string; uf: string; distanciaMetros: number }
        | null = null;

      if (melhor && melhor.id !== v.localDescargaId && dMelhor <= raioAmpliado) {
        // Existe OUTRO local dentro do alcance da busca (50→500m): sugere.
        tipo = "COM_SUGESTAO";
        sugestao = {
          id: melhor.id,
          nome: melhor.nome,
          cidade: melhor.cidade,
          uf: melhor.uf,
          distanciaMetros: Math.round(melhor.dist),
        };
      } else if (dMelhor > raioAmpliado) {
        // Nada cadastrado nem dentro do raio ampliado: não dá pra sugerir.
        // Admin cadastra o local na hora ou manda revisar.
        tipo = "SEM_LOCAL";
      } else {
        // melhor é o próprio local escolhido (é o mais perto), só que além do
        // raio inicial. Motorista pegou o mais perto disponível — não sinaliza.
        continue;
      }

      itens.push({
        viagemId: v.id,
        ticket: v.ticket,
        data: v.data,
        motorista: v.motorista,
        bloqueada: v._count.matchesFechamento > 0,
        lat: v.lat,
        lng: v.lng,
        tipo,
        localAtual: v.localDescarga
          ? {
              id: v.localDescarga.id,
              nome: v.localDescarga.nome,
              cidade: v.localDescarga.cidade,
              uf: v.localDescarga.uf,
              distanciaMetros: Number.isFinite(distAtual) ? Math.round(distAtual) : null,
            }
          : null,
        sugestao,
      });
    }

    // Pior caso primeiro (mais longe do local atual; sem coords vai pro topo).
    itens.sort(
      (a, b) =>
        (b.localAtual?.distanciaMetros ?? Number.MAX_SAFE_INTEGER) -
        (a.localAtual?.distanciaMetros ?? Number.MAX_SAFE_INTEGER),
    );

    return {
      raioInicialM: raioInicial,
      raioAmpliadoM: raioAmpliado,
      total: itens.length,
      itens: itens.slice(0, LIMITE),
    };
  }

  /**
   * Cadastra um Local de descarga a partir do nome digitado pelo admin + o GPS
   * de lançamento da viagem (reverse geocoding preenche o endereço), e já
   * atribui à viagem. Usado no caso "sem local cadastrado" da auditoria de
   * descargas suspeitas. Reusa `atualizar` pra validar/auditar/notificar.
   */
  async cadastrarLocalDescarga(id: string, nome: string, usuarioId: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: {
        id: true,
        lat: true,
        lng: true,
        _count: { select: { matchesFechamento: true } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    if (viagem._count.matchesFechamento > 0) {
      throw new ConflictException(
        "Viagem já vinculada a fechamento. Desfaça o match primeiro.",
      );
    }
    if (viagem.lat == null || viagem.lng == null) {
      throw new BadRequestException(
        "Viagem sem GPS de lançamento — não dá pra cadastrar o local pela posição.",
      );
    }

    const reverse = await this.geocoding
      .reverseGeocoding(viagem.lat, viagem.lng)
      .catch(() => null);

    const local = await this.prisma.local.create({
      data: {
        nome: nome.trim(),
        logradouro: reverse?.logradouro ?? "(sem endereço)",
        numero: reverse?.numero ?? null,
        bairro: reverse?.bairro ?? null,
        cidade: reverse?.cidade ?? "?",
        uf: (reverse?.uf ?? "??").toUpperCase().slice(0, 2),
        cep: reverse?.cep ?? null,
        tipo: TipoLocal.DESCARGA,
        lat: viagem.lat,
        lng: viagem.lng,
        criadoPorId: usuarioId,
        nivelConfianca: NivelConfiancaLocal.RASCUNHO,
        origemCadastro: OrigemCadastroLocal.ADMIN_AUDITORIA,
      },
    });

    // Atribui à viagem reusando atualizar (valida fechamento, audita o diff
    // localDescarga antes→depois e notifica o motorista da troca de local).
    return this.atualizar(id, { localDescargaId: local.id }, usuarioId);
  }

  /**
   * Pra cada viagem da lista, marca `temPedagioSemValor=true` quando a rota
   * (cacheada) passa por pedágio cadastrado e o motorista não preencheu o
   * valor. Roda em paralelo pra não somar latência. False (sem ruído) se:
   * - já tem valor preenchido
   * - rota nunca foi calculada (sem cache de geometria)
   * - falha na consulta de pedágios
   */
  private async marcarPedagiosSemValor<
    T extends {
      id: string;
      valorPedagioTotal: Prisma.Decimal | null;
      localCargaId: string;
      localDescargaId: string;
    },
  >(viagens: T[]): Promise<Array<T & { temPedagioSemValor: boolean }>> {
    return Promise.all(
      viagens.map(async (v) => {
        if (v.valorPedagioTotal !== null && Number(v.valorPedagioTotal) > 0) {
          return { ...v, temPedagioSemValor: false };
        }
        try {
          const pedagios = await this.pedagiosConsulta.pedagiosNaRota(
            v.localCargaId,
            v.localDescargaId,
          );
          return { ...v, temPedagioSemValor: pedagios.length > 0 };
        } catch {
          return { ...v, temPedagioSemValor: false };
        }
      }),
    );
  }

  /**
   * Notifica o motorista sobre uma ação do admin na viagem dele. Pega o
   * expoPushToken e envia via PushService. Best-effort: falha silenciosa
   * pra não derrubar a operação admin.
   */
  private async notificarMotorista(args: {
    viagemId: string;
    titulo: string;
    corpo: string;
    tipo: "viagem-divergente" | "viagem-conferida" | "viagem-editada";
    dados?: Record<string, unknown>;
    criadoPorId: string;
  }): Promise<void> {
    try {
      const viagem = await this.prisma.viagem.findUnique({
        where: { id: args.viagemId },
        select: { motoristaId: true, motorista: { select: { expoPushToken: true } } },
      });
      if (!viagem) return;
      const token = viagem.motorista?.expoPushToken;
      // Sem token: ainda registra a notificação na central (motorista vê
      // quando abrir o sino). PushService.enviar lida com isso registrando
      // entregaStatus=ERRO mas persistindo o item.
      await this.push.enviar({
        motoristaId: viagem.motoristaId,
        token: token ?? "",
        titulo: args.titulo,
        corpo: args.corpo,
        dados: { ...(args.dados ?? {}), viagemId: args.viagemId },
        tipo: args.tipo,
        criadoPorId: args.criadoPorId,
      });
    } catch {
      /* best-effort */
    }
  }

  async list(params: ListViagensParams) {
    const where: Prisma.ViagemWhereInput = {};
    if (params.motoristaId) where.motoristaId = params.motoristaId;
    if (params.veiculoId) where.veiculoId = params.veiculoId;
    if (params.clienteId) where.clienteId = params.clienteId;
    if (params.localId) {
      where.OR = [
        { localCargaId: params.localId },
        { localDescargaId: params.localId },
      ];
    }
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

    const comAlertaPedagio = await this.marcarPedagiosSemValor(result.data);
    return {
      ...result,
      data: comAlertaPedagio.map((v) => ({
        ...serializarViagemComMinimos(v),
        temPedagioSemValor: v.temPedagioSemValor,
      })),
    };
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

    // Notifica motorista com 1 push agrupado descrevendo o que mudou.
    // FK já vêm enriquecidas com { id, nome } pra resumo legível.
    const diffs = computarDiffViagem(antesEnriquecido, depoisEnriquecido);
    if (diffs.length > 0) {
      void this.notificarMotorista({
        viagemId: id,
        tipo: "viagem-editada",
        titulo: "Sua viagem foi editada",
        corpo: corpoDoDiff(diffs),
        dados: { diffs },
        criadoPorId: usuarioId,
      });
    }

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

  async preValidar(
    id: string,
    input: {
      status: "OK" | "DIVERGENTE" | "DESFAZER";
      motivo?: string;
      tipo?: "PEDAGIO_SEM_VALOR" | "FOTO_ILEGIVEL" | "OUTRO";
    },
    usuarioId: string,
  ) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        _count: { select: { matchesFechamento: true } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    if (viagem._count.matchesFechamento > 0 && input.status !== "DESFAZER") {
      throw new ConflictException(
        "Não é possível pré-validar: viagem já vinculada a fechamento. Desfaça o match primeiro.",
      );
    }

    const data: Prisma.ViagemUpdateInput = {};
    let statusNovo: StatusViagem;
    if (input.status === "OK") {
      statusNovo = StatusViagem.OK;
      data.status = StatusViagem.OK;
      data.revisadoEm = new Date();
      data.revisadoPor = { connect: { id: usuarioId } };
      data.motivoStatus = null;
      data.tipoDivergencia = null;
    } else if (input.status === "DIVERGENTE") {
      if (!input.motivo || input.motivo.trim().length < 2) {
        throw new BadRequestException("Motivo obrigatório quando divergente.");
      }
      statusNovo = StatusViagem.DIVERGENTE;
      data.status = StatusViagem.DIVERGENTE;
      data.revisadoEm = new Date();
      data.revisadoPor = { connect: { id: usuarioId } };
      data.motivoStatus = input.motivo.trim();
      data.tipoDivergencia = input.tipo ?? "OUTRO";
    } else {
      statusNovo = StatusViagem.ENVIADA;
      data.status = StatusViagem.ENVIADA;
      data.revisadoEm = null;
      data.revisadoPor = { disconnect: true };
      data.motivoStatus = null;
      data.tipoDivergencia = null;
    }

    await this.prisma.viagem.update({ where: { id }, data });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: id,
      acao: AcaoAuditoria.PRE_VALIDAR_VIAGEM,
      motivo: input.motivo ?? null,
      metadata: { statusAnterior: viagem.status, statusNovo },
    });

    // Notifica motorista sobre a mudança de status. DESFAZER (volta pra
    // ENVIADA) não notifica — admin desfez a própria ação, motorista não
    // precisa ver vai-e-volta.
    if (statusNovo === StatusViagem.DIVERGENTE) {
      void this.notificarMotorista({
        viagemId: id,
        tipo: "viagem-divergente",
        titulo: "Viagem marcada como divergente",
        corpo: `Motivo: ${data.motivoStatus as string}`,
        dados: { motivo: data.motivoStatus },
        criadoPorId: usuarioId,
      });
    } else if (statusNovo === StatusViagem.OK) {
      void this.notificarMotorista({
        viagemId: id,
        tipo: "viagem-conferida",
        titulo: "Viagem conferida ✓",
        corpo: "A operadora aprovou sua viagem.",
        criadoPorId: usuarioId,
      });
    }

    return this.detalhe(id);
  }

  async recalcularTrajeto(id: string, usuarioId: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: {
        id: true,
        localCargaId: true,
        localDescargaId: true,
        km: true,
        kmCalculado: true,
      },
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

    // Persiste o novo valor na viagem. Admin clicou explicitamente, quer ver
    // o KM atualizado na tela e no fechamento.
    const novoKm = parseFloat(resultado.km);
    await this.prisma.viagem.update({
      where: { id: viagem.id },
      data: { km: novoKm, kmCalculado: novoKm },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagem.id,
      acao: AcaoAuditoria.RECALCULAR_TRAJETO,
      // campo/valorAntes/valorDepois ficam visíveis na timeline (o metadata não é
      // renderizado lá). Mostra o km da viagem antes → depois do recálculo.
      campo: "km",
      valorAntes: viagem.km.toString(),
      valorDepois: resultado.km,
      metadata: {
        kmAntes: cacheAntes?.km.toString() ?? null,
        kmDepois: resultado.km,
        kmInformadoAntes: viagem.km.toString(),
        kmInformadoDepois: resultado.km,
        kmCalculadoAntes: viagem.kmCalculado?.toString() ?? null,
        kmCalculadoDepois: resultado.km,
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

  async excluirFoto(viagemId: string, fotoId: string) {
    const foto = await this.prisma.ticketFoto.findFirst({
      where: { id: fotoId, viagemId },
      select: { id: true, storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    // Best-effort: se MinIO falhar, ainda apaga DB pra UI consistir.
    await this.uploads.removeObject(foto.storageKey).catch(() => {});
    await this.prisma.ticketFoto.delete({ where: { id: fotoId } });
    return { ok: true };
  }

  async rotacionarFoto(viagemId: string, fotoId: string, rotacao: number) {
    const foto = await this.prisma.ticketFoto.findFirst({
      where: { id: fotoId, viagemId },
      select: { id: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    return this.prisma.ticketFoto.update({
      where: { id: fotoId },
      data: { rotacao },
    });
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

  /**
   * Admin anexa foto a viagem existente. Multipart direto — sobe pro MinIO
   * e cria TicketFoto em uma única operação. Registra auditoria.
   */
  async adicionarFoto(
    viagemId: string,
    buffer: Buffer,
    mimetype: string,
    usuarioId: string,
  ) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { id: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");

    // Reusa o helper de upload do motorista — path fica
    // `tickets/YYYY-MM-DD/{usuarioId}/uuid.jpg`. Caminho convive
    // bem com fotos enviadas pelo motorista (mesmo bucket).
    const storageKey = await this.uploads.putTicketFoto(buffer, mimetype, usuarioId);
    const foto = await this.prisma.ticketFoto.create({
      data: { viagemId, storageKey, capturadaEm: new Date() },
      select: { id: true, storageKey: true },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagemId,
      acao: AcaoAuditoria.ADICIONAR_FOTO,
      metadata: { storageKey, fotoId: foto.id },
    });

    return foto;
  }
}

// ===== Helpers de diff pra notificação ao motorista =====

/** Campos que não interessam pro motorista (técnicos/internos). */
const CAMPOS_IGNORADOS_NOTIF = new Set([
  "alteradoEm",
  "sincronizadoEm",
  "criadoEm",
  "id",
  "clientId",
  "motoristaId",
  "revisadoEm",
  "revisadoPorId",
  "lat",
  "lng",
  "iniciadoEm",
  "kmReal",
  "kmCalculado",
  "ocrCampos",
  "ocrConfidence",
  "criadoOfflineEm",
  "status",
  "motivoStatus",
]);

const LABEL_CAMPO: Record<string, string> = {
  km: "Km",
  toneladas: "Toneladas",
  ticket: "Ticket",
  data: "Data",
  observacao: "Observação",
  valorPedagioTotal: "Valor pedágio",
  cliente: "Cliente",
  material: "Material",
  veiculo: "Veículo",
  localCarga: "Local de carga",
  localDescarga: "Local de descarga",
  clienteId: "Cliente",
  materialId: "Material",
  veiculoId: "Veículo",
  localCargaId: "Local de carga",
  localDescargaId: "Local de descarga",
};

type DiffCampo = { campo: string; label: string; antes: unknown; depois: unknown };

function computarDiffViagem(
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
): DiffCampo[] {
  const fields = new Set<string>([...Object.keys(antes), ...Object.keys(depois)]);
  const diffs: DiffCampo[] = [];
  for (const f of fields) {
    if (CAMPOS_IGNORADOS_NOTIF.has(f)) continue;
    if (JSON.stringify(antes[f]) === JSON.stringify(depois[f])) continue;
    diffs.push({
      campo: f,
      label: LABEL_CAMPO[f] ?? f,
      antes: antes[f],
      depois: depois[f],
    });
  }
  return diffs;
}

function formatarValorDiff(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object" && v !== null) {
    if ("nome" in v && typeof (v as { nome: unknown }).nome === "string") {
      return (v as { nome: string }).nome;
    }
    if ("placa" in v && typeof (v as { placa: unknown }).placa === "string") {
      return (v as { placa: string }).placa;
    }
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    // Datetime ISO → DD/MM/YYYY pro motorista (sem horário).
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }
  return String(v);
}

function corpoDoDiff(diffs: DiffCampo[]): string {
  if (diffs.length === 0) return "Sua viagem foi atualizada.";
  const partes = diffs
    .slice(0, 2)
    .map((d) => `${d.label}: ${formatarValorDiff(d.antes)} → ${formatarValorDiff(d.depois)}`);
  let corpo = partes.join("; ");
  const extras = diffs.length - partes.length;
  if (extras > 0) corpo += ` (+${extras} ${extras === 1 ? "mudança" : "mudanças"})`;
  return corpo;
}

/** Distância em metros entre dois pontos (Haversine). */
function distHaversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
