import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  ConfirmarConsertoInput,
  CriarPlanosEmLoteInput,
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
import { checarArquivoEnviado, MIMES_DOCUMENTO, MIMES_IMAGEM } from "../../common/arquivo-enviado";
import { kmAtual, type KmAtual, type LeituraOdometro } from "../../common/km-atual";
import { inicioDoDiaData, ymdSaoPaulo } from "../../common/timezone";
import { UploadsService } from "../../uploads/uploads.service";
import { AdminInboxService } from "../inbox/inbox.service";
import { PushService } from "../../push/push.service";

/** Fotos por aviso: o que mostra o problema sem virar álbum. */
export const MAX_FOTOS_PROBLEMA = 3;
const MAX_BYTES_FOTO_PROBLEMA = 10 * 1024 * 1024;

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * Dias até a data (coluna @db.Date) contando de HOJE no Brasil. Contava do dia
 * UTC: depois das 21h o documento "vencia" um dia antes na tela.
 */
function diasAte(d: Date): number {
  return Math.round((d.getTime() - inicioDoDiaData().getTime()) / 86_400_000);
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

    const { planoId, previstaEm, status, gerarContaPagar, ...resto } = input;
    const total =
      (resto.valorPecas ?? 0) + (resto.valorMaoObra ?? 0) || null;
    // Plano de OUTRO caminhão não se liga: zeraria a contagem errada.
    const plano = planoId
      ? await this.prisma.planoManutencao.findFirst({
          where: { id: planoId, veiculoId: input.veiculoId },
          select: { id: true },
        })
      : null;
    const concluida = status === "CONCLUIDA";
    const agora = new Date();

    const m = await this.prisma.manutencaoVeiculo.create({
      data: {
        ...resto,
        status: concluida ? "CONCLUIDA" : "ABERTA",
        ...(concluida ? { concluidaEm: agora } : {}),
        previstaEm: previstaEm ? diaUtc(previstaEm) : null,
        valorTotal: total,
        planoId: plano?.id ?? null,
        criadoPorId: usuarioId,
      },
      include: { veiculo: { select: { id: true, placa: true } } },
    });

    // "Já foi feita": fecha tudo agora. Aberta: o plano espera a conclusão.
    if (concluida) {
      await this.zerarPlano(m.planoId, m.veiculoId, m.odometro, agora);
      if (gerarContaPagar) await this.gerarConta(m.id, usuarioId);
    }
    return m;
  }

  /**
   * Reinicia a contagem do plano que a OS cumpriu, com a data e o odômetro do
   * SERVIÇO. É o que tira o plano de "vencido" — sem isto ele ficava vencido
   * pra sempre depois do serviço feito. Odômetro ausente não apaga o anterior.
   */
  private async zerarPlano(
    planoId: string | null,
    veiculoId: string,
    odometro: number | null,
    quando: Date,
  ) {
    if (!planoId) return;
    await this.prisma.planoManutencao.updateMany({
      where: { id: planoId, veiculoId },
      data: {
        ...(odometro != null ? { ultimoOdometro: odometro } : {}),
        // O dia de SÃO PAULO: concluído às 22h ainda é hoje, não amanhã em UTC.
        ultimaEm: inicioDoDiaData(quando),
      },
    });
  }

  /**
   * A conta a pagar da oficina. Só quando pedido, só uma vez e só com valor —
   * gerar sozinho criaria título duplicado a cada edição; sem valor não há o
   * que pagar (antes o botão prometia a conta e não lançava nada).
   */
  private async gerarConta(manutencaoId: string, usuarioId: string) {
    const m = await this.prisma.manutencaoVeiculo.findUnique({
      where: { id: manutencaoId },
      include: { veiculo: { select: { placa: true } } },
    });
    if (!m || m.tituloPagarId || !m.valorTotal || Number(m.valorTotal) <= 0) return;
    const titulo = await this.prisma.tituloPagar.create({
      data: {
        fornecedorId: m.fornecedorId,
        veiculoId: m.veiculoId,
        descricao: `Manutenção ${m.veiculo.placa}: ${m.descricao}`,
        emissao: new Date(),
        vencimento: new Date(),
        valor: m.valorTotal,
        criadoPorId: usuarioId,
      },
    });
    await this.prisma.manutencaoVeiculo.update({
      where: { id: manutencaoId },
      data: { tituloPagarId: titulo.id },
    });
  }

  async atualizarManutencao(id: string, input: AtualizarManutencaoInput, usuarioId: string) {
    const atual = await this.prisma.manutencaoVeiculo.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException("Manutenção não encontrada");

    const { gerarContaPagar, ...resto } = input;
    const pecas = resto.valorPecas ?? Number(atual.valorPecas ?? 0);
    const mao = resto.valorMaoObra ?? Number(atual.valorMaoObra ?? 0);
    const total = pecas + mao || null;
    const concluindoAgora = input.status === "CONCLUIDA" && atual.status !== "CONCLUIDA";
    const agora = new Date();

    const m = await this.prisma.manutencaoVeiculo.update({
      where: { id },
      data: {
        ...resto,
        valorTotal: total,
        ...(input.status === "EM_ANDAMENTO" && !atual.iniciadaEm ? { iniciadaEm: agora } : {}),
        ...(input.status === "CONCLUIDA" && !atual.concluidaEm ? { concluidaEm: agora } : {}),
      },
    });

    // Concluir é o momento em que o plano ligado zera — com o odômetro da saída.
    if (concluindoAgora) await this.zerarPlano(m.planoId, m.veiculoId, m.odometro, agora);
    if (gerarContaPagar) await this.gerarConta(id, usuarioId);

    // A OS nasceu de um aviso do motorista: ele fica sabendo de cada passo.
    const entrouNaOficina = input.status === "EM_ANDAMENTO" && atual.status !== "EM_ANDAMENTO";
    if (entrouNaOficina || concluindoAgora) {
      const problema = await this.prisma.problemaVeiculo.findFirst({
        where: { manutencaoId: id },
        select: { id: true },
      });
      if (problema) {
        await this.contarProMotorista(
          problema.id,
          concluindoAgora ? "Conserto concluído" : "Seu caminhão entrou na oficina",
          concluindoAgora
            ? `${atual.descricao.slice(0, 100)} — confira se ficou bom e conte pra gente.`
            : atual.descricao.slice(0, 140),
          usuarioId,
        );
      }
    }
    return m;
  }

  // ---------------------------------------------------------------- anexos

  /** Nota da oficina ou foto do serviço, anexada à OS. */
  async anexarNaManutencao(
    id: string,
    arquivo: { buffer: Buffer; mimetype: string; size: number; originalname: string },
  ) {
    checarArquivoEnviado(arquivo, {
      mimes: MIMES_DOCUMENTO,
      maxBytes: 15 * 1024 * 1024,
      comoDizer: "Mande uma foto ou um PDF.",
    });
    const m = await this.prisma.manutencaoVeiculo.findFirst({ where: { id }, select: { anexos: true } });
    if (!m) throw new NotFoundException("Manutenção não encontrada");
    if (m.anexos.length >= 10) throw new BadRequestException("Esta manutenção já tem 10 anexos.");
    const chave = await this.uploads.putManutencaoAnexo(arquivo.buffer, arquivo.mimetype, id);
    await this.prisma.manutencaoVeiculo.update({
      where: { id },
      data: { anexos: { push: chave } },
    });
    return { anexos: m.anexos.length + 1 };
  }

  async anexoDaManutencao(id: string, indice: number): Promise<string> {
    const m = await this.prisma.manutencaoVeiculo.findFirst({ where: { id }, select: { anexos: true } });
    const chave = m?.anexos[indice];
    if (!chave) throw new NotFoundException("Anexo não encontrado");
    return chave;
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

  /** O mesmo plano em vários caminhões: um por caminhão, sem duplicar o que já existe. */
  async criarPlanosEmLote(input: CriarPlanosEmLoteInput) {
    const veiculos = await this.prisma.veiculo.findMany({
      where: { id: { in: input.veiculoIds } },
      select: { id: true },
    });
    const jaTem = await this.prisma.planoManutencao.findMany({
      where: { veiculoId: { in: veiculos.map((v) => v.id) }, descricao: input.descricao, ativo: true },
      select: { veiculoId: true },
    });
    const pular = new Set(jaTem.map((p) => p.veiculoId));
    const criar = veiculos.filter((v) => !pular.has(v.id));
    if (criar.length > 0) {
      await this.prisma.planoManutencao.createMany({
        data: criar.map((v) => ({
          veiculoId: v.id,
          descricao: input.descricao,
          intervaloKm: input.intervaloKm ?? null,
          intervaloDias: input.intervaloDias ?? null,
        })),
      });
    }
    return { criados: criar.length, jaTinham: pular.size };
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
        include: {
          veiculo: { select: { id: true, placa: true } },
          fornecedor: { select: { nome: true } },
        },
      }),
    ]);
    // Consertos abertos que ainda não entraram na oficina (o "agendado") e o
    // gasto de manutenção do mês — os números do topo da caixa de entrada.
    const [anoSP, mesSP] = ymdSaoPaulo();
    const inicioMes = new Date(Date.UTC(anoSP, mesSP - 1, 1, 3));
    const [agendadas, gasto] = await Promise.all([
      this.prisma.manutencaoVeiculo.findMany({
        where: { status: "ABERTA", veiculo: filtroVeiculo },
        orderBy: [{ previstaEm: "asc" }, { criadoEm: "asc" }],
        take: 50,
        include: {
          veiculo: { select: { id: true, placa: true } },
          fornecedor: { select: { nome: true } },
        },
      }),
      this.prisma.manutencaoVeiculo.aggregate({
        where: { status: "CONCLUIDA", concluidaEm: { gte: inicioMes }, veiculo: filtroVeiculo },
        _sum: { valorTotal: true },
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

    // O odômetro sai do abastecimento, do conserto concluído e da conferência
    // no prontuário — o plano por km depende de pelo menos um deles.
    // O km de hoje é ESTIMADO (common/km-atual.ts): última leitura confiável
    // mais o km das viagens. Era o maior odômetro já anotado, e um dígito a
    // mais prendia o plano em "vencido" pra sempre.
    const kms = await this.kmAtualDosVeiculos([...new Set(planos.map((p) => p.veiculoId))]);
    // Revisão que já tem conserto aberto (agendado ou na oficina) já foi
    // decidida: aparece em Agendado / Parados, não de novo em "Precisa de
    // decisão" — ali o Agendar abria uma segunda OS pro mesmo serviço.
    const planosComOs = new Set(
      [...agendadas, ...emOficina].map((m) => m.planoId).filter((id): id is string => Boolean(id)),
    );
    const odoPorVeiculo = new Map([...kms].map(([id, k]) => [id, k.km]));

    const hoje = new Date();

    return {
      manutencoes: planos
        .map((p) => ({
          ...avaliarPlano(p, { odometro: odoPorVeiculo.get(p.veiculoId) ?? null, hoje }),
          veiculo: p.veiculo,
        }))
        .filter((a) => a.situacao === "VENCIDO" || a.situacao === "PROXIMO")
        .filter((a) => !planosComOs.has(a.planoId)),

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
        oficina: m.fornecedor?.nome ?? null,
      })),
      agendadas: agendadas.map((m) => ({
        id: m.id,
        veiculo: m.veiculo,
        descricao: m.descricao,
        previstaEm: m.previstaEm,
        oficina: m.fornecedor?.nome ?? null,
      })),
      gastoMes: Number(gasto._sum.valorTotal ?? 0),
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

  /**
   * O motorista conferiu o conserto do aviso dele. "Voltou" vira aviso novo,
   * ligado ao mesmo caminhão, no topo da caixa do escritório.
   */
  async confirmarConserto(motoristaId: string, problemaId: string, input: ConfirmarConsertoInput) {
    const p = await this.prisma.problemaVeiculo.findFirst({
      where: { id: problemaId, motoristaId },
      select: {
        id: true,
        descricao: true,
        veiculoId: true,
        confirmacao: true,
        status: true,
        manutencao: { select: { status: true } },
      },
    });
    if (!p) throw new NotFoundException("Aviso não encontrado");
    // Idempotente: o app pode reenviar; a primeira resposta vale.
    if (p.confirmacao) return { confirmacao: p.confirmacao };
    if (p.status !== "VIROU_MANUTENCAO" || p.manutencao?.status !== "CONCLUIDA") {
      throw new BadRequestException("Esse conserto ainda não foi concluído.");
    }
    const confirmacao = input.ficouBom ? "FICOU_BOM" : "VOLTOU";
    await this.prisma.problemaVeiculo.update({
      where: { id: problemaId },
      data: { confirmacao, confirmadoEm: new Date() },
    });
    if (!input.ficouBom) {
      const novo = await this.prisma.problemaVeiculo.create({
        data: {
          clientId: `voltou-${problemaId}`,
          motoristaId,
          veiculoId: p.veiculoId,
          descricao: `O problema voltou depois do conserto: ${p.descricao}${
            input.comentario ? ` — ${input.comentario}` : ""
          }`.slice(0, 1000),
          avisadoEm: new Date(),
        },
        select: { id: true },
      });
      await this.avisarEscritorio(novo.id);
    }
    return { confirmacao };
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
          confirmacao: true,
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

    const plano = input.planoId
      ? await this.prisma.planoManutencao.findFirst({
          where: { id: input.planoId, veiculoId },
          select: { id: true },
        })
      : null;
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.manutencaoVeiculo.create({
        data: {
          veiculoId,
          tipo: input.tipo ?? "CORRETIVA",
          descricao: (input.descricao ?? p.descricao).slice(0, 300),
          observacao: "Aberta a partir de um aviso do motorista pelo app.",
          fornecedorId: input.fornecedorId ?? null,
          planoId: plano?.id ?? null,
          previstaEm: input.previstaEm ? diaUtc(input.previstaEm) : null,
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

  // ----------------------------------------------------------- prontuário

  /**
   * TUDO sobre UM caminhão numa tela: km, situação, custo do mês e do ano,
   * revisões, documentos, pneus e a linha do tempo. É a pergunta que o dono
   * faz ("como está o ABC-1234?") e que nenhuma tela respondia (24/09/2026).
   */
  async prontuario(veiculoId: string) {
    const veiculo = await this.prisma.veiculo.findFirst({
      where: { id: veiculoId },
      select: { id: true, placa: true, modelo: true, marca: true, anoModelo: true, ativo: true },
    });
    if (!veiculo) throw new NotFoundException("Veículo não encontrado");

    const [anoSP, mesSP] = ymdSaoPaulo();
    const inicioMes = new Date(Date.UTC(anoSP, mesSP - 1, 1, 3));
    const inicioAno = new Date(Date.UTC(anoSP, 0, 1, 3));

    const [km, planos, documentos, pneus, manutencoes, avisos, multas, conferidas, oficina, parado] =
      await Promise.all([
        this.kmAtualDosVeiculos([veiculoId]).then((m) => m.get(veiculoId)!),
        this.prisma.planoManutencao.findMany({ where: { veiculoId, ativo: true }, orderBy: { descricao: "asc" } }),
        this.prisma.documentoVeiculo.findMany({ where: { veiculoId }, orderBy: { validade: "asc" } }),
        this.prisma.pneu.findMany({ where: { veiculoId, ativo: true }, orderBy: { posicao: "asc" } }),
        this.prisma.manutencaoVeiculo.findMany({
          where: { veiculoId },
          orderBy: { criadoEm: "desc" },
          take: 60,
          include: { fornecedor: { select: { id: true, nome: true } } },
        }),
        this.prisma.problemaVeiculo.findMany({
          where: { veiculoId },
          orderBy: { avisadoEm: "desc" },
          take: 30,
          select: {
            id: true,
            descricao: true,
            avisadoEm: true,
            status: true,
            podeRodar: true,
            confirmacao: true,
            motorista: { select: { nome: true } },
          },
        }),
        this.prisma.multa.findMany({ where: { veiculoId }, orderBy: { ocorridaEm: "desc" }, take: 30 }),
        this.prisma.leituraOdometro.findMany({
          where: { veiculoId },
          orderBy: { lidoEm: "desc" },
          take: 10,
          include: { criadoPor: { select: { nome: true } } },
        }),
        this.prisma.manutencaoVeiculo.findFirst({ where: { veiculoId, status: "EM_ANDAMENTO" }, select: { id: true } }),
        this.prisma.problemaVeiculo.findFirst({
          where: { veiculoId, status: "ABERTO", podeRodar: "NAO" },
          select: { id: true },
        }),
      ]);

    // Custo: manutenção concluída, combustível e multas, no mês e no ano; e o
    // km rodado nas viagens do período pro R$/km.
    const periodo = async (desde: Date) => {
      const [man, comb, mul, kmV] = await Promise.all([
        this.prisma.manutencaoVeiculo.aggregate({
          where: { veiculoId, status: "CONCLUIDA", concluidaEm: { gte: desde } },
          _sum: { valorTotal: true },
        }),
        this.prisma.abastecimento.aggregate({
          where: { veiculoId, data: { gte: desde } },
          _sum: { valorTotal: true },
        }),
        this.prisma.multa.aggregate({
          where: { veiculoId, ocorridaEm: { gte: desde }, status: { not: "CANCELADA" } },
          _sum: { valor: true },
        }),
        this.prisma.viagem.aggregate({
          // Viagem.data é só o DIA (meia-noite UTC): a fronteira volta as 3h do fuso.
          where: {
            veiculoId,
            data: { gte: new Date(desde.getTime() - 3 * 3_600_000) },
            status: { not: "RASCUNHO_OFFLINE" },
          },
          _sum: { km: true },
        }),
      ]);
      const manutencao = Number(man._sum.valorTotal ?? 0);
      const combustivel = Number(comb._sum.valorTotal ?? 0);
      const multasV = Number(mul._sum.valor ?? 0);
      const total = manutencao + combustivel + multasV;
      const kmRodado = Number(kmV._sum.km ?? 0);
      return {
        manutencao,
        combustivel,
        multas: multasV,
        total,
        kmRodado,
        porKm: kmRodado > 0 ? Math.round((total / kmRodado) * 100) / 100 : null,
      };
    };
    const [custoMes, custoAno] = await Promise.all([periodo(inicioMes), periodo(inicioAno)]);

    const hoje = new Date();

    type Evento = { data: Date; tipo: string; titulo: string; detalhe: string | null; valor: number | null; ref: string };
    const linha: Evento[] = [
      ...manutencoes.map((m) => ({
        data: m.concluidaEm ?? m.criadoEm,
        tipo: m.status === "CONCLUIDA" ? "CONSERTO_CONCLUIDO" : m.status === "EM_ANDAMENTO" ? "NA_OFICINA" : "CONSERTO_ABERTO",
        titulo: m.descricao,
        detalhe: m.fornecedor?.nome ?? null,
        valor: m.valorTotal != null ? Number(m.valorTotal) : null,
        ref: m.id,
      })),
      ...avisos.map((a) => ({
        data: a.avisadoEm,
        tipo: "AVISO",
        titulo: a.descricao,
        detalhe: `Aviso de ${a.motorista.nome}`,
        valor: null,
        ref: a.id,
      })),
      ...multas.map((m) => ({
        data: m.ocorridaEm,
        tipo: "MULTA",
        titulo: m.infracao,
        detalhe: null,
        valor: Number(m.valor),
        ref: m.id,
      })),
      ...conferidas.map((c) => ({
        data: c.criadoEm,
        tipo: "ODOMETRO",
        titulo: `Odômetro conferido: ${c.odometro.toLocaleString("pt-BR")} km`,
        detalhe: c.criadoPor?.nome ?? null,
        valor: null,
        ref: c.id,
      })),
    ]
      .sort((a, b) => b.data.getTime() - a.data.getTime())
      .slice(0, 80);

    return {
      veiculo,
      km,
      situacao: oficina ? "NA_OFICINA" : parado ? "PARADO" : "RODANDO",
      custoMes,
      custoAno,
      planos: planos.map((p) => ({
        ...avaliarPlano(p, { odometro: km.km, hoje }),
        intervaloKm: p.intervaloKm,
        intervaloDias: p.intervaloDias,
        ultimoOdometro: p.ultimoOdometro,
        ultimaEm: p.ultimaEm,
      })),
      documentos: documentos.map((d) => ({
        id: d.id,
        tipo: d.tipo,
        numero: d.numero,
        validade: d.validade,
        diasRestantes: d.validade ? diasAte(d.validade) : null,
      })),
      pneus: pneus.map((p) => ({
        id: p.id,
        numeroFogo: p.numeroFogo,
        posicao: p.posicao,
        sulcoMm: p.sulcoMm != null ? Number(p.sulcoMm) : null,
        situacao: situacaoPneu(p.sulcoMm != null ? Number(p.sulcoMm) : null),
      })),
      avisosAbertos: avisos.filter((a) => a.status === "ABERTO").length,
      linhaDoTempo: linha,
    };
  }

  // ------------------------------------------------------------ km atual

  /**
   * O km estimado de cada caminhão (ver `common/km-atual.ts`): leituras do
   * abastecimento (último ano) e as conferidas, mais o km das viagens depois
   * da última leitura boa. Três consultas pra frota inteira, não por caminhão.
   */
  async kmAtualDosVeiculos(veiculoIds: string[]): Promise<Map<string, KmAtual>> {
    const out = new Map<string, KmAtual>();
    if (veiculoIds.length === 0) return out;
    const umAno = new Date(Date.now() - 400 * 86_400_000);
    const [abastecimentos, conferidas, consertos] = await Promise.all([
      this.prisma.abastecimento.findMany({
        where: { veiculoId: { in: veiculoIds }, odometro: { gt: 0 }, data: { gte: umAno } },
        select: { id: true, veiculoId: true, data: true, odometro: true },
      }),
      this.prisma.leituraOdometro.findMany({
        where: { veiculoId: { in: veiculoIds } },
        select: { id: true, veiculoId: true, lidoEm: true, odometro: true },
      }),
      // O odômetro anotado ao concluir o conserto também é leitura: a oficina
      // olhou o painel. Não é "conferida" — veio digitado da nota, e passa
      // pelo mesmo filtro de plausível que o abastecimento.
      this.prisma.manutencaoVeiculo.findMany({
        where: {
          veiculoId: { in: veiculoIds },
          status: "CONCLUIDA",
          odometro: { gt: 0 },
          concluidaEm: { gte: umAno },
        },
        select: { id: true, veiculoId: true, concluidaEm: true, odometro: true },
      }),
    ]);
    const porVeiculo = new Map<string, LeituraOdometro[]>();
    const add = (vid: string, l: LeituraOdometro) =>
      porVeiculo.set(vid, [...(porVeiculo.get(vid) ?? []), l]);
    for (const a of abastecimentos)
      add(a.veiculoId, { data: a.data, odometro: a.odometro, ref: a.id, origem: "ABASTECIMENTO" });
    for (const c of conferidas)
      add(c.veiculoId, { data: c.lidoEm, odometro: c.odometro, confiavel: true, ref: c.id, origem: "CONFERIDO" });
    for (const m of consertos)
      add(m.veiculoId, { data: m.concluidaEm!, odometro: m.odometro!, ref: m.id, origem: "CONSERTO" });

    // Primeiro a âncora de cada um (sem viagens), depois UMA consulta de km.
    const ancoras = new Map<string, Date>();
    for (const id of veiculoIds) {
      const k = kmAtual(porVeiculo.get(id) ?? [], () => 0);
      if (k.desde) ancoras.set(id, k.desde);
    }
    const somas = ancoras.size
      ? await this.prisma.viagem.groupBy({
          by: ["veiculoId"],
          where: {
            status: { not: "RASCUNHO_OFFLINE" },
            OR: [...ancoras].map(([veiculoId, desde]) => ({ veiculoId, data: { gt: desde } })),
          },
          _sum: { km: true },
        })
      : [];
    const kmDepois = new Map(somas.map((s) => [s.veiculoId, Number(s._sum.km ?? 0)]));
    for (const id of veiculoIds) {
      out.set(id, kmAtual(porVeiculo.get(id) ?? [], () => kmDepois.get(id) ?? 0));
    }
    return out;
  }

  /** O escritório conferiu o painel do caminhão: vira a âncora do km. */
  async conferirOdometro(
    veiculoId: string,
    input: { odometro: number; lidoEm: string; observacao?: string | null },
    usuarioId: string,
  ) {
    const v = await this.prisma.veiculo.findFirst({ where: { id: veiculoId }, select: { id: true } });
    if (!v) throw new NotFoundException("Veículo não encontrado");
    return this.prisma.leituraOdometro.create({
      data: {
        veiculoId,
        odometro: input.odometro,
        lidoEm: diaUtc(input.lidoEm),
        observacao: input.observacao ?? null,
        criadoPorId: usuarioId,
      },
    });
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

  async listDocumentos(veiculoId?: string) {
    const docs = await this.prisma.documentoVeiculo.findMany({
      where: veiculoId ? { veiculoId } : {},
      include: { veiculo: { select: { id: true, placa: true } } },
      orderBy: [{ veiculoId: "asc" }, { tipo: "asc" }],
    });
    return docs.map((d) => ({ ...d, diasRestantes: d.validade ? diasAte(d.validade) : null }));
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
