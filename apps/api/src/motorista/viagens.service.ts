import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AcaoAuditoria, Prisma, type StatusViagem } from "@prisma/client";
import type {
  CriarViagemInput,
  FinalizarViagemInput,
  IniciarViagemInput,
  RegistrarEventoInput,
  TrechoViagemInput,
} from "@ronan/shared-types";
import type { AppInfoHeaders } from "../auth/decorators/app-info.decorator";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { garantirCadastro, ItemInexistenteException } from "../common/item-inexistente";
import { resolverTransportadora } from "../common/transportadora";
import { resolverModoServico, resolverPeriodo } from "../common/tipo-servico";
import { exigeFotoDaViagem, resolverJustificativaSemFoto } from "../common/exige-foto";
import { formatarDuracao } from "@ronan/shared-types";
import {
  aplicarMinimos,
  resolverRegraMinimo,
  serializarViagemComMinimos,
} from "../common/viagem-minimos";
import { STATUS_FORA_FECHAMENTO } from "../common/viagem-status";
import { EventosService } from "../eventos/eventos.service";
import { PrismaService } from "../prisma/prisma.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { UploadsService } from "../uploads/uploads.service";
import { ValidacaoLocalService } from "./validacao-local.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { KmReprocessamentoService } from "./km-reprocessamento.service";
import { KmAtipicoService } from "../km-atipico/km-atipico.service";
import { ViagemMensagensService } from "../viagem-mensagens/viagem-mensagens.service";
import { AvisoPesoService } from "./aviso-peso.service";
import { LancamentosResgatadosService } from "../lancamentos-resgatados/lancamentos-resgatados.service";

const VIAGEM_INCLUDE = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
  cliente: { select: { id: true, nome: true, empresaId: true, toneladasMinimas: true, kmMinimos: true } },
  material: { select: { id: true, nome: true } },
  // O app precisa do modo pra renderizar peso x entrada/saída na lista e no
  // detalhe. `medicao` é o que decide; o nome é o rótulo do badge.
  tipoServico: { select: { id: true, nome: true, medicao: true } },
  localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  fotos: { select: { id: true, storageKey: true } },
  trechos: {
    orderBy: { ordem: "asc" },
    include: { local: { select: { id: true, nome: true, cidade: true, uf: true } } },
  },
} satisfies Prisma.ViagemInclude;

const VIAGEM_DETALHE_INCLUDE = {
  veiculo: { select: { id: true, placa: true, modelo: true } },
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
  material: { select: { id: true, nome: true } },
  tipoServico: { select: { id: true, nome: true, medicao: true } },
  localCarga: {
    select: { id: true, nome: true, logradouro: true, cidade: true, uf: true, lat: true, lng: true },
  },
  localDescarga: {
    select: { id: true, nome: true, logradouro: true, cidade: true, uf: true, lat: true, lng: true },
  },
  trechos: {
    orderBy: { ordem: "asc" },
    include: { local: { select: { id: true, nome: true, cidade: true, uf: true } } },
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
    private readonly inbox: AdminInboxService,
    private readonly kmReprocessamento: KmReprocessamentoService,
    private readonly avisos: AvisoPesoService,
    private readonly kmAtipico: KmAtipicoService,
    private readonly mensagens: ViagemMensagensService,
    private readonly resgates: LancamentosResgatadosService,
  ) {}

  /** Regras de mínimo por faixa ativas (empresa+material+faixa de km). */
  private regrasMinimoAtivas() {
    return this.prisma.regraMinimo.findMany({
      where: { ativo: true },
      select: {
        empresaId: true,
        materialId: true,
        kmFaixaDe: true,
        kmFaixaAte: true,
        kmMinimo: true,
        toneladasMinimo: true,
      },
    });
  }

  /**
   * Dispara notificação pra inbox de todos os admins. Best-effort: erro
   * aqui nunca derruba a operação que disparou (caller pode envolver em
   * try/catch também).
   */
  private async notificarAdmins(
    tipo:
      | "nova-viagem"
      | "resposta-divergencia-pedagio"
      | "resposta-divergencia-km"
      | "resposta-divergencia-foto"
      | "nova-mensagem-viagem"
      | "foto-anexada",
    titulo: string,
    corpo: string,
    dados: Record<string, string | number>,
  ): Promise<void> {
    try {
      await this.inbox.disparar({ tipo, titulo, corpo, dados });
    } catch (err) {
      // Logado mas nao bloqueia. Inbox e' nice-to-have.
      // eslint-disable-next-line no-console
      console.warn(`[inbox] falha ao notificar ${tipo}:`, (err as Error).message);
    }
  }

  async list(
    motoristaId: string,
    filtros: {
      mes?: string;
      grupoStatus?: "AGUARDANDO" | "CONFERIDA" | "DIVERGENTE";
      comPedagio?: boolean;
      cursor?: string;
      limit: number;
    },
  ) {
    // Feed mostra também as viagens "aguardando peso" (marcadas no app); o
    // resumoMes usa buildWhere sem essa flag, então os totais seguem limpos.
    const where = this.buildWhere(motoristaId, {
      ...filtros,
      incluirAguardandoPeso: true,
    });

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

    const regras = await this.regrasMinimoAtivas();
    return {
      itens: pageItens.map((v) => serializarViagemComMinimos(v, regras)),
      nextCursor,
    };
  }

  async resumoMes(motoristaId: string, mes: string) {
    const where = this.buildWhere(motoristaId, { mes });
    const { inicio, fim } = mesRange(mes);
    const wherePedagio = {
      motoristaId,
      data: { gte: inicio, lt: fim },
    } satisfies Prisma.PedagioWhereInput;
    // Contador da aba "Pedágios" do histórico. É contador de LISTA, não KPI:
    // usa o mesmo where do feed (com AGUARDANDO_PESO) pra bater com o que a
    // aba realmente mostra — com o where dos KPIs, viagem aguardando peso com
    // pedágio apareceria na lista sem entrar no número do chip.
    const whereComPedagio = this.buildWhere(motoristaId, {
      mes,
      incluirAguardandoPeso: true,
      comPedagio: true,
    });

    // findMany pra somar toneladas/km com mínimo do cliente aplicado.
    // Volume típico < 300 viagens/mês — custo irrelevante vs aggregate.
    const [viagens, pedagioAgg, porStatus, pedagiosAgg, viagensComPedagioAgg] =
      await this.prisma.$transaction([
        this.prisma.viagem.findMany({
          where,
          select: {
            toneladas: true,
            km: true,
            materialId: true,
            cliente: { select: { empresaId: true, toneladasMinimas: true, kmMinimos: true } },
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
        this.prisma.viagem.aggregate({
          where: whereComPedagio,
          _count: { _all: true },
          _sum: { valorPedagioTotal: true },
        }),
      ]);

    const regras = await this.regrasMinimoAtivas();
    let totalToneladas = new Prisma.Decimal(0);
    let totalKm = new Prisma.Decimal(0);
    for (const v of viagens) {
      const override =
        resolverRegraMinimo(regras, v.cliente?.empresaId ?? "", v.materialId, v.km ?? 0) ??
        undefined;
      const m = aplicarMinimos(v, override);
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
      // Lançamentos avulsos de pedágio (model Pedagio). Mantido pro PWA, que
      // ainda lista essa fonte na aba "Pedágios".
      pedagios: {
        count: pedagiosAgg._count._all,
        totalValor: (pedagiosAgg._sum.valor ?? "0").toString(),
      },
      // Viagens que tiveram pedágio — fonte da aba "Pedágios" do app nativo.
      viagensComPedagio: {
        count: viagensComPedagioAgg._count._all,
        totalValor: (viagensComPedagioAgg._sum.valorPedagioTotal ?? "0").toString(),
      },
    };
  }

  private buildWhere(
    motoristaId: string,
    filtros: {
      mes?: string;
      grupoStatus?: "AGUARDANDO" | "CONFERIDA" | "DIVERGENTE";
      // Só viagens com pedágio pago (valorPedagioTotal > 0). Ignora null e 0,00.
      comPedagio?: boolean;
      // Feed de viagens (recentes/histórico) MOSTRA AGUARDANDO_PESO: a viagem
      // existe e o motorista lançou, então ela aparece na lista (marcada como
      // "aguardando peso"). Só o lançamento incompleto EM_ANDAMENTO fica de fora.
      // Agregados (resumoMes) NÃO passam a flag → seguem excluindo os dois, pra
      // não contar peso zero em totais/KPIs.
      incluirAguardandoPeso?: boolean;
    },
  ): Prisma.ViagemWhereInput {
    const where: Prisma.ViagemWhereInput = {
      motoristaId,
      status: filtros.incluirAguardandoPeso
        ? { not: "EM_ANDAMENTO" }
        : { notIn: STATUS_FORA_FECHAMENTO },
    };
    if (filtros.mes) {
      const { inicio, fim } = mesRange(filtros.mes);
      where.data = { gte: inicio, lt: fim };
    }
    if (filtros.grupoStatus) {
      // Filtro por grupo de conferência nunca inclui AGUARDANDO_PESO (não é
      // conferível): o `in` do grupo já cuida disso.
      where.status = { in: grupoToStatus(filtros.grupoStatus) };
    }
    if (filtros.comPedagio) {
      where.valorPedagioTotal = { gt: 0 };
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

    // Viagem EM_ANDAMENTO pode não ter locais definidos ainda — sem rota.
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

    const regras = await this.regrasMinimoAtivas();
    return {
      ...serializarViagemComMinimos(viagem, regras),
      // Prefere a rota que o motorista escolheu no seletor; cai no cache
      // (recomendada) pra viagens antigas sem escolha registrada.
      rotaGeometria: viagem.rotaGeometria ?? rota?.geometria ?? null,
    };
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

    const nomePed = (
      await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { nome: true },
      })
    )?.nome;
    await this.mensagens.criar({
      viagemId,
      autor: "MOTORISTA",
      motoristaId,
      autorNome: nomePed ?? "Motorista",
      texto: `Informei o pedágio: R$ ${valor.toFixed(2)}.`,
      acao: "INFORMOU_PEDAGIO",
    });
    void this.notificarAdmins(
      "resposta-divergencia-pedagio",
      `${nomePed ?? "Motorista"} informou pedágio`,
      `R$ ${valor.toFixed(2)} — viagem aguardando sua revisão`,
      { viagemId, motoristaId, valor },
    );

    return this.detalhe(motoristaId, viagemId);
  }

  /**
   * Motorista responde divergência tipo KM_DIVERGENTE: pode corrigir o km e/ou
   * justificar por que colocou aquele valor. A justificativa é anexada à
   * observação (preserva o que já havia). Viagem vira AJUSTADA pro admin
   * revisar. Se o km mudou, marca como manual e re-carimba o atípico.
   */
  async responderKmDivergente(
    motoristaId: string,
    viagemId: string,
    input: { km?: number; justificativa: string },
  ) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        motoristaId: true,
        status: true,
        tipoDivergencia: true,
        km: true,
        observacao: true,
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    if (viagem.status !== "DIVERGENTE" || viagem.tipoDivergencia !== "KM_DIVERGENTE") {
      throw new ConflictException("Essa viagem não está aguardando revisão do km.");
    }
    const justificativa = input.justificativa.trim();
    if (justificativa.length < 5) {
      throw new ConflictException("Explique em poucas palavras por que o km é esse.");
    }

    // Se corrigiu o km, é valor manual → não deixa o reprocessamento sobrescrever.
    const kmMudou = input.km != null && Number(viagem.km ?? 0) !== input.km;
    const kmAntes = viagem.km?.toString() ?? "?";
    const nomeMot = (
      await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { nome: true },
      })
    )?.nome;

    await this.prisma.viagem.update({
      where: { id: viagemId },
      data: {
        status: "AJUSTADA",
        tipoDivergencia: null,
        ...(kmMudou
          ? { km: input.km, kmEditadoManual: true, kmFonte: "MANUAL" as const }
          : {}),
      },
    });

    // A resposta vira mensagem no chat da viagem (não vai mais pra observação).
    await this.mensagens.criar({
      viagemId,
      autor: "MOTORISTA",
      motoristaId,
      autorNome: nomeMot ?? "Motorista",
      texto: kmMudou
        ? `Corrigi o km de ${kmAntes} para ${input.km} km. ${justificativa}`
        : justificativa,
      acao: "CORRIGIU_KM",
    });

    // Km pode ter mudado → re-carimba o atípico.
    void this.kmAtipico.avaliarViagem(viagemId);

    try {
      await this.auditoria.log({
        usuarioId: null,
        entidade: "Viagem",
        entidadeId: viagemId,
        acao: AcaoAuditoria.MOTORISTA_JUSTIFICOU_KM,
        campo: "km",
        valorAntes: viagem.km?.toString() ?? null,
        valorDepois: kmMudou ? String(input.km) : (viagem.km?.toString() ?? null),
        motivo: `Motorista justificou o km${kmMudou ? ` (corrigiu para ${input.km} km)` : ""}: ${justificativa}`,
        metadata: { motoristaId, kmMudou, justificativa },
      });
    } catch {
      // best-effort
    }

    void this.notificarAdmins(
      "resposta-divergencia-km",
      `${nomeMot ?? "Motorista"} respondeu o km`,
      kmMudou
        ? `Corrigiu para ${input.km} km e justificou — viagem aguardando sua revisão`
        : `Justificou o km — viagem aguardando sua revisão`,
      { viagemId, motoristaId, justificativa, ...(input.km != null ? { km: input.km } : {}) },
    );

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

    const nomeFoto = (
      await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { nome: true },
      })
    )?.nome;
    await this.mensagens.criar({
      viagemId,
      autor: "MOTORISTA",
      motoristaId,
      autorNome: nomeFoto ?? "Motorista",
      texto: "Enviei uma foto nova do ticket.",
      acao: "ENVIOU_FOTO",
    });
    void this.notificarAdmins(
      "resposta-divergencia-foto",
      `${nomeFoto ?? "Motorista"} enviou foto nova`,
      `Resposta à divergência de foto — viagem aguardando sua revisão`,
      { viagemId, motoristaId },
    );

    return this.detalhe(motoristaId, viagemId);
  }

  /** Chat da viagem: histórico de mensagens (valida que a viagem é do motorista). */
  async listarMensagens(motoristaId: string, viagemId: string) {
    const v = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { motoristaId: true },
    });
    if (!v) throw new NotFoundException("Viagem não encontrada.");
    if (v.motoristaId !== motoristaId) throw new ForbiddenException("Esta viagem não é sua.");
    return this.mensagens.listar(viagemId);
  }

  /** Motorista manda uma mensagem no chat da viagem + notifica os admins. */
  async enviarMensagem(motoristaId: string, viagemId: string, texto: string) {
    const v = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { motoristaId: true, motorista: { select: { nome: true } } },
    });
    if (!v) throw new NotFoundException("Viagem não encontrada.");
    if (v.motoristaId !== motoristaId) throw new ForbiddenException("Esta viagem não é sua.");
    await this.mensagens.criar({
      viagemId,
      autor: "MOTORISTA",
      motoristaId,
      autorNome: v.motorista?.nome ?? "Motorista",
      texto: texto.trim(),
    });
    void this.notificarAdmins(
      "nova-mensagem-viagem",
      `${v.motorista?.nome ?? "Motorista"} mandou uma mensagem`,
      texto.trim().slice(0, 120),
      { viagemId, motoristaId },
    );
    return this.mensagens.listar(viagemId);
  }

  async adicionarFoto(motoristaId: string, viagemId: string, storageKey: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { id: true, motoristaId: true, ticket: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Você não pode anexar foto nesta viagem.");
    }
    const foto = await this.prisma.ticketFoto.create({
      data: { viagemId, storageKey, capturadaEm: new Date() },
      select: { id: true, storageKey: true },
    });

    void (async () => {
      const m = await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { nome: true },
      });
      await this.notificarAdmins(
        "foto-anexada",
        `${m?.nome ?? "Motorista"} anexou foto`,
        viagem.ticket ? `Foto extra em viagem do ticket ${viagem.ticket}` : "Foto extra em viagem sem ticket",
        { viagemId, motoristaId },
      );
    })();

    return foto;
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
        origemCadastro: "VIAGEM_OFFLINE",
      },
    });
  }

  /**
   * Sanitiza + ordena os trechos adicionais enviados pelo app (retorno do
   * bota-fora hoje). RETORNO_BOTA_FORA só passa se o material permite
   * (autoritativo) e usa SEMPRE o local de carga da viagem — garante a FK e a
   * semântica "volta pro carregamento". Retorna o array pronto pro nested create.
   */
  private montarTrechos(
    trechos: TrechoViagemInput[] | undefined,
    permiteBotaFora: boolean,
    localCargaId: string | null,
  ) {
    return (trechos ?? [])
      .filter((t) =>
        t.tipo === "RETORNO_BOTA_FORA" ? permiteBotaFora && !!localCargaId : true,
      )
      .map((t, i) => ({
        ordem: i + 1,
        tipo: t.tipo,
        localId: t.tipo === "RETORNO_BOTA_FORA" ? localCargaId! : t.localId,
        km: t.km,
        toneladas: t.toneladas ?? null,
        ticket: t.ticket ?? null,
      }));
  }

  async create(
    motoristaId: string,
    input: CriarViagemInput & { fotoKey?: string },
    appInfo?: AppInfoHeaders,
  ) {
    const exists = await this.prisma.viagem.findUnique({ where: { clientId: input.clientId } });
    if (exists) {
      // Idempotência: já recebido (sync duplicado), retorna o existente
      const existente = await this.prisma.viagem.findUnique({
        where: { clientId: input.clientId },
        include: VIAGEM_INCLUDE,
      });
      if (!existente) return null;
      // Chegou (mesmo que por reenvio): se havia cópia de segurança desse
      // lançamento esperando no painel, o caso está encerrado.
      void this.resgates.marcarQueSubiu(input.clientId);
      return serializarViagemComMinimos(existente, await this.regrasMinimoAtivas());
    }

    // Valida os cadastros que a viagem referencia ANTES de gravar, cada um com
    // a sua mensagem. Sem isso a FK estoura no banco e o motorista recebe uma
    // frase genérica que não diz se foi a placa, o cliente ou o material —
    // e sem saber o que corrigir, ele acaba descartando o lançamento.
    // Ordem = a da tela, pra ele achar o campo na hora de editar.
    await garantirCadastro(
      () =>
        this.prisma.veiculo.findUnique({
          where: { id: input.veiculoId },
          select: { id: true },
        }),
      "veiculoId",
    );

    const cliente = await this.prisma.cliente.findUnique({
      where: { id: input.clienteId },
      // A exigência de foto é da EMPRESA; a viagem chega nela pelo cliente.
      select: { empresaId: true, empresa: { select: { exigeFotoViagem: true } } },
    });
    if (!cliente) throw new ItemInexistenteException("clienteId");

    // Modo de serviço: define o que este lançamento exige (peso x período).
    // Autoritativo — o app esconde os campos, mas quem valida é aqui.
    const modo = await resolverModoServico(this.prisma, input.tipoServicoId);
    const ehPeriodo = modo.medicao === "PERIODO";

    // Material é lido aqui (e não junto do bota-fora, mais abaixo) porque a
    // validação do ticket já depende dele. Modo que não exige material (diária
    // de caminhão à disposição) grava materialId null.
    if (modo.exigeMaterial && !input.materialId) {
      throw new BadRequestException("Escolha o material.");
    }
    const materialId = modo.exigeMaterial ? input.materialId! : null;
    const material = materialId
      ? await this.prisma.material.findUnique({
          where: { id: materialId },
          select: { permiteBotaFora: true, temComprovanteFoto: true },
        })
      : null;
    if (materialId && !material) throw new ItemInexistenteException("materialId");

    if (modo.exigeLocalDescarga && !input.localDescargaId) {
      throw new BadRequestException("Escolha o local de descarga.");
    }
    if (modo.exigeKm && input.km == null) {
      throw new BadRequestException("Informe o km rodado.");
    }

    // Período (diária): valida entrada/saída e diz se a diária ficou aberta.
    const periodo = resolverPeriodo(modo, input);

    // Modo "aguardando peso": motorista lança sem peso/ticket porque o romaneio
    // só sai no fim do dia. Pula a validação de ticket (fica null); peso e ticket
    // entram depois via completarPeso (app) ou update admin (dashboard).
    // Serviço medido por período não tem peso nenhum — nunca entra nesse modo.
    const aguardandoPeso = !ehPeriodo && input.aguardandoPeso === true;
    if (!ehPeriodo && !aguardandoPeso && (input.toneladas == null || input.toneladas <= 0)) {
      throw new BadRequestException("Informe as toneladas.");
    }
    // Ticket: basta o modo OU o material dispensar. Modo que não exige pula a
    // checagem, mas mantém a unicidade por empresa se o número vier mesmo assim.
    const ticket =
      aguardandoPeso
        ? null
        : await this.validarTicketParaEmpresa(
            cliente.empresaId,
            materialId,
            input.ticket,
            undefined,
            modo.exigeTicket,
          );

    // Foto do comprovante: a empresa exige? Só carimba a falta — nunca recusa.
    // Recusar aqui mataria o item no outbox do motorista (ver common/exige-foto.ts).
    const exigeFoto = exigeFotoDaViagem({
      empresaExige: cliente.empresa?.exigeFotoViagem,
      materialTemComprovante: material?.temComprovanteFoto,
      modoExigeTicket: modo.exigeTicket,
    });

    // Trechos adicionais (retorno do bota-fora hoje). RETORNO_BOTA_FORA só vale se
    // o material permite (admin autoritativo, igual exigeTicket); o app só oferece
    // quando permite, aqui sanitiza por garantia.
    const trechosCreate = this.montarTrechos(
      input.trechos,
      material?.permiteBotaFora === true,
      input.localCargaId,
    );

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
    // Modo sem local de descarga (diária que começa e termina no mesmo lugar)
    // não tem o que validar aqui.
    if (input.localDescargaId) {
      await this.garantirLocal({
        id: input.localDescargaId,
        snapshot: input.localDescargaDados,
        lado: "descarga",
        motoristaId,
      });
    }

    const { fotoKey, clientId, pontos, ...rest } = input;

    // Procedência do km e o espelho de controle. kmFonte (novo) é o dono;
    // kmEditadoManual é derivado dele — "usou o histórico da frota" e "digitou na
    // mão" contam como decisão do motorista (o reprocessamento respeita ambos).
    // App antigo não manda kmFonte: aí caímos no kmEditadoManual que ele envia.
    const kmFonte = rest.kmFonte ?? null;
    const kmEditadoManual =
      kmFonte != null
        ? kmFonte === "MANUAL" || kmFonte === "HISTORICO"
        : rest.kmEditadoManual;

    // Frota dona do lançamento, carimbada agora — reclassificar o motorista
    // depois não pode mover esta viagem de frota. Ver common/transportadora.ts.
    const transportadoraId = await resolverTransportadora(
      this.prisma,
      motoristaId,
      rest.veiculoId,
    );

    const viagem = await this.prisma.viagem.create({
      data: {
        clientId,
        motoristaId,
        veiculoId: rest.veiculoId,
        clienteId: rest.clienteId,
        transportadoraId,
        materialId,
        tipoServicoId: modo.id,
        data: rest.data,
        // Aguardando peso: toneladas fica null até completar (romaneio no fim do
        // dia). Status AGUARDANDO_PESO mantém a viagem fora de match/fechamento/KPIs.
        // Serviço medido por período não tem peso — fica null sempre.
        toneladas: ehPeriodo ? null : aguardandoPeso ? null : rest.toneladas,
        entradaEm: periodo.entradaEm,
        saidaEm: periodo.saidaEm,
        duracaoMinutos: periodo.duracaoMinutos,
        // Diária aberta (sem saída) também é viagem incompleta: AGUARDANDO_SAIDA
        // a mantém fora de match/fechamento/KPIs até o motorista encerrar.
        status: aguardandoPeso
          ? "AGUARDANDO_PESO"
          : periodo.aguardandoSaida
            ? "AGUARDANDO_SAIDA"
            : undefined,
        ticket,
        km: rest.km,
        kmCalculado: rest.kmCalculado,
        kmEditadoManual,
        kmFonte,
        justificativaKm: rest.justificativaKm,
        rotaGeometria: rest.rotaGeometria,
        ...(trechosCreate.length ? { trechos: { create: trechosCreate } } : {}),
        observacao: rest.observacao,
        localCargaId: rest.localCargaId,
        localDescargaId: rest.localDescargaId,
        valorPedagioTotal: rest.valorPedagioTotal,
        lat: rest.lat,
        lng: rest.lng,
        descargaLat: rest.descargaLat,
        descargaLng: rest.descargaLng,
        descargaPrecisao: rest.descargaPrecisao,
        descargaFonte: rest.descargaFonte,
        descargaRaioUsadoM: rest.descargaRaioUsadoM,
        descargaDistanciaMetros: rest.descargaDistanciaMetros,
        descargaBuscaOffline: rest.descargaBuscaOffline,
        iniciadoEm: rest.iniciadoEm,
        kmReal: rest.kmReal,
        criadoOfflineEm: rest.criadoOfflineEm,
        appVersaoCriacao: appInfo?.appVersao ?? null,
        appUpdateIdCriacao: appInfo?.appUpdateId ?? null,
        ocrCampos: rest.ocrCampos ?? [],
        ocrConfidence: rest.ocrConfidence,
        justificativaSemFoto: resolverJustificativaSemFoto(
          exigeFoto,
          !!fotoKey,
          rest.justificativaSemFoto,
        ),
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

    void this.resgates.marcarQueSubiu(clientId);

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
    //
    // kmFonte manda: só MANUAL é "ajustou o km na mão". HISTORICO (aceitou o que a
    // frota já rodou no trajeto) diverge do OSRM de propósito e NÃO pode virar
    // evento de "ajustou km" — seria acusar o motorista do comportamento que a
    // própria feature pediu. Sem kmFonte (app antigo), mantém a regra velha
    // (km != kmCalculado).
    const houveAjusteManual =
      kmFonte === "MANUAL" ||
      (kmFonte == null &&
        rest.kmCalculado != null &&
        rest.km != null &&
        Math.abs(rest.kmCalculado - rest.km) > 0.001);
    if (houveAjusteManual) {
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
    // Modo sem local de descarga (diária) não tem par pra cachear.
    if (rest.localDescargaId) {
      void this.roteamento
        .calcularKm(rest.localCargaId, rest.localDescargaId)
        .catch(() => {
          /* best-effort: OSRM down, fora de cobertura, etc — nao bloqueia */
        });
    }

    // Viagem criada sem sinal (km estimado, kmCalculado null): recalcula pelo
    // trajeto real agora que o backend está online e avisa o motorista se mudou.
    // Self-guarda (só age quando kmCalculado null) — seguro chamar sempre.
    void this.kmReprocessamento.reprocessar(viagem.id);

    // Carimba se o km está fora do padrão do trajeto (backend autoritativo, roda
    // pra todo mundo independente da flag do app). Best-effort, nunca bloqueia.
    // Nota: se o km ainda for haversine (sem sinal), o reprocessamento acima vai
    // recalcular e re-chamar avaliarViagem lá dentro — este carimbo inicial é
    // sobre o que se tem agora e será corrigido quando o km real chegar.
    void this.kmAtipico.avaliarViagem(viagem.id);

    void (async () => {
      const m = await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { nome: true },
      });
      const quem = m?.nome ?? "motorista";
      const titulo = ehPeriodo
        ? periodo.aguardandoSaida
          ? `Diária aberta por ${quem}`
          : `Diária de ${quem}`
        : aguardandoPeso
          ? `Viagem sem peso de ${quem}`
          : `Nova viagem de ${quem}`;
      const corpo = ehPeriodo
        ? `${viagem.cliente?.nome ?? ""} · ${
            periodo.aguardandoSaida
              ? "aguardando a saída"
              : formatarDuracao(periodo.duracaoMinutos)
          }`
        : aguardandoPeso
          ? `${viagem.cliente?.nome ?? ""} · aguardando peso/romaneio`
          : `${viagem.ticket ? `Ticket ${viagem.ticket} · ` : ""}${viagem.cliente?.nome ?? ""} · ${viagem.toneladas ?? 0}t`;
      await this.notificarAdmins("nova-viagem", titulo, corpo, {
        viagemId: viagem.id,
        motoristaId,
      });
    })();

    // Aguardando peso: avisa o próprio motorista (push + WhatsApp) pra ele não
    // esquecer de completar o romaneio no fim do dia. Best-effort em background.
    if (aguardandoPeso) {
      void this.avisos.avisarViagemAguardandoPeso(viagem.id, motoristaId);
    }

    return serializarViagemComMinimos(viagem, await this.regrasMinimoAtivas());
  }

  /**
   * Valida o ticket de uma viagem: exige quando o material exige (autoritativo,
   * mesmo com o Zod relaxado) e garante unicidade por empresa. Retorna o ticket
   * limpo (ou null quando o material não exige). Reusado no create e no
   * completarPeso. `ignorarViagemId` exclui a própria viagem da checagem de
   * duplicidade (ao completar peso da viagem que já existe).
   */
  private async validarTicketParaEmpresa(
    empresaId: string,
    materialId: string | null,
    ticketRaw?: string | null,
    ignorarViagemId?: string,
    modoExigeTicket = true,
  ): Promise<string | null> {
    const material = materialId
      ? await this.prisma.material.findUnique({
          where: { id: materialId },
          select: { exigeTicket: true },
        })
      : null;
    const ticket = ticketRaw?.trim() || null;
    // Basta UM dos dois dispensar: o modo de serviço (diária não tem pesagem) ou
    // o material (concreto não gera ticket). A unicidade abaixo continua valendo
    // pro número que vier mesmo assim.
    const exige = modoExigeTicket && material?.exigeTicket !== false;
    if (exige && !ticket) {
      throw new BadRequestException("Informe o número do ticket.");
    }
    if (ticket) {
      const duplicado = await this.prisma.viagem.findFirst({
        where: {
          ticket,
          cliente: { empresaId },
          ...(ignorarViagemId ? { id: { not: ignorarViagemId } } : {}),
        },
        select: { id: true },
      });
      if (duplicado) {
        throw new ConflictException(
          `Ticket ${ticket} já foi lançado para essa empresa.`,
        );
      }
    }
    return ticket;
  }

  /**
   * Lista as viagens do motorista que estão AGUARDANDO_PESO (romaneio pendente).
   * Alimenta o banner e a tela "aguardando peso" do app. Ordena da mais antiga
   * pra mais nova (a que está esperando há mais tempo aparece primeiro).
   */
  async listarAguardandoPeso(motoristaId: string) {
    const viagens = await this.prisma.viagem.findMany({
      where: { motoristaId, status: "AGUARDANDO_PESO" },
      include: VIAGEM_INCLUDE,
      orderBy: { data: "asc" },
    });
    const regras = await this.regrasMinimoAtivas();
    return viagens.map((v) => serializarViagemComMinimos(v, regras));
  }

  /**
   * Lista as diárias do motorista que ficaram abertas (AGUARDANDO_SAIDA).
   * Alimenta o card "Diária aberta" na home do app. Espelha listarAguardandoPeso:
   * mais antiga primeiro, que é a que ele mais provavelmente esqueceu.
   */
  async listarAguardandoSaida(motoristaId: string) {
    const viagens = await this.prisma.viagem.findMany({
      where: { motoristaId, status: "AGUARDANDO_SAIDA" },
      include: VIAGEM_INCLUDE,
      orderBy: { entradaEm: "asc" },
    });
    const regras = await this.regrasMinimoAtivas();
    return viagens.map((v) => serializarViagemComMinimos(v, regras));
  }

  /**
   * Encerra uma diária aberta (AGUARDANDO_SAIDA): grava a saída, calcula a
   * duração e transita pra ENVIADA. Espelho de completarPeso, inclusive na
   * idempotência — se a diária já foi encerrada, devolve a viagem em vez de
   * erro, que é o que faz o retry do outbox offline não virar item preso.
   */
  async encerrarDiaria(motoristaId: string, viagemId: string, input: { saidaEm: Date }) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: { id: true, motoristaId: true, status: true, entradaEm: true, tipoServicoId: true },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    // Idempotência: já encerrada → devolve a atual.
    if (viagem.status !== "AGUARDANDO_SAIDA") {
      const atual = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        include: VIAGEM_INCLUDE,
      });
      return atual ? serializarViagemComMinimos(atual, await this.regrasMinimoAtivas()) : null;
    }

    // Reusa a mesma validação do create pra saída/duração — uma regra só.
    const modo = await resolverModoServico(this.prisma, viagem.tipoServicoId);
    const periodo = resolverPeriodo(modo, {
      entradaEm: viagem.entradaEm ?? undefined,
      saidaEm: input.saidaEm,
    });

    const atualizada = await this.prisma.viagem.update({
      where: { id: viagemId },
      data: {
        saidaEm: periodo.saidaEm,
        duracaoMinutos: periodo.duracaoMinutos,
        status: "ENVIADA",
      },
      include: VIAGEM_INCLUDE,
    });

    return serializarViagemComMinimos(atualizada, await this.regrasMinimoAtivas());
  }

  /**
   * Completa peso + ticket de uma viagem lançada em AGUARDANDO_PESO (o romaneio
   * saiu no fim do dia). Valida ticket (exigeTicket + unicidade), grava
   * toneladas/ticket, transita pra ENVIADA e roda mínimos + reprocessamento de
   * km. Idempotente: se a viagem já foi completada (ENVIADA), devolve a
   * existente em vez de erro — cobre retry do outbox offline.
   */
  async completarPeso(
    motoristaId: string,
    viagemId: string,
    input: { toneladas: number; ticket?: string },
  ) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        motoristaId: true,
        status: true,
        materialId: true,
        cliente: { select: { empresaId: true } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    // Idempotência: já completada (não está mais aguardando peso) → devolve.
    if (viagem.status !== "AGUARDANDO_PESO") {
      const atual = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        include: VIAGEM_INCLUDE,
      });
      return atual
        ? serializarViagemComMinimos(atual, await this.regrasMinimoAtivas())
        : null;
    }

    const ticket = await this.validarTicketParaEmpresa(
      viagem.cliente?.empresaId ?? "",
      viagem.materialId,
      input.ticket,
      viagemId,
    );

    const atualizada = await this.prisma.viagem.update({
      where: { id: viagemId },
      data: {
        toneladas: input.toneladas,
        ticket,
        status: "ENVIADA",
      },
      include: VIAGEM_INCLUDE,
    });

    // Agora que virou ENVIADA e tem km, recalcula pelo trajeto real se preciso.
    void this.kmReprocessamento.reprocessar(atualizada.id);

    return serializarViagemComMinimos(
      atualizada,
      await this.regrasMinimoAtivas(),
    );
  }

  // =========================================================================
  // Lifecycle guiado (Iniciar → eventos → Finalizar). Flag podeViagemLifecycle.
  // A viagem em andamento É a Viagem, no status EM_ANDAMENTO. Vira ENVIADA ao
  // finalizar, entrando no fluxo de conferência/fechamento normal.
  // =========================================================================

  /** Catálogo de tipos de evento ativos, ordenado (app renderiza os botões). */
  async catalogoTiposEvento() {
    return this.prisma.tipoEventoViagem.findMany({
      where: { ativo: true },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    });
  }

  /** Viagem em andamento do motorista (0 ou 1) com seus eventos + catálogo. */
  async viagemAndamento(motoristaId: string) {
    const [viagem, catalogo] = await Promise.all([
      this.prisma.viagem.findFirst({
        where: { motoristaId, status: "EM_ANDAMENTO" },
        include: {
          ...VIAGEM_INCLUDE,
          eventosViagem: { orderBy: { ocorridoEm: "asc" } },
        },
      }),
      this.catalogoTiposEvento(),
    ]);
    return { viagem, catalogo };
  }

  /**
   * Abre uma viagem EM_ANDAMENTO. Idempotente por clientId. Só permite uma
   * aberta por motorista (409 com o clientId da existente, pro app retomar).
   */
  async iniciar(motoristaId: string, input: IniciarViagemInput, appInfo?: AppInfoHeaders) {
    const existente = await this.prisma.viagem.findUnique({
      where: { clientId: input.clientId },
      include: { ...VIAGEM_INCLUDE, eventosViagem: { orderBy: { ocorridoEm: "asc" } } },
    });
    if (existente) return existente; // sync duplicado → mesma viagem

    // Uma viagem aberta por vez. Devolve o clientId da aberta pro app retomar
    // em vez de tentar criar outra. (Índice parcial no banco também garante.)
    const aberta = await this.prisma.viagem.findFirst({
      where: { motoristaId, status: "EM_ANDAMENTO" },
      select: { clientId: true },
    });
    if (aberta) {
      // O texto vai pro card de pendente do motorista e fica lá enquanto a vaga
      // não libera. Por isso ele precisa dizer as duas coisas que evitam pânico
      // (e evitam que ele apague a fila): nada se perdeu, e existe saída quando
      // a viagem presa não é dele resolver.
      throw new ConflictException({
        message:
          "Você já tem uma viagem em andamento. Finalize ela que as outras sobem " +
          "sozinhas na sequência — nenhuma se perde. Se ela travou, peça pro " +
          "escritório cancelar essa viagem.",
        clientIdEmAndamento: aberta.clientId,
      });
    }

    // Placa e cliente: mesma validação da viagem normal, mesma mensagem.
    await garantirCadastro(
      () =>
        this.prisma.veiculo.findUnique({
          where: { id: input.veiculoId },
          select: { id: true },
        }),
      "veiculoId",
    );
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: input.clienteId },
      select: { id: true },
    });
    if (!cliente) throw new ItemInexistenteException("clienteId");

    // Local de carga é opcional no iniciar (pode ser detectado por GPS já, ou
    // só no evento de carga). Auto-recovery se o id sumiu do servidor.
    if (input.localCargaId) {
      await this.garantirLocal({
        id: input.localCargaId,
        snapshot: input.localCargaDados,
        lado: "carga",
        motoristaId,
      });
    }

    const transportadoraId = await resolverTransportadora(
      this.prisma,
      motoristaId,
      input.veiculoId,
    );

    const viagem = await this.prisma.viagem.create({
      data: {
        clientId: input.clientId,
        motoristaId,
        veiculoId: input.veiculoId,
        clienteId: input.clienteId,
        transportadoraId,
        status: "EM_ANDAMENTO",
        iniciadaGuiada: true,
        iniciadoEm: input.iniciadoEm,
        lat: input.lat,
        lng: input.lng,
        localCargaId: input.localCargaId,
        criadoOfflineEm: input.criadoOfflineEm,
        appVersaoCriacao: appInfo?.appVersao ?? null,
        appUpdateIdCriacao: appInfo?.appUpdateId ?? null,
        // Captura da escolha do local de carga (GPS real do motorista + distância
        // até o local). Raio virou ordenação, não trava — isso audita a distância.
        cargaLat: input.cargaLat,
        cargaLng: input.cargaLng,
        cargaPrecisao: input.cargaPrecisao,
        cargaFonte: input.cargaFonte,
        cargaDistanciaMetros: input.cargaDistanciaMetros,
        cargaRaioUsadoM: input.cargaRaioUsadoM,
        cargaBuscaOffline: input.cargaBuscaOffline,
      },
      include: { ...VIAGEM_INCLUDE, eventosViagem: { orderBy: { ocorridoEm: "asc" } } },
    });

    void this.resgates.marcarQueSubiu(input.clientId);

    // Eventos disparados offline antes da viagem existir linkam por clientId.
    try {
      await this.eventos.reconciliarPorClientId(input.clientId, viagem.id);
    } catch {
      /* best-effort */
    }
    return viagem;
  }

  /**
   * Registra um evento (carga/descarga/parada...) numa viagem em andamento.
   * Idempotente por id. Marcos ehCarga/ehDescarga espelham campos na Viagem.
   * 404 (viagem ainda não existe no servidor) é tratado como transiente no app.
   */
  async registrarEvento(motoristaId: string, clientId: string, input: RegistrarEventoInput) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { clientId },
      select: { id: true, motoristaId: true, status: true, iniciadoEm: true },
    });
    if (!viagem) throw new NotFoundException("Viagem em andamento ainda não sincronizada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    if (viagem.status !== "EM_ANDAMENTO") {
      throw new BadRequestException("Essa viagem não está mais em andamento.");
    }

    const tipo = await this.prisma.tipoEventoViagem.findFirst({
      where: { slug: input.tipoSlug },
    });
    if (!tipo || !tipo.ativo) {
      throw new BadRequestException("Tipo de evento inválido ou desativado.");
    }

    // Idempotência: reenvio do mesmo evento (offline) não duplica.
    const jaExiste = await this.prisma.eventoViagem.findUnique({ where: { id: input.id } });
    if (jaExiste) return jaExiste;

    // Auto-recovery do local associado ao evento (carga/descarga por GPS).
    if (input.localId) {
      await this.garantirLocal({
        id: input.localId,
        snapshot: input.localDados,
        lado: tipo.ehDescarga ? "descarga" : "carga",
        motoristaId,
      });
    }

    const evento = await this.prisma.eventoViagem.create({
      data: {
        id: input.id,
        viagemId: viagem.id,
        tipoEventoId: tipo.id,
        tipoSlug: tipo.slug,
        lat: input.lat,
        lng: input.lng,
        precisao: input.precisao,
        localId: input.localId,
        fotoKey: input.fotoKey,
        toneladas: input.toneladas,
        valor: input.valor,
        ticket: input.ticket,
        observacao: input.observacao,
        ocorridoEm: input.ocorridoEm,
        criadoOfflineEm: input.criadoOfflineEm,
      },
    });

    // Marcos espelham campos da Viagem (compat com match/fechamento/dashboard).
    if (tipo.ehCarga) {
      await this.prisma.viagem.update({
        where: { id: viagem.id },
        data: {
          localCargaId: input.localId ?? undefined,
          lat: input.lat ?? undefined,
          lng: input.lng ?? undefined,
          iniciadoEm: viagem.iniciadoEm ?? input.ocorridoEm,
        },
      });
    }
    if (tipo.ehDescarga) {
      await this.prisma.viagem.update({
        where: { id: viagem.id },
        data: {
          localDescargaId: input.localId ?? undefined,
          descargaLat: input.lat ?? undefined,
          descargaLng: input.lng ?? undefined,
          descargaPrecisao: input.precisao ?? undefined,
          descargaFonte: input.fonte ?? undefined,
          descargaRaioUsadoM: input.raioUsadoM ?? undefined,
        },
      });
    }

    return evento;
  }

  /**
   * Finaliza a viagem em andamento: preenche os campos que faltavam, valida os
   * obrigatórios (autoritativo) e transita EM_ANDAMENTO → ENVIADA. Idempotente.
   */
  async finalizar(motoristaId: string, clientId: string, input: FinalizarViagemInput) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { clientId },
      select: { id: true, motoristaId: true, status: true, clienteId: true, localCargaId: true },
    });
    if (!viagem) throw new NotFoundException("Viagem em andamento ainda não sincronizada.");
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    // Já finalizada (reenvio) → idempotente.
    if (viagem.status !== "EM_ANDAMENTO") {
      const existente = await this.prisma.viagem.findUnique({
        where: { id: viagem.id },
        include: VIAGEM_INCLUDE,
      });
      return serializarViagemComMinimos(existente!, await this.regrasMinimoAtivas());
    }

    // Cliente já foi escolhido no iniciar — reusa o da viagem se o app não
    // reenviar. Compat: aceita clienteId no input (edição futura).
    const clienteIdEfetivo = input.clienteId ?? viagem.clienteId;
    if (!clienteIdEfetivo) throw new BadRequestException("Cliente não informado.");
    const cliente = await this.prisma.cliente.findUnique({
      where: { id: clienteIdEfetivo },
      // empresa.exigeFotoViagem: a exigência de foto é da empresa do cliente.
      select: { empresaId: true, empresa: { select: { exigeFotoViagem: true } } },
    });
    if (!cliente) throw new NotFoundException("Cliente não encontrado");

    // Modo "aguardando peso": finaliza sem peso/ticket (romaneio no fim do dia).
    // Pula a validação de ticket (fica null) e a viagem vai pra AGUARDANDO_PESO
    // em vez de ENVIADA; peso e ticket entram depois via completarPeso/admin.
    const aguardandoPeso = input.aguardandoPeso === true;
    const ticket = aguardandoPeso
      ? null
      : await this.validarTicketParaEmpresa(
          cliente.empresaId,
          input.materialId,
          input.ticket,
          viagem.id,
        );

    // Trechos adicionais (retorno do bota-fora). RETORNO_BOTA_FORA só vale se o
    // material permite (autoritativo); o app só oferece quando permite. localCarga
    // vem da viagem (foi escolhido no iniciar).
    const materialFin = await this.prisma.material.findUnique({
      where: { id: input.materialId },
      select: { permiteBotaFora: true, temComprovanteFoto: true },
    });
    if (!materialFin) throw new ItemInexistenteException("materialId");

    // Foto do comprovante (mesma regra do create): carimba a falta, nunca recusa.
    // O lifecycle guiado não escolhe modo de serviço (diária não passa por aqui),
    // então só o material suprime.
    const exigeFotoFin = exigeFotoDaViagem({
      empresaExige: cliente.empresa?.exigeFotoViagem,
      materialTemComprovante: materialFin.temComprovanteFoto,
    });
    const trechosCreate = this.montarTrechos(
      input.trechos,
      materialFin.permiteBotaFora === true,
      viagem.localCargaId,
    );

    await this.garantirLocal({
      id: input.localDescargaId,
      snapshot: input.localDescargaDados,
      lado: "descarga",
      motoristaId,
    });

    const finalizada = await this.prisma.viagem.update({
      where: { id: viagem.id },
      data: {
        status: aguardandoPeso ? "AGUARDANDO_PESO" : "ENVIADA",
        clienteId: clienteIdEfetivo,
        materialId: input.materialId,
        data: input.data,
        toneladas: aguardandoPeso ? null : input.toneladas,
        km: input.km,
        kmCalculado: input.kmCalculado,
        // kmFonte é o dono; kmEditadoManual deriva dele (ver create). App antigo
        // sem kmFonte cai no kmEditadoManual que ele envia.
        kmEditadoManual:
          input.kmFonte != null
            ? input.kmFonte === "MANUAL" || input.kmFonte === "HISTORICO"
            : input.kmEditadoManual,
        kmFonte: input.kmFonte,
        justificativaKm: input.justificativaKm,
        rotaGeometria: input.rotaGeometria,
        // Recria os trechos do zero (idempotente em reenvio do finalizar).
        trechos: { deleteMany: {}, ...(trechosCreate.length ? { create: trechosCreate } : {}) },
        ticket,
        localDescargaId: input.localDescargaId,
        descargaLat: input.descargaLat,
        descargaLng: input.descargaLng,
        descargaPrecisao: input.descargaPrecisao,
        descargaFonte: input.descargaFonte,
        descargaRaioUsadoM: input.descargaRaioUsadoM,
        descargaDistanciaMetros: input.descargaDistanciaMetros,
        valorPedagioTotal: input.valorPedagioTotal,
        observacao: input.observacao,
        sincronizadoEm: new Date(),
        justificativaSemFoto: resolverJustificativaSemFoto(
          exigeFotoFin,
          !!input.fotoKey,
          input.justificativaSemFoto,
        ),
        ...(input.fotoKey
          ? { fotos: { create: { storageKey: input.fotoKey, capturadaEm: new Date() } } }
          : {}),
      },
      include: VIAGEM_INCLUDE,
    });

    // Revalida locais + garante rota (best-effort, igual create).
    try {
      await this.validacao.revalidarApos(finalizada.id);
    } catch {
      /* best-effort */
    }
    if (finalizada.localCargaId && finalizada.localDescargaId) {
      void this.roteamento
        .calcularKm(finalizada.localCargaId, finalizada.localDescargaId)
        .catch(() => {
          /* best-effort */
        });
    }
    // Finalizada sem sinal (km estimado): recalcula pelo trajeto real e avisa.
    void this.kmReprocessamento.reprocessar(finalizada.id);
    // Carimba se o km está fora do padrão do trajeto (igual ao create).
    void this.kmAtipico.avaliarViagem(finalizada.id);

    // Notifica os admins (inbox/sininho do dashboard) — mesma "Nova viagem" que
    // o fluxo de lançamento único dispara. Só ao FINALIZAR (a viagem em
    // andamento não notifica; aparece na tela "Viagens em andamento" ao vivo).
    void (async () => {
      const m = await this.prisma.motorista.findUnique({
        where: { id: motoristaId },
        select: { nome: true },
      });
      await this.notificarAdmins(
        "nova-viagem",
        aguardandoPeso
          ? `Viagem sem peso de ${m?.nome ?? "motorista"}`
          : `Nova viagem de ${m?.nome ?? "motorista"}`,
        aguardandoPeso
          ? `${finalizada.cliente?.nome ?? ""} · aguardando peso/romaneio`
          : `${finalizada.ticket ? `Ticket ${finalizada.ticket} · ` : ""}${finalizada.cliente?.nome ?? ""} · ${finalizada.toneladas ?? 0}t`,
        { viagemId: finalizada.id, motoristaId },
      );
    })();

    // Aguardando peso: avisa o motorista (push + WhatsApp) pra não esquecer de
    // completar o romaneio, igual ao lançamento único.
    if (aguardandoPeso) {
      void this.avisos.avisarViagemAguardandoPeso(finalizada.id, motoristaId);
    }

    return serializarViagemComMinimos(finalizada, await this.regrasMinimoAtivas());
  }

  /**
   * Cancela (apaga) uma viagem EM_ANDAMENTO do motorista. Usado pelo "Descartar
   * viagem" do app. Idempotente: se não existe ou já foi finalizada, retorna ok
   * sem erro (o motorista já não a quer; nada a fazer). Cascade apaga os
   * EventoViagem. Não apaga viagem já ENVIADA/conferida (só EM_ANDAMENTO).
   */
  async cancelar(motoristaId: string, clientId: string) {
    const viagem = await this.prisma.viagem.findUnique({
      where: { clientId },
      select: { id: true, motoristaId: true, status: true },
    });
    if (!viagem) return { ok: true, jaRemovida: true };
    if (viagem.motoristaId !== motoristaId) {
      throw new ForbiddenException("Esta viagem não é sua.");
    }
    if (viagem.status !== "EM_ANDAMENTO") {
      // Já finalizada — não dá pra cancelar por aqui; nada a fazer.
      return { ok: true, jaFinalizada: true };
    }
    await this.prisma.viagem.delete({ where: { id: viagem.id } });
    return { ok: true };
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
