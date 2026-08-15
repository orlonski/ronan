import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AcaoAuditoria,
  KmFonte,
  NivelConfiancaLocal,
  OrigemCadastroLocal,
  Prisma,
  StatusViagem,
  TipoLocal,
  TipoTrecho,
} from "@prisma/client";
import type { AtualizarViagemInput } from "@ronan/shared-types";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import {
  detalharRegraMinimo,
  serializarViagemComMinimos,
} from "../../common/viagem-minimos";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";
import { RoteamentoService } from "../../roteamento/roteamento.service";
import { UploadsService } from "../../uploads/uploads.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { filtrarComercial, omitirComercial } from "./comercial";
import { PedagiosRodoviaConsultaService } from "../pedagios-rodovia/pedagios-rodovia-consulta.service";
import { BuscaLocaisConfigService } from "../busca-locais-config/busca-locais-config.service";
import { GeocodingService } from "../../geocoding/geocoding.service";
import { KmAtipicoService } from "../../km-atipico/km-atipico.service";
import { ViagemMensagensService } from "../../viagem-mensagens/viagem-mensagens.service";

type ListViagensParams = PaginationQuery & {
  motoristaId?: string;
  veiculoId?: string;
  clienteId?: string;
  localId?: string;
  localCargaId?: string;
  localDescargaId?: string;
  materialId?: string;
  empresaId?: string;
  transportadoraId?: string;
  excluirForaFechamento?: boolean;
  status?: StatusViagem;
  origem?: "guiada" | "direta";
  kmForaDoPadrao?: boolean;
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
    private readonly kmAtipico: KmAtipicoService,
    private readonly mensagens: ViagemMensagensService,
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
    return this.atualizar(
      id,
      { localDescargaId: local.id },
      usuarioId,
      // Tela de descargas suspeitas: handler sem @EscopoPor, então o
      // Handler sem @EscopoPor: sem recorte por frota aqui.
      null,
      true,
    );
  }

  /**
   * Pra cada viagem da lista, marca `temPedagioSemValor=true` quando a rota que
   * ela percorreu passa por pedágio cadastrado e o motorista não preencheu o
   * valor. Roda em paralelo pra não somar latência. False (sem ruído) se:
   * - já tem valor preenchido
   * - não deu pra checar a rota (sem cache de geometria confiável)
   * - falha na consulta de pedágios
   *
   * `somenteCache`: a listagem é paginada e já faz 1 consulta por linha; pagar
   * OSRM aqui multiplicaria isso por rede. O detalhe da viagem recalcula.
   */
  private async marcarPedagiosSemValor<
    T extends {
      id: string;
      valorPedagioTotal: Prisma.Decimal | null;
      localCargaId: string | null;
      localDescargaId: string | null;
    },
  >(viagens: T[]): Promise<Array<T & { temPedagioSemValor: boolean }>> {
    return Promise.all(
      viagens.map(async (v) => {
        if (v.valorPedagioTotal !== null && Number(v.valorPedagioTotal) > 0) {
          return { ...v, temPedagioSemValor: false };
        }
        // EM_ANDAMENTO não tem locais definidos; já foi filtrada da listagem.
        if (v.localCargaId === null || v.localDescargaId === null) {
          return { ...v, temPedagioSemValor: false };
        }
        try {
          const { pedagios } = await this.pedagiosConsulta.pedagiosDaViagem(v.id, {
            somenteCache: true,
          });
          return { ...v, temPedagioSemValor: (pedagios?.length ?? 0) > 0 };
        } catch {
          return { ...v, temPedagioSemValor: false };
        }
      }),
    );
  }

  /** Praças na rota real desta viagem. Ver PedagiosRodoviaConsultaService. */
  async pedagiosNaRota(id: string, escopo: EscopoAdmin) {
    await this.ensureNoEscopo(id, escopo);
    return this.pedagiosConsulta.pedagiosDaViagem(id);
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
    tipo: "viagem-divergente" | "viagem-conferida" | "viagem-editada" | "nova-mensagem-viagem";
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

  /**
   * Barra viagem fora do escopo do usuário com 404 — não 403. Um 403 aqui
   * confirmaria que o id existe, virando oráculo pro gestor mapear a operação
   * das outras frotas. Mesmo padrão do inbox.
   */
  private async ensureNoEscopo(id: string, escopo: EscopoAdmin) {
    if (!escopo) return;
    const ok = await this.prisma.viagem.findFirst({
      where: { id, ...filtroEscopo(escopo) },
      select: { id: true },
    });
    if (!ok) throw new NotFoundException("Viagem não encontrada");
  }

  async list(
    params: ListViagensParams,
    escopo: EscopoAdmin,
    podeVerComercial: boolean,
  ) {
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
    if (params.localCargaId) where.localCargaId = params.localCargaId;
    if (params.localDescargaId) where.localDescargaId = params.localDescargaId;
    if (params.materialId) where.materialId = params.materialId;
    if (params.transportadoraId) where.transportadoraId = params.transportadoraId;
    // Subquery em vez de resolver os clientes da empresa antes: a lista de ids
    // cresceria sem teto e viraria um IN gigante.
    if (params.empresaId) where.cliente = { is: { empresaId: params.empresaId } };
    // `status` explícito ganha do recorte amplo — quem pediu AGUARDANDO_PESO
    // quer ver AGUARDANDO_PESO, mesmo com a flag ligada.
    if (params.status) where.status = params.status;
    else if (params.excluirForaFechamento) where.status = { notIn: STATUS_FORA_FECHAMENTO };
    if (params.origem === "guiada") where.iniciadaGuiada = true;
    else if (params.origem === "direta") where.iniciadaGuiada = false;
    if (params.kmForaDoPadrao) where.kmForaDoPadrao = true;
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
          cliente: { select: { id: true; nome: true; empresaId: true; toneladasMinimas: true; kmMinimos: true } };
          material: { select: { id: true; nome: true; exigeTicket: true } };
          tipoServico: { select: { id: true; nome: true; medicao: true } };
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
      escopo,
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
        // Ordena por sincronizadoEm (timestamp sempre preenchido), não pelo
        // criadoOfflineEm eventualmente exibido na coluna "Criada em".
        criadaEm: "sincronizadoEm",
      },
      defaultSort: { field: "data", order: "desc" },
      include: {
        veiculo: { select: { id: true, placa: true } },
        motorista: { select: { id: true, nome: true } },
        cliente: { select: { id: true, nome: true, empresaId: true, toneladasMinimas: true, kmMinimos: true } },
        material: { select: { id: true, nome: true, exigeTicket: true } },
        // O painel precisa do modo pra decidir entre coluna de peso e de
        // permanência — e aplicarMinimos precisa dele pro guarda da diária.
        tipoServico: { select: { id: true, nome: true, medicao: true } },
        localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
        fotos: { select: { id: true, storageKey: true } },
        _count: { select: { matchesFechamento: true } },
      },
    });

    const comAlertaPedagio = await this.marcarPedagiosSemValor(result.data);
    const regras = await this.prisma.regraMinimo.findMany({ where: { ativo: true } });
    return {
      ...result,
      data: filtrarComercial(
        comAlertaPedagio.map((v) => ({
          ...serializarViagemComMinimos(v, regras),
          temPedagioSemValor: v.temPedagioSemValor,
        })),
        podeVerComercial,
      ),
    };
  }

  async detalhe(id: string, escopo: EscopoAdmin, podeVerComercial: boolean) {
    // findFirst (não findUnique) porque o escopo entra no where — findUnique só
    // aceita campo único.
    const viagem = await this.prisma.viagem.findFirst({
      where: { id, ...filtroEscopo(escopo) },
      include: {
        veiculo: true,
        motorista: { select: { id: true, nome: true, cpf: true } },
        cliente: {
          select: {
            id: true,
            nome: true,
            empresaId: true,
            toneladasMinimas: true,
            kmMinimos: true,
            empresa: { select: { id: true, nome: true } },
          },
        },
        material: true,
        // O painel decide entre tile de peso e de permanência com isto — e o
        // guarda de mínimo em aplicarMinimos depende dele.
        tipoServico: { select: { id: true, nome: true, medicao: true } },
        localCarga: true,
        localDescarga: true,
        trechos: {
          orderBy: { ordem: "asc" },
          include: { local: { select: { id: true, nome: true, cidade: true, uf: true } } },
        },
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

    // EM_ANDAMENTO não tem locais; sem eles não há rota a buscar.
    const rota =
      viagem.localCargaId && viagem.localDescargaId
        ? await this.prisma.rotaCache.findUnique({
            where: {
              localOrigemId_localDestinoId: {
                localOrigemId: viagem.localCargaId,
                localDestinoId: viagem.localDescargaId,
              },
            },
            select: { geometria: true },
          })
        : null;

    const regras = await this.prisma.regraMinimo.findMany({ where: { ativo: true } });
    const payload = {
      ...serializarViagemComMinimos(viagem, regras),
      // Regra de mínimo por faixa que casou (empresa+material+faixa de km) — pro
      // painel mostrar CLARAMENTE por que o faturado ficou acima do informado.
      // Null quando nenhuma regra casa (aí o faturado = informado).
      regraMinimo:
        viagem.cliente?.empresaId && viagem.material?.id
          ? detalharRegraMinimo(
              regras,
              viagem.cliente.empresaId,
              viagem.material.id,
              viagem.km ?? 0,
            )
          : null,
      // Rota escolhida pelo motorista (fallback: cache/recomendada).
      rotaGeometria: viagem.rotaGeometria ?? rota?.geometria ?? null,
      // Sinaliza que o motorista escolheu uma rota no seletor (distingue de
      // edição manual de km no painel).
      rotaEscolhida: viagem.rotaGeometria != null,
      // Variante de retorno em vigor (true=com, false=direto, null=não definido).
      retornoConfirmado: viagem.retornoConfirmado ?? null,
    };
    return podeVerComercial ? payload : omitirComercial(payload);
  }

  async atualizar(
    id: string,
    input: AtualizarViagemInput,
    usuarioId: string,
    escopo: EscopoAdmin,
    podeVerComercial: boolean,
  ) {
    await this.ensureNoEscopo(id, escopo);
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

    // Se trocou ticket OU clienteId, valida unicidade ticket+empresa. Só faz
    // sentido quando há ticket — viagens sem ticket (material que não exige)
    // não entram no dedup.
    const novoTicket = input.ticket ?? antes.ticket;
    const novoClienteId = input.clienteId ?? antes.clienteId;
    if (
      novoTicket &&
      novoClienteId &&
      (novoTicket !== antes.ticket || novoClienteId !== antes.clienteId)
    ) {
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

    // Viagem lançada sem peso (AGUARDANDO_PESO): quando o admin preenche as
    // toneladas pelo dashboard, ela sai de "aguardando peso" e entra no fluxo
    // normal (ENVIADA) — passando a contar em conferência/fechamento/KPIs.
    const dataUpdate: Prisma.ViagemUpdateInput = { ...input };
    if (antes.status === StatusViagem.AGUARDANDO_PESO && input.toneladas != null) {
      dataUpdate.status = StatusViagem.ENVIADA;
    }

    // Espelho da regra acima pra diária: o admin fecha pelo painel a que o
    // motorista deixou aberta. A duração é sempre RECALCULADA aqui (nunca vem
    // do cliente) pra não existir viagem com hora e duração se contradizendo.
    const entradaFinal = input.entradaEm ?? antes.entradaEm;
    const saidaFinal = input.saidaEm ?? antes.saidaEm;
    if (input.entradaEm !== undefined || input.saidaEm !== undefined) {
      if (entradaFinal && saidaFinal) {
        const minutos = Math.round((saidaFinal.getTime() - entradaFinal.getTime()) / 60000);
        if (minutos <= 0) {
          throw new BadRequestException("A hora de saída precisa ser depois da hora de entrada.");
        }
        dataUpdate.duracaoMinutos = minutos;
        if (antes.status === StatusViagem.AGUARDANDO_SAIDA) {
          dataUpdate.status = StatusViagem.ENVIADA;
        }
      } else {
        // Admin limpou a saída: a diária volta a ser uma diária aberta.
        dataUpdate.duracaoMinutos = null;
      }
    }

    const depois = await this.prisma.viagem.update({
      where: { id },
      data: dataUpdate,
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

    // Se o km ou o par de locais mudou, o carimbo de atípico ficou stale — a
    // referência é por par carga→descarga. Re-avalia best-effort.
    if (
      input.km != null ||
      input.localCargaId != null ||
      input.localDescargaId != null
    ) {
      void this.kmAtipico.avaliarViagem(id);
    }

    return this.detalhe(id, null /* handler sem @EscopoPor: sem recorte por frota (a conta a trava já filtra) */, true /* admin */);
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
      tipo?: "PEDAGIO_SEM_VALOR" | "FOTO_ILEGIVEL" | "KM_DIVERGENTE" | "OUTRO";
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
      // O pedido do admin também vira mensagem no chat da viagem (cada "recusar
      // de novo" é uma linha nova, sem sobrescrever a anterior).
      try {
        const admin = await this.prisma.user.findUnique({
          where: { id: usuarioId },
          select: { nome: true },
        });
        await this.mensagens.criar({
          viagemId: id,
          autor: "ADMIN",
          usuarioId,
          autorNome: admin?.nome ?? "Operação",
          texto: data.motivoStatus as string,
          acao: "MARCOU_DIVERGENTE",
        });
      } catch {
        /* best-effort — o chat não pode derrubar a pré-validação */
      }
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

    return this.detalhe(id, null /* handler sem @EscopoPor: sem recorte por frota (a conta a trava já filtra) */, true /* admin */);
  }

  /** Chat da viagem — histórico de mensagens (admin <-> motorista). */
  async listarMensagens(id: string, escopo: EscopoAdmin) {
    await this.ensureNoEscopo(id, escopo);
    const existe = await this.prisma.viagem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException("Viagem não encontrada");
    return this.mensagens.listar(id);
  }

  /** Admin manda uma mensagem no chat da viagem + notifica o motorista. */
  async enviarMensagem(
    id: string,
    usuarioId: string,
    usuarioNome: string,
    texto: string,
    escopo: EscopoAdmin,
  ) {
    await this.ensureNoEscopo(id, escopo);
    const existe = await this.prisma.viagem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException("Viagem não encontrada");
    await this.mensagens.criar({
      viagemId: id,
      autor: "ADMIN",
      usuarioId,
      autorNome: usuarioNome,
      texto: texto.trim(),
    });
    void this.notificarMotorista({
      viagemId: id,
      tipo: "nova-mensagem-viagem",
      titulo: "Nova mensagem da operação",
      corpo: texto.trim().slice(0, 120),
      criadoPorId: usuarioId,
    });
    return this.mensagens.listar(id);
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
        trechos: { select: { id: true, localId: true }, orderBy: { ordem: "asc" } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    // EM_ANDAMENTO não tem locais/km; sem locais não há trajeto a recalcular.
    if (!viagem.localCargaId || !viagem.localDescargaId) {
      throw new BadRequestException("Viagem sem locais definidos.");
    }

    const cacheAntes = await this.prisma.rotaCache.findUnique({
      where: {
        localOrigemId_localDestinoId: {
          localOrigemId: viagem.localCargaId,
          localDestinoId: viagem.localDescargaId,
        },
      },
      select: { km: true, geometria: true },
    });

    // Recalcula a rota direta (mais curta) do par carga→descarga.
    const resultado = await this.roteamento.calcularKm(
      viagem.localCargaId,
      viagem.localDescargaId,
      { force: true },
    );
    if (resultado.km == null) {
      throw new BadRequestException(resultado.erro);
    }

    // Recalcular NUNCA sobrescreve o km faturado: o valor que o motorista
    // informou/confirmou prevalece sempre. Só atualiza a referência OSRM
    // (kmCalculado) e a geometria fresca pro mapa. Pra trocar o km faturado, o
    // admin usa "escolher rota" (ação explícita), não o recalcular.
    let novoKm = parseFloat(resultado.km);
    // Trechos adicionais (retorno do bota-fora hoje): soma cada perna do ponto
    // anterior (1º = descarga) até o local do trecho pela rota direta. Atualiza o
    // km de cada trecho e a referência kmCalculado pra bater com o round-trip
    // (senão o painel acusaria "override" falso).
    const trechoUpdates: { id: string; km: number }[] = [];
    let anterior = viagem.localDescargaId;
    for (const t of viagem.trechos) {
      const rt = await this.roteamento.calcularKm(anterior, t.localId, { force: true });
      if (rt.km != null) {
        const kmT = parseFloat(rt.km);
        trechoUpdates.push({ id: t.id, km: kmT });
        novoKm += kmT;
      }
      anterior = t.localId;
    }

    await this.prisma.viagem.update({
      where: { id: viagem.id },
      data: {
        kmCalculado: novoKm,
        rotaGeometria: resultado.geometria,
        ...(trechoUpdates.length > 0
          ? {
              trechos: {
                update: trechoUpdates.map((t) => ({
                  where: { id: t.id },
                  data: { km: t.km },
                })),
              },
            }
          : {}),
      },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagem.id,
      acao: AcaoAuditoria.RECALCULAR_TRAJETO,
      campo: "kmCalculado",
      valorAntes: viagem.kmCalculado?.toString() ?? null,
      valorDepois: resultado.km,
      motivo: `Km do motorista (${viagem.km?.toString() ?? "0"}) preservado — só a referência de cálculo foi atualizada.`,
      metadata: {
        kmAntes: cacheAntes?.km.toString() ?? null,
        kmDepois: resultado.km,
        kmInformado: viagem.km?.toString() ?? null,
        kmCalculadoAntes: viagem.kmCalculado?.toString() ?? null,
        kmCalculadoDepois: resultado.km,
        tinhaGeometria: cacheAntes?.geometria != null,
        temGeometria: resultado.geometria != null,
      },
    });

    // kmCalculado mudou → o teste de base-consistente do carimbo de atípico usa
    // |km − kmCalculado|, então re-avalia (o km faturado em si foi preservado).
    void this.kmAtipico.avaliarViagem(viagem.id);

    return {
      ok: true,
      km: viagem.km?.toString() ?? "0", // sempre o km do motorista (preservado)
      kmCalculado: resultado.km,
      duracaoSegundos: resultado.duracaoSegundos,
      geometria: resultado.geometria,
    };
  }

  /** Card de referência de km da viagem (histórico do par + rota calculada). */
  async referenciaKm(id: string, escopo: EscopoAdmin) {
    await this.ensureNoEscopo(id, escopo);
    const detalhe = await this.kmAtipico.detalheReferencia(id, escopo);
    if (!detalhe) throw new NotFoundException("Viagem não encontrada");
    return detalhe;
  }

  /**
   * "Aceitar km": marca o km atípico como revisado (kmAceitoEm) e limpa
   * kmForaDoPadrao, readmitindo a viagem na mediana do par. Saída humana da
   * catraca da quarentena. NÃO mexe em `revisadoEm`/`status` — aceitar km é
   * uma decisão diferente de pré-validar a viagem (ver comentário no schema);
   * confundir os dois campos fazia o card de Pré-validação exibir "Divergente"
   * sozinho, sem ninguém ter marcado a viagem como divergente.
   */
  async aceitarKm(id: string, usuarioId: string) {
    const antes = await this.prisma.viagem.findUnique({
      where: { id },
      select: { id: true, km: true, kmForaDoPadrao: true },
    });
    if (!antes) throw new NotFoundException("Viagem não encontrada");

    await this.prisma.viagem.update({
      where: { id },
      data: { kmForaDoPadrao: false, kmAceitoEm: new Date() },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "kmForaDoPadrao",
      valorAntes: antes.kmForaDoPadrao,
      valorDepois: false,
      motivo: `Km ${antes.km?.toString() ?? "?"} aceito como correto — readmitido na referência do trajeto.`,
    });

    return this.detalhe(id, null /* handler sem @EscopoPor: sem recorte por frota (a conta a trava já filtra) */, true /* admin */);
  }

  /** Lista as rotas alternativas (OSRM) do par carga→descarga da viagem. */
  async rotasAlternativas(id: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: { localCargaId: true, localDescargaId: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    if (!viagem.localCargaId || !viagem.localDescargaId) {
      throw new BadRequestException("Viagem sem locais definidos.");
    }
    return this.roteamento.calcularAlternativas(
      viagem.localCargaId,
      viagem.localDescargaId,
    );
  }

  /**
   * Aplica manualmente uma rota escolhida no painel: define o km faturado, a
   * geometria da rota (desenhada no painel) e o kmCalculado de referência.
   *
   * Grava kmFonte=ROTA_ESCOLHIDA (mesmo valor que o app usa quando o motorista
   * escolhe rota no seletor dele) — é a procedência declarada que o
   * KmAtipicoService.baseConsistente exige. Sem isso, um "Recalcular trajeto"
   * posterior (que só atualiza kmCalculado pra rota mais curta) acusava a
   * viagem de "km sem procedência" mesmo tendo sido corrigida aqui — e ela
   * sumia de "viagens comparáveis" sem ninguém ter mexido nela de novo.
   */
  async escolherRota(
    id: string,
    input: {
      km: number;
      rotaGeometria: string;
      kmCalculado?: number;
    },
    usuarioId: string,
  ) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: { id: true, km: true, kmCalculado: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");

    await this.prisma.viagem.update({
      where: { id: viagem.id },
      data: {
        km: input.km,
        rotaGeometria: input.rotaGeometria,
        kmFonte: KmFonte.ROTA_ESCOLHIDA,
        ...(input.kmCalculado != null ? { kmCalculado: input.kmCalculado } : {}),
      },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagem.id,
      acao: AcaoAuditoria.RECALCULAR_TRAJETO,
      campo: "km",
      valorAntes: viagem.km?.toString() ?? null,
      valorDepois: String(input.km),
      motivo: `Rota escolhida manualmente no painel.`,
      metadata: {
        rotaGeometriaDefinida: true,
        kmAntes: viagem.km?.toString() ?? null,
        kmDepois: String(input.km),
        kmCalculado: input.kmCalculado != null ? String(input.kmCalculado) : null,
      },
    });

    // km e kmFonte mudaram → re-carimba o atípico (mesmo motivo do recalcular).
    void this.kmAtipico.avaliarViagem(viagem.id);

    return this.detalhe(id, null /* handler sem @EscopoPor: sem recorte por frota (a conta a trava já filtra) */, true /* admin */);
  }

  /**
   * Km da volta do bota-fora (descarga → carga), na MESMA régua do app. Usa a
   * rota direta (mais curta) — o roteador não força mais o retorno de pista dupla.
   *
   * Null = não deu pra calcular (OSRM fora, local sem coordenada). Nunca zero.
   */
  private async calcularKmVoltaBotaFora(
    localDescargaId: string,
    localCargaId: string,
  ): Promise<number | null> {
    const r = await this.roteamento.calcularKm(localDescargaId, localCargaId);
    if (r.km == null) return null;
    const km = parseFloat(r.km);
    return Number.isFinite(km) ? km : null;
  }

  /** Viagem + tudo que o bota-fora precisa decidir. Compartilhado GET/POST. */
  private async carregarParaBotaFora(id: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id },
      select: {
        id: true,
        km: true,
        kmCalculado: true,
        kmEditadoManual: true,
        retornoConfirmado: true,
        localCargaId: true,
        localDescargaId: true,
        material: { select: { permiteBotaFora: true } },
        trechos: {
          where: { tipo: TipoTrecho.RETORNO_BOTA_FORA },
          select: { km: true },
        },
        _count: { select: { matchesFechamento: true } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    const kmVoltaAtual = viagem.trechos[0] ? Number(viagem.trechos[0].km) : 0;
    return {
      viagem,
      permite: viagem.material?.permiteBotaFora ?? false,
      teveBotaFora: viagem.trechos.length > 0,
      kmVoltaAtual,
      // O km faturado JÁ inclui a volta quando o trecho existe (o app manda
      // ida+volta somados). A base é o que sobra tirando o trecho.
      kmBase: viagem.km != null ? Number(viagem.km) - kmVoltaAtual : null,
      kmCalculadoBase:
        viagem.kmCalculado != null ? Number(viagem.kmCalculado) - kmVoltaAtual : null,
    };
  }

  /**
   * Estado do bota-fora + preview do km de cada resposta, pro painel mostrar a
   * consequência ANTES de aplicar (mesmo contrato do seletor de retorno).
   */
  async opcoesBotaFora(id: string, escopo: EscopoAdmin) {
    await this.ensureNoEscopo(id, escopo);
    const ctx = await this.carregarParaBotaFora(id);
    const { viagem, permite, kmBase } = ctx;

    // Só chama o OSRM quando a resposta pode mudar alguma coisa.
    const kmVolta =
      permite && viagem.localCargaId && viagem.localDescargaId
        ? await this.calcularKmVoltaBotaFora(
            viagem.localDescargaId,
            viagem.localCargaId,
          )
        : null;

    return {
      permiteBotaFora: permite,
      teveBotaFora: ctx.teveBotaFora,
      kmVolta: kmVolta != null ? kmVolta.toFixed(2) : null,
      kmAtual: viagem.km?.toString() ?? null,
      kmSemBotaFora: kmBase != null ? kmBase.toFixed(2) : null,
      kmComBotaFora:
        kmBase != null && kmVolta != null ? (kmBase + kmVolta).toFixed(2) : null,
      // O painel avisa que aplicar sobrescreve um km digitado à mão.
      kmEditadoManual: viagem.kmEditadoManual ?? false,
      emFechamento: viagem._count.matchesFechamento > 0,
    };
  }

  /**
   * Liga/desliga o bota-fora de uma viagem pelo painel — o que o motorista
   * responde na descarga, aqui feito pelo admin (ele recebe a correção do
   * motorista por fora, tipo WhatsApp).
   *
   * Recalcula o km faturado pela rota real; nunca confia em número vindo do
   * cliente. Mantém o bloqueio de fechamento do `atualizar`: viagem já casada
   * não se mexe.
   */
  async definirBotaFora(
    id: string,
    teveBotaFora: boolean,
    usuarioId: string,
    escopo: EscopoAdmin,
  ) {
    await this.ensureNoEscopo(id, escopo);
    const ctx = await this.carregarParaBotaFora(id);
    const { viagem, permite, kmVoltaAtual, kmBase, kmCalculadoBase } = ctx;

    if (viagem._count.matchesFechamento > 0) {
      throw new ConflictException(
        "Não é possível editar: viagem já vinculada a fechamento. Desfaça o match primeiro.",
      );
    }
    if (teveBotaFora && !permite) {
      throw new BadRequestException(
        'O material desta viagem não permite bota-fora. Ligue "Permite voltar pro bota-fora" no cadastro do material antes.',
      );
    }
    if (teveBotaFora && (!viagem.localCargaId || !viagem.localDescargaId)) {
      throw new BadRequestException(
        "Viagem sem local de carga ou de descarga — não dá pra calcular a volta.",
      );
    }
    if (kmBase == null) {
      throw new BadRequestException("Viagem sem km — informe o km antes.");
    }

    const kmVoltaNovo = teveBotaFora
      ? await this.calcularKmVoltaBotaFora(
          viagem.localDescargaId!,
          viagem.localCargaId!,
        )
      : null;
    if (teveBotaFora && kmVoltaNovo == null) {
      throw new BadRequestException(
        "Não foi possível calcular a volta até o local de carga agora. Tente de novo em instantes.",
      );
    }

    const kmNovo = kmBase + (kmVoltaNovo ?? 0);
    const kmCalculadoNovo =
      kmCalculadoBase != null ? kmCalculadoBase + (kmVoltaNovo ?? 0) : null;

    await this.prisma.$transaction(async (tx) => {
      // Recria em vez de atualizar: idempotente e igual ao `finalizar` do app.
      await tx.trechoViagem.deleteMany({
        where: { viagemId: viagem.id, tipo: TipoTrecho.RETORNO_BOTA_FORA },
      });
      if (teveBotaFora && kmVoltaNovo != null) {
        await tx.trechoViagem.create({
          data: {
            viagemId: viagem.id,
            ordem: 1,
            tipo: TipoTrecho.RETORNO_BOTA_FORA,
            // Bota-fora volta SEMPRE pro local de carga — mesma regra do
            // montarTrechos do app (motorista/viagens.service.ts:582).
            localId: viagem.localCargaId!,
            km: kmVoltaNovo,
          },
        });
      }
      await tx.viagem.update({
        where: { id: viagem.id },
        data: {
          km: kmNovo,
          ...(kmCalculadoNovo != null ? { kmCalculado: kmCalculadoNovo } : {}),
        },
      });
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Viagem",
      entidadeId: viagem.id,
      acao: AcaoAuditoria.RECALCULAR_TRAJETO,
      campo: "km",
      valorAntes: viagem.km?.toString() ?? null,
      valorDepois: kmNovo.toFixed(2),
      motivo: teveBotaFora
        ? `Bota-fora marcado no painel: +${(kmVoltaNovo ?? 0).toFixed(2)} km de volta até o local de carga.`
        : `Bota-fora desmarcado no painel: -${kmVoltaAtual.toFixed(2)} km da volta.`,
      metadata: {
        teveBotaFora,
        kmVoltaAntes: kmVoltaAtual.toFixed(2),
        kmVoltaDepois: kmVoltaNovo != null ? kmVoltaNovo.toFixed(2) : null,
        kmAntes: viagem.km?.toString() ?? null,
        kmDepois: kmNovo.toFixed(2),
        retornoConfirmado: viagem.retornoConfirmado ?? null,
        kmEditadoManualSobrescrito: viagem.kmEditadoManual ?? false,
      },
    });

    return this.detalhe(id, null /* handler sem @EscopoPor: sem recorte por frota (a conta a trava já filtra) */, true /* admin */);
  }

  async historico(viagemId: string, escopo: EscopoAdmin) {
    await this.ensureNoEscopo(viagemId, escopo);
    const viagem = await this.prisma.viagem.findUnique({ where: { id: viagemId } });
    if (!viagem) throw new NotFoundException("Viagem não encontrada");
    return this.auditoria.historicoDe("Viagem", viagemId);
  }

  /**
   * Hard delete da viagem. Bloqueado se há pedágios vinculados ou linha de
   * fechamento usando viagemMatchId. TicketFoto e ViagemPonto saem cascade.
   * Apaga fotos do MinIO antes de deletar a viagem.
   */
  async excluir(id: string, escopo: EscopoAdmin) {
    await this.ensureNoEscopo(id, escopo);
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

  async fotoBuffer(viagemId: string, fotoId: string, escopo: EscopoAdmin) {
    await this.ensureNoEscopo(viagemId, escopo);
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
