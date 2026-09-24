import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AbrirManutencaoDoProblemaInput,
  AtualizarManutencaoInput,
  AtualizarPlanoManutencaoInput,
  AvisarProblemaVeiculoInput,
  AtualizarMultaInput,
  CriarManutencaoInput,
  CriarMultaInput,
  CriarPlanoManutencaoInput,
  SalvarDocumentoVeiculoInput,
  SalvarPneuInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { filtroEscopo, SEM_ESCOPO, type EscopoAdmin } from "../../common/escopo/escopo";
import { avaliarPlano, diasParaIndicar, situacaoPneu } from "../../common/manutencao";
import { checarArquivoEnviado, MIMES_IMAGEM } from "../../common/arquivo-enviado";
import { UploadsService } from "../../uploads/uploads.service";
import { AdminInboxService } from "../inbox/inbox.service";
import { PushService } from "../../push/push.service";

/** Fotos por aviso: o que mostra o problema sem virar álbum. */
export const MAX_FOTOS_PROBLEMA = 3;
const MAX_BYTES_FOTO_PROBLEMA = 10 * 1024 * 1024;

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

@Injectable()
export class FrotaManutencaoService {
  private readonly log = new Logger(FrotaManutencaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly inbox: AdminInboxService,
    private readonly push: PushService,
  ) {}

  /** Parado primeiro, depois "com cuidado", depois o resto; mais novo antes. */
  private static ordemUrgencia(p: { podeRodar: string | null; avisadoEm: Date }) {
    return p.podeRodar === "NAO" ? 0 : p.podeRodar === "COM_CUIDADO" ? 1 : 2;
  }

  // ------------------------------------------------------------- manutenção

  listManutencoes(
    params: PaginationQuery & { veiculoId?: string; status?: string; tipo?: string },
    escopo: EscopoAdmin,
  ) {
    const where: Prisma.ManutencaoVeiculoWhereInput = {};
    if (params.veiculoId) where.veiculoId = params.veiculoId;
    if (params.status) where.status = params.status as Prisma.ManutencaoVeiculoWhereInput["status"];
    if (params.tipo) where.tipo = params.tipo as Prisma.ManutencaoVeiculoWhereInput["tipo"];
    // Manutenção não tem coluna de frota: o recorte vem do veículo, que tem.
    if (escopo) where.veiculo = filtroEscopo(escopo) as Prisma.VeiculoWhereInput;

    return paginate(this.prisma.manutencaoVeiculo, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["descricao", "observacao", "veiculo.placa"],
      sortable: { criadoEm: "criadoEm", previstaEm: "previstaEm", valorTotal: "valorTotal" },
      defaultSort: { field: "criadoEm", order: "desc" },
      include: {
        veiculo: { select: { id: true, placa: true, modelo: true } },
        fornecedor: { select: { id: true, nome: true } },
      },
    });
  }

  async criarManutencao(input: CriarManutencaoInput, usuarioId: string) {
    const v = await this.prisma.veiculo.findUnique({ where: { id: input.veiculoId } });
    if (!v) throw new NotFoundException("Veículo não encontrado");

    const { planoId, previstaEm, ...resto } = input;
    const total =
      (resto.valorPecas ?? 0) + (resto.valorMaoObra ?? 0) || null;

    const m = await this.prisma.manutencaoVeiculo.create({
      data: {
        ...resto,
        previstaEm: previstaEm ? diaUtc(previstaEm) : null,
        valorTotal: total,
        criadoPorId: usuarioId,
      },
      include: { veiculo: { select: { id: true, placa: true } } },
    });

    // Carimba a execução do plano preventivo. É isso que reinicia a contagem —
    // sem isso o plano ficaria eternamente vencido mesmo depois de feito.
    if (planoId) {
      await this.prisma.planoManutencao.updateMany({
        where: { id: planoId, veiculoId: input.veiculoId },
        data: {
          ultimoOdometro: input.odometro ?? undefined,
          ultimaEm: new Date(),
        },
      });
    }
    return m;
  }

  async atualizarManutencao(id: string, input: AtualizarManutencaoInput, usuarioId: string) {
    const atual = await this.prisma.manutencaoVeiculo.findUnique({
      where: { id },
      include: { veiculo: { select: { placa: true } } },
    });
    if (!atual) throw new NotFoundException("Manutenção não encontrada");

    const { gerarContaPagar, ...resto } = input;
    const pecas = resto.valorPecas ?? Number(atual.valorPecas ?? 0);
    const mao = resto.valorMaoObra ?? Number(atual.valorMaoObra ?? 0);
    const total = pecas + mao || null;

    const m = await this.prisma.manutencaoVeiculo.update({
      where: { id },
      data: {
        ...resto,
        valorTotal: total,
        ...(input.status === "EM_ANDAMENTO" && !atual.iniciadaEm ? { iniciadaEm: new Date() } : {}),
        ...(input.status === "CONCLUIDA" && !atual.concluidaEm
          ? { concluidaEm: new Date() }
          : {}),
      },
    });

    // A conta a pagar da oficina. Só quando pedido e só uma vez — gerar sozinho
    // criaria título duplicado a cada edição do valor.
    if (gerarContaPagar && total && !atual.tituloPagarId) {
      const titulo = await this.prisma.tituloPagar.create({
        data: {
          fornecedorId: atual.fornecedorId,
          veiculoId: atual.veiculoId,
          descricao: `Manutenção ${atual.veiculo.placa}: ${atual.descricao}`,
          emissao: new Date(),
          vencimento: new Date(),
          valor: total,
          criadoPorId: usuarioId,
        },
      });
      await this.prisma.manutencaoVeiculo.update({
        where: { id },
        data: { tituloPagarId: titulo.id },
      });
    }
    return m;
  }

  async removerManutencao(id: string) {
    const m = await this.prisma.manutencaoVeiculo.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Manutenção não encontrada");
    if (m.tituloPagarId) {
      throw new BadRequestException(
        "Essa manutenção já virou conta a pagar. Cancele a conta antes de apagar.",
      );
    }
    await this.prisma.manutencaoVeiculo.delete({ where: { id } });
    return { ok: true };
  }

  // ----------------------------------------------------------- plano e alerta

  /**
   * Os planos (a revisão de X em X km ou dias) pra tela cadastrar e conferir.
   * Os alertas já liam os planos; faltava a lista — a tela pedia pra
   * "cadastrar planos" sem ter onde (achado em 23/09/2026).
   */
  listarPlanos() {
    return this.prisma.planoManutencao.findMany({
      where: { ativo: true },
      orderBy: [{ veiculo: { placa: "asc" } }, { descricao: "asc" }],
      include: { veiculo: { select: { id: true, placa: true } } },
    });
  }

  criarPlano(input: CriarPlanoManutencaoInput) {
    return this.prisma.planoManutencao.create({
      data: {
        ...input,
        ultimaEm: input.ultimaEm ? diaUtc(input.ultimaEm) : null,
      },
    });
  }

  async atualizarPlano(id: string, input: AtualizarPlanoManutencaoInput) {
    const p = await this.prisma.planoManutencao.findFirst({ where: { id }, select: { id: true } });
    if (!p) throw new NotFoundException("Plano não encontrado");
    return this.prisma.planoManutencao.update({
      where: { id },
      data: {
        descricao: input.descricao,
        intervaloKm: input.intervaloKm ?? null,
        intervaloDias: input.intervaloDias ?? null,
        ultimoOdometro: input.ultimoOdometro ?? null,
        ultimaEm: input.ultimaEm ? diaUtc(input.ultimaEm) : null,
      },
    });
  }

  async removerPlano(id: string) {
    await this.prisma.planoManutencao.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * O painel da frota: o que está vencido, o que está chegando e o que já
   * parou o caminhão.
   *
   * Junta manutenção, documento, pneu e multa numa consulta só porque é assim
   * que o gestor pensa: "o que precisa de mim hoje?".
   */
  async alertas(escopo: EscopoAdmin) {
    const filtroVeiculo = escopo ? (filtroEscopo(escopo) as Prisma.VeiculoWhereInput) : {};

    const [planos, documentos, pneus, multas, emOficina] = await Promise.all([
      this.prisma.planoManutencao.findMany({
        where: { ativo: true, veiculo: filtroVeiculo },
        include: { veiculo: { select: { id: true, placa: true } } },
      }),
      this.prisma.documentoVeiculo.findMany({
        where: { validade: { not: null }, veiculo: filtroVeiculo },
        include: { veiculo: { select: { id: true, placa: true } } },
        orderBy: { validade: "asc" },
      }),
      this.prisma.pneu.findMany({
        where: { ativo: true, sulcoMm: { not: null }, veiculo: filtroVeiculo },
        include: { veiculo: { select: { id: true, placa: true } } },
      }),
      this.prisma.multa.findMany({
        where: { status: { in: ["RECEBIDA", "INDICADA"] }, veiculo: filtroVeiculo },
        include: {
          veiculo: { select: { id: true, placa: true } },
          motorista: { select: { id: true, nome: true } },
        },
        orderBy: { prazoIndicacao: "asc" },
      }),
      this.prisma.manutencaoVeiculo.findMany({
        where: { status: "EM_ANDAMENTO", veiculo: filtroVeiculo },
        include: { veiculo: { select: { id: true, placa: true } } },
      }),
    ]);
    // O que os motoristas avisaram e ninguém decidiu ainda. Aviso sem placa
    // (ele não soube dizer qual) só escapa do filtro quando não há escopo.
    const avisos = await this.prisma.problemaVeiculo.findMany({
      where: { status: "ABERTO", ...(escopo ? { veiculo: filtroVeiculo } : {}) },
      orderBy: { avisadoEm: "desc" },
      take: 50,
      select: {
        id: true,
        descricao: true,
        avisadoEm: true,
        fotos: true,
        podeRodar: true,
        veiculo: { select: { id: true, placa: true } },
        motorista: { select: { id: true, nome: true } },
      },
    });
    avisos.sort(
      (a, b) => FrotaManutencaoService.ordemUrgencia(a) - FrotaManutencaoService.ordemUrgencia(b),
    );

    // O odômetro mais recente de cada veículo sai do abastecimento — é o único
    // lugar onde ele é informado de verdade, e por isso o plano por km depende
    // de a frota anotar o odômetro ao abastecer.
    const odometros = await this.prisma.abastecimento.groupBy({
      by: ["veiculoId"],
      // `odometro` é Int NOT NULL no schema; filtrar por "not null" nem type-checa.
      // O que interessa é ter algum lançamento — zero é odômetro não anotado.
      where: { odometro: { gt: 0 } },
      _max: { odometro: true },
    });
    const odoPorVeiculo = new Map(
      odometros.map((o) => [o.veiculoId, o._max?.odometro ?? null]),
    );

    const hoje = new Date();
    const diasAte = (d: Date) =>
      Math.round(
        (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
          Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())) /
          86_400_000,
      );

    return {
      manutencoes: planos
        .map((p) => ({
          ...avaliarPlano(p, { odometro: odoPorVeiculo.get(p.veiculoId) ?? null, hoje }),
          veiculo: p.veiculo,
        }))
        .filter((a) => a.situacao === "VENCIDO" || a.situacao === "PROXIMO"),

      documentos: documentos
        .map((d) => ({
          id: d.id,
          tipo: d.tipo,
          veiculo: d.veiculo,
          validade: d.validade,
          diasRestantes: d.validade ? diasAte(d.validade) : null,
        }))
        // 45 dias é o horizonte que dá pra agendar licenciamento sem correria.
        .filter((d) => d.diasRestantes != null && d.diasRestantes <= 45),

      pneus: pneus
        .map((p) => ({
          id: p.id,
          numeroFogo: p.numeroFogo,
          posicao: p.posicao,
          sulcoMm: p.sulcoMm ? Number(p.sulcoMm) : null,
          veiculo: p.veiculo,
          situacao: situacaoPneu(p.sulcoMm ? Number(p.sulcoMm) : null),
        }))
        .filter((p) => p.situacao === "CRITICO" || p.situacao === "ATENCAO"),

      multas: multas.map((m) => ({
        id: m.id,
        infracao: m.infracao,
        veiculo: m.veiculo,
        motorista: m.motorista,
        valor: m.valor,
        status: m.status,
        prazoIndicacao: m.prazoIndicacao,
        diasParaIndicar: diasParaIndicar(m.prazoIndicacao, hoje),
      })),

      // Caminhão na oficina é caminhão que não roda — entra no alerta porque
      // some da programação sem ninguém lembrar por quê.
      avisosMotorista: avisos.map(({ fotos, ...a }) => ({ ...a, fotos: fotos.length })),

      emOficina: emOficina.map((m) => ({
        id: m.id,
        veiculo: m.veiculo,
        descricao: m.descricao,
        desde: m.iniciadaEm,
      })),
    };
  }

  // -------------------------------------------------- aviso do motorista

  /**
   * O motorista avisando um problema no caminhão, pelo app.
   *
   * Idempotente pelo `clientId`: o outbox reenvia depois de timeout, e o
   * segundo envio devolve o aviso que já existe em vez de duplicar.
   *
   * Nunca recusa por causa do caminhão: placa que não existe mais (ou de outra
   * empresa) vira aviso sem placa, e o escritório escolhe na hora de decidir.
   * Recusar travaria o item no aparelho por um dado que ele não tem como
   * consertar.
   */
  async avisarProblema(
    motoristaId: string,
    input: AvisarProblemaVeiculoInput,
    fotos: { buffer: Buffer; mimetype: string; size: number; originalname: string }[],
  ) {
    const existente = await this.prisma.problemaVeiculo.findFirst({
      where: { clientId: input.clientId },
      select: { id: true, status: true },
    });
    if (existente) return existente;

    if (fotos.length > MAX_FOTOS_PROBLEMA) {
      throw new BadRequestException(`Mande até ${MAX_FOTOS_PROBLEMA} fotos.`);
    }
    for (const f of fotos) {
      checarArquivoEnviado(f, {
        mimes: MIMES_IMAGEM,
        maxBytes: MAX_BYTES_FOTO_PROBLEMA,
        comoDizer: "Mande uma foto.",
      });
    }

    const veiculo = input.veiculoId
      ? await this.prisma.veiculo.findFirst({ where: { id: input.veiculoId }, select: { id: true } })
      : null;

    const chaves: string[] = [];
    for (const f of fotos) {
      chaves.push(await this.uploads.putProblemaVeiculoFoto(f.buffer, f.mimetype, motoristaId));
    }

    try {
      const novo = await this.prisma.problemaVeiculo.create({
        data: {
          clientId: input.clientId,
          motoristaId,
          veiculoId: veiculo?.id ?? null,
          descricao: input.descricao,
          fotos: chaves,
          avisadoEm: input.avisadoEm ?? new Date(),
          podeRodar: input.podeRodar ?? null,
          // A posição só vale junto de "parei": é o que o escritório precisa
          // pra mandar socorro, e não tem por que guardar fora disso.
          lat: input.podeRodar === "NAO" ? (input.lat ?? null) : null,
          lng: input.podeRodar === "NAO" ? (input.lng ?? null) : null,
        },
        select: { id: true, status: true },
      });
      await this.avisarEscritorio(novo.id);
      return novo;
    } catch (e) {
      // Dois envios do mesmo item ao mesmo tempo: o outro ganhou a corrida.
      if ((e as { code?: string }).code === "P2002") {
        for (const k of chaves) void this.uploads.removerObjeto(k).catch(() => {});
        const ganhou = await this.prisma.problemaVeiculo.findFirst({
          where: { clientId: input.clientId },
          select: { id: true, status: true },
        });
        if (ganhou) return ganhou;
      }
      throw e;
    }
  }

  /**
   * O sininho do painel: sem isto o aviso só era visto por quem abrisse a tela
   * de Manutenção. Vai pra quem vê manutenção. Best-effort — o aviso já está
   * gravado, e falhar aqui não pode devolver erro pro celular (reenviaria).
   */
  private async avisarEscritorio(problemaId: string) {
    try {
      const p = await this.prisma.problemaVeiculo.findFirst({
        where: { id: problemaId },
        select: {
          descricao: true,
          podeRodar: true,
          motoristaId: true,
          veiculoId: true,
          veiculo: { select: { placa: true } },
          motorista: { select: { nome: true } },
        },
      });
      if (!p) return;
      const placa = p.veiculo?.placa ?? "caminhão sem placa";
      await this.inbox.disparar({
        tipo: "problema-veiculo",
        titulo:
          p.podeRodar === "NAO"
            ? `Caminhão parado: ${placa}`
            : `${p.motorista.nome} avisou problema no ${placa}`,
        corpo: p.descricao.slice(0, 200),
        dados: { problemaId, motoristaId: p.motoristaId, veiculoId: p.veiculoId },
        permissao: "manutencao.ver",
      });
    } catch (e) {
      this.log.warn(`Sininho do aviso ${problemaId} não saiu: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Conta pro motorista o que o escritório decidiu. Sem isto ele avisava e
   * nunca sabia se alguém viu — e parceiro que não tem resposta para de avisar.
   */
  private async contarProMotorista(problemaId: string, titulo: string, corpo: string, usuarioId: string) {
    try {
      const p = await this.prisma.problemaVeiculo.findFirst({
        where: { id: problemaId },
        select: { motoristaId: true, motorista: { select: { expoPushToken: true } } },
      });
      if (!p) return;
      await this.push.enviar({
        motoristaId: p.motoristaId,
        token: p.motorista.expoPushToken ?? "",
        titulo,
        corpo,
        dados: { problemaId },
        tipo: "problema-veiculo-decidido",
        criadoPorId: usuarioId,
      });
    } catch (e) {
      this.log.warn(`Aviso ao motorista (${problemaId}) não saiu: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Os avisos que ESTE motorista mandou, pra ele acompanhar no app. */
  meusProblemas(motoristaId: string) {
    return this.prisma.problemaVeiculo
      .findMany({
        where: { motoristaId },
        orderBy: { avisadoEm: "desc" },
        take: 50,
        select: {
          id: true,
          clientId: true,
          descricao: true,
          avisadoEm: true,
          status: true,
          podeRodar: true,
          motivoDescarte: true,
          decididoEm: true,
          fotos: true,
          veiculo: { select: { placa: true } },
          manutencao: { select: { status: true } },
        },
      })
      .then((l) => l.map(({ fotos, ...p }) => ({ ...p, fotos: fotos.length })));
  }

  /** Os avisos, pro escritório. Sem filtro = os que esperam decisão. */
  listarProblemas(status?: string) {
    const valido = status === "VIROU_MANUTENCAO" || status === "DESCARTADO" ? status : "ABERTO";
    return this.prisma.problemaVeiculo
      .findMany({
        where: { status: valido },
        orderBy: { avisadoEm: "desc" },
        take: 200,
        select: {
          id: true,
          descricao: true,
          avisadoEm: true,
          status: true,
          fotos: true,
          podeRodar: true,
          lat: true,
          lng: true,
          motivoDescarte: true,
          decididoEm: true,
          manutencaoId: true,
          veiculo: { select: { id: true, placa: true } },
          motorista: { select: { id: true, nome: true } },
          decididoPor: { select: { id: true, nome: true } },
        },
      })
      // A chave do storage não sai daqui: a tela pede a foto pelo índice.
      .then((l) =>
        l
          .map(({ fotos, ...p }) => ({ ...p, fotos: fotos.length }))
          // Esperando decisão: o caminhão parado vai pro topo.
          .sort((a, b) =>
            valido === "ABERTO"
              ? FrotaManutencaoService.ordemUrgencia(a) - FrotaManutencaoService.ordemUrgencia(b) ||
                b.avisadoEm.getTime() - a.avisadoEm.getTime()
              : 0,
          ),
      );
  }

  /** A chave da foto `indice` do aviso, pra API servir (o bucket não é público). */
  async fotoDoProblema(id: string, indice: number): Promise<string> {
    const p = await this.prisma.problemaVeiculo.findFirst({
      where: { id },
      select: { fotos: true },
    });
    const chave = p?.fotos[indice];
    if (!chave) throw new NotFoundException("Foto não encontrada");
    return chave;
  }

  /**
   * O aviso vira uma manutenção aberta (corretiva, por padrão), e os dois
   * ficam ligados: quem abrir a OS sabe de onde ela veio.
   */
  async abrirManutencaoDoProblema(
    id: string,
    input: AbrirManutencaoDoProblemaInput,
    usuarioId: string,
  ) {
    const p = await this.prisma.problemaVeiculo.findFirst({ where: { id } });
    if (!p) throw new NotFoundException("Aviso não encontrado");
    if (p.status !== "ABERTO") throw new BadRequestException("Este aviso já foi decidido.");
    const veiculoId = input.veiculoId ?? p.veiculoId;
    if (!veiculoId) {
      throw new BadRequestException("Escolha o caminhão: o motorista não disse qual era.");
    }
    const v = await this.prisma.veiculo.findFirst({ where: { id: veiculoId }, select: { id: true } });
    if (!v) throw new NotFoundException("Veículo não encontrado");

    return this.prisma.$transaction(async (tx) => {
      const m = await tx.manutencaoVeiculo.create({
        data: {
          veiculoId,
          tipo: input.tipo ?? "CORRETIVA",
          descricao: (input.descricao ?? p.descricao).slice(0, 300),
          observacao: "Aberta a partir de um aviso do motorista pelo app.",
          criadoPorId: usuarioId,
        },
        select: { id: true },
      });
      await tx.problemaVeiculo.update({
        where: { id },
        data: {
          status: "VIROU_MANUTENCAO",
          manutencaoId: m.id,
          veiculoId,
          decididoPorId: usuarioId,
          decididoEm: new Date(),
        },
      });
      return { manutencaoId: m.id };
    }).then(async (r) => {
      await this.contarProMotorista(
        id,
        "Seu aviso virou manutenção",
        `O escritório abriu o conserto: ${p.descricao.slice(0, 120)}`,
        usuarioId,
      );
      return r;
    });
  }

  /** O aviso que não vira manutenção — com o motivo, pra ninguém reabrir no escuro. */
  async descartarProblema(id: string, motivo: string, usuarioId: string) {
    const p = await this.prisma.problemaVeiculo.findFirst({ where: { id }, select: { status: true } });
    if (!p) throw new NotFoundException("Aviso não encontrado");
    if (p.status !== "ABERTO") throw new BadRequestException("Este aviso já foi decidido.");
    await this.prisma.problemaVeiculo.update({
      where: { id },
      data: {
        status: "DESCARTADO",
        motivoDescarte: motivo,
        decididoPorId: usuarioId,
        decididoEm: new Date(),
      },
    });
    await this.contarProMotorista(
      id,
      "O escritório viu seu aviso",
      `Não vai virar conserto agora: ${motivo}`,
      usuarioId,
    );
    return { ok: true };
  }

  // ----------------------------------------------------------------- pneus

  listPneus(params: PaginationQuery & { veiculoId?: string; ativo?: string }) {
    const where: Prisma.PneuWhereInput = {};
    if (params.veiculoId) where.veiculoId = params.veiculoId;
    if (params.ativo === "false") where.ativo = false;
    else where.ativo = true;
    return paginate(this.prisma.pneu, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["numeroFogo", "marca", "medida", "veiculo.placa"],
      sortable: { numeroFogo: "numeroFogo", sulcoMm: "sulcoMm", criadoEm: "criadoEm" },
      defaultSort: { field: "sulcoMm", order: "asc" },
      include: { veiculo: { select: { id: true, placa: true } } },
    });
  }

  async salvarPneu(input: SalvarPneuInput, id?: string) {
    const data = {
      ...input,
      // Medir o sulco carimba a data: sem isso não dá pra saber se a medição é
      // de ontem ou de um ano atrás, e sulco antigo é pior que nenhum.
      ...(input.sulcoMm != null ? { medidoEm: new Date() } : {}),
    };
    if (id) return this.prisma.pneu.update({ where: { id }, data });
    return this.prisma.pneu.create({ data });
  }

  async removerPneu(id: string) {
    // Pneu não some: vira inativo. O histórico de custo por carcaça é o motivo
    // de existir controle de pneu.
    await this.prisma.pneu.update({ where: { id }, data: { ativo: false, veiculoId: null } });
    return { ok: true };
  }

  // ----------------------------------------------------------------- multas

  listMultas(params: PaginationQuery & { status?: string; veiculoId?: string; motoristaId?: string }) {
    const where: Prisma.MultaWhereInput = {};
    if (params.status) where.status = params.status as Prisma.MultaWhereInput["status"];
    if (params.veiculoId) where.veiculoId = params.veiculoId;
    if (params.motoristaId) where.motoristaId = params.motoristaId;
    return paginate(this.prisma.multa, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["infracao", "numeroAit", "local", "veiculo.placa", "motorista.nome"],
      sortable: { ocorridaEm: "ocorridaEm", valor: "valor", prazoIndicacao: "prazoIndicacao" },
      defaultSort: { field: "ocorridaEm", order: "desc" },
      include: {
        veiculo: { select: { id: true, placa: true } },
        motorista: { select: { id: true, nome: true } },
      },
    });
  }

  criarMulta(input: CriarMultaInput, usuarioId: string) {
    return this.prisma.multa.create({
      data: {
        ...input,
        ocorridaEm: new Date(input.ocorridaEm),
        vencimento: input.vencimento ? diaUtc(input.vencimento) : null,
        prazoIndicacao: input.prazoIndicacao ? diaUtc(input.prazoIndicacao) : null,
        criadoPorId: usuarioId,
      },
    });
  }

  async atualizarMulta(id: string, input: AtualizarMultaInput) {
    const m = await this.prisma.multa.findUnique({ where: { id } });
    if (!m) throw new NotFoundException("Multa não encontrada");
    // Descontar do motorista exige saber QUEM é o motorista. Marcar o desconto
    // sem condutor indicado geraria um débito sem dono no acerto.
    if (input.descontarDoMotorista && !(input.motoristaId ?? m.motoristaId)) {
      throw new BadRequestException(
        "Indique o condutor antes de marcar pra descontar dele.",
      );
    }
    return this.prisma.multa.update({ where: { id }, data: input });
  }

  // --------------------------------------------------------- documentos

  listDocumentos(veiculoId?: string) {
    return this.prisma.documentoVeiculo.findMany({
      where: veiculoId ? { veiculoId } : {},
      include: { veiculo: { select: { id: true, placa: true } } },
      orderBy: [{ veiculoId: "asc" }, { tipo: "asc" }],
    });
  }

  salvarDocumento(input: SalvarDocumentoVeiculoInput) {
    const { veiculoId, tipo, validade, ...resto } = input;
    return this.prisma.documentoVeiculo.upsert({
      where: { veiculoId_tipo: { veiculoId, tipo } },
      create: {
        veiculoId,
        tipo,
        validade: validade ? diaUtc(validade) : null,
        ...resto,
      },
      update: { validade: validade ? diaUtc(validade) : null, ...resto },
    });
  }

  async removerDocumento(id: string) {
    await this.prisma.documentoVeiculo.delete({ where: { id } });
    return { ok: true };
  }
}
