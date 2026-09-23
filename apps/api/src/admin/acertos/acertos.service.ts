import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma } from "@prisma/client";
import type {
  AdicionarItemAcertoInput,
  GerarAcertoInput,
  GerarAcertosEmLoteInput,
  MarcarAcertoPagoInput,
} from "@ronan/shared-types";
import { TIPOS_DEBITO_ACERTO } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { filtroEscopo, SEM_ESCOPO, type EscopoAdmin } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { dentroDeEmprego, periodosDeEmprego } from "../../common/regime-vigente";
import {
  calcularAcerto,
  resolverRemuneracao,
  totalizarAcerto,
  type AbastecimentoParaAcerto,
  type ViagemParaAcerto,
} from "../../common/acerto-motorista";

type ListParams = PaginationQuery & {
  motoristaId?: string;
  status?: string;
  de?: string;
  ate?: string;
};

const INCLUDE_DETALHE = {
  motorista: {
    select: {
      id: true,
      nome: true,
      cpf: true,
      chavePix: true,
      modalidade: { select: { id: true, nome: true } },
    },
  },
  fechadoPor: { select: { id: true, nome: true } },
  pagoPor: { select: { id: true, nome: true } },
  itens: {
    orderBy: [{ tipo: "asc" }, { criadoEm: "asc" }],
    include: {
      viagem: { select: { id: true, data: true, ticket: true } },
    },
  },
} satisfies Prisma.AcertoMotoristaInclude;

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

@Injectable()
export class AcertosService {
  private readonly log = new Logger(AcertosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  list(params: ListParams, escopo: EscopoAdmin) {
    const where: Prisma.AcertoMotoristaWhereInput = {};
    if (params.motoristaId) where.motoristaId = params.motoristaId;
    if (params.status) where.status = params.status as Prisma.AcertoMotoristaWhereInput["status"];
    if (params.de) where.periodoInicio = { gte: diaUtc(params.de) };
    if (params.ate) where.periodoFim = { lte: diaUtc(params.ate) };
    // O acerto não tem coluna de frota; o recorte vem do motorista, que tem.
    if (escopo) where.motorista = filtroEscopo(escopo) as Prisma.MotoristaWhereInput;

    return paginate(this.prisma.acertoMotorista, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["motorista.nome"],
      sortable: {
        periodoInicio: "periodoInicio",
        valorLiquido: "valorLiquido",
        status: "status",
        criadoEm: "criadoEm",
      },
      defaultSort: { field: "periodoInicio", order: "desc" },
      include: {
        motorista: { select: { id: true, nome: true } },
        _count: { select: { itens: true } },
      },
    });
  }

  async detalhe(id: string, escopo: EscopoAdmin) {
    const acerto = await this.prisma.acertoMotorista.findFirst({
      where: {
        id,
        ...(escopo ? { motorista: filtroEscopo(escopo) as Prisma.MotoristaWhereInput } : {}),
      },
      include: INCLUDE_DETALHE,
    });
    if (!acerto) throw new NotFoundException("Acerto não encontrado");

    const totais = totalizarAcerto(acerto.itens);
    return { ...acerto, ...totais };
  }

  /**
   * Gera ou REGENERA o acerto de um motorista no período.
   *
   * Regenerar é a operação normal, não a exceção: o operador abre o acerto no
   * dia 25, entram mais viagens até o 31, e ele gera de novo. Por isso só os
   * itens AUTOMÁTICOS são refeitos — o adiantamento que ele lançou à mão no dia
   * 25 tem que sobreviver, senão o trabalho dele se perde toda vez.
   */
  async gerar(input: GerarAcertoInput, usuarioId: string) {
    const inicio = diaUtc(input.periodoInicio);
    const fim = diaUtc(input.periodoFim);

    const motorista = await this.prisma.motorista.findUnique({
      where: { id: input.motoristaId },
      include: { modalidade: true },
    });
    if (!motorista) throw new NotFoundException("Motorista não encontrado");

    const existente = await this.prisma.acertoMotorista.findFirst({
      where: { motoristaId: input.motoristaId, periodoInicio: inicio, periodoFim: fim },
      select: { id: true, status: true },
    });
    // Acerto fechado é combinado. Regerar reescreveria o que o motorista já viu
    // e aceitou — se precisa mudar, reabre de propósito e assume o ato.
    if (existente && existente.status !== "ABERTO") {
      throw new ConflictException(
        "Este acerto já foi fechado. Reabra antes de gerar de novo.",
      );
    }

    const regra = resolverRemuneracao(motorista, motorista.modalidade);

    /**
     * ⚠️ DIA EM QUE ELE ERA EMPREGADO NÃO ENTRA NO ACERTO. Nenhuma linha.
     *
     * O acerto É o documento de pagamento do PARCEIRO. O filtro de regime
     * existia só nos dias de obra (o `regime: PARCEIRO` logo abaixo), e a
     * busca de viagens não olhava regime nenhum — então quem fosse registrado
     * em carteira e continuasse lançando viagem seguia gerando item de acerto
     * por produção. Isso é pagamento por fora pra empregado (art. 457 §1º da
     * CLT), e vinha com carimbo da nossa régua.
     *
     * A pergunta certa é por DATA, não "o que ele é hoje": quem foi parceiro
     * até março e foi registrado em abril tem direito ao acerto de março.
     */
    const periodosEmprego = await periodosDeEmprego(this.prisma, motorista.cpf ?? "");
    const foraDoEmprego = (data: Date | null) =>
      data != null && !dentroDeEmprego(periodosEmprego, data);
    // Período inteiro dentro do vínculo: não é acerto vazio, é acerto que não
    // existe. Vazio o operador leria como "ele não rodou".
    if (
      periodosEmprego.some(
        (pe) =>
          inicio.getTime() >= pe.inicio.getTime() &&
          (pe.fim === null || fim.getTime() <= pe.fim.getTime()),
      )
    ) {
      throw new ConflictException(
        "Neste período o motorista era empregado registrado desta empresa. " +
          "O que ele recebe vai por folha de pagamento — acerto de parceiro não se aplica.",
      );
    }

    const [viagens, abastecimentos, pedagiosAvulsos] = await Promise.all([
      this.prisma.viagem.findMany({
        where: {
          motoristaId: input.motoristaId,
          data: { gte: inicio, lte: fim },
          // Viagem incompleta não entra no acerto pelo mesmo motivo que não
          // entra no fechamento: pagar por uma viagem sem peso é pagar por um
          // dado que ainda vai mudar.
          status: { notIn: STATUS_FORA_FECHAMENTO },
        },
        select: {
          id: true,
          data: true,
          ticket: true,
          km: true,
          toneladas: true,
          valorPedagioTotal: true,
          cliente: { select: { nome: true } },
          valor: { select: { valorFrete: true } },
          pedagios: { select: { id: true, valor: true, pracaPedagio: true } },
        },
        orderBy: { data: "asc" },
      }),
      this.prisma.abastecimento.findMany({
        where: {
          motoristaId: input.motoristaId,
          data: { gte: inicio, lt: new Date(fim.getTime() + 86_400_000) },
        },
        select: { id: true, data: true, valorTotal: true, postoNome: true, emComboio: true },
        orderBy: { data: "asc" },
      }),
      this.prisma.pedagio.findMany({
        where: {
          motoristaId: input.motoristaId,
          data: { gte: inicio, lte: fim },
          viagemId: null,
        },
        select: { id: true, data: true, valor: true, pracaPedagio: true },
        orderBy: { data: "asc" },
      }),
    ]);

    const viagensParaAcerto: ViagemParaAcerto[] = viagens
      // `Viagem.data` é nullable no schema (lifecycle abre sem data). O filtro
      // de status já tira as incompletas, mas o tipo não sabe disso — e uma
      // viagem sem data não tem como entrar num acerto POR PERÍODO.
      .filter((v): v is typeof v & { data: Date } => v.data != null)
      // Dia de vínculo fora — ver `periodosEmprego`.
      .filter((v) => foraDoEmprego(v.data))
      .map((v) => ({
      id: v.id,
      data: v.data,
      ticket: v.ticket,
      km: v.km,
      toneladas: v.toneladas,
      valorPedagioTotal: v.valorPedagioTotal,
      valorFrete: v.valor?.valorFrete ?? null,
      clienteNome: v.cliente?.nome ?? null,
      pedagios: v.pedagios.map((p) => ({ id: p.id, valor: p.valor, praca: p.pracaPedagio })),
    }));

    const abastecimentosParaAcerto: AbastecimentoParaAcerto[] = abastecimentos
      .filter((a) => foraDoEmprego(a.data))
      .map((a) => ({
        id: a.id,
        data: a.data,
        valorTotal: a.valorTotal,
        postoNome: a.postoNome,
        emComboio: a.emComboio,
      }));

    const calculado = calcularAcerto({
      viagens: viagensParaAcerto,
      abastecimentos: abastecimentosParaAcerto,
      pedagiosAvulsos: pedagiosAvulsos
        .filter((p) => foraDoEmprego(p.data))
        .map((p) => ({
          id: p.id,
          data: p.data,
          valor: p.valor,
          praca: p.pracaPedagio,
        })),
      regra,
    });

    const acertoId = await this.prisma.$transaction(async (tx) => {
      const acerto = existente
        ? await tx.acertoMotorista.update({
            where: { id: existente.id },
            data: { alteradoEm: new Date() },
          })
        : await tx.acertoMotorista.create({
            data: {
              motoristaId: input.motoristaId,
              periodoInicio: inicio,
              periodoFim: fim,
            },
          });

      // Só o automático é varrido. Ver o comentário do método.
      await tx.itemAcerto.deleteMany({ where: { acertoId: acerto.id, automatico: true } });

      if (calculado.itens.length > 0) {
        await tx.itemAcerto.createMany({
          data: calculado.itens.map((i) => ({
            acertoId: acerto.id,
            tipo: i.tipo,
            viagemId: i.viagemId ?? null,
            pedagioId: i.pedagioId ?? null,
            abastecimentoId: i.abastecimentoId ?? null,
            descricao: i.descricao,
            valor: i.valor,
            automatico: true,
          })),
        });
      }

      await this.recalcularTotais(tx, acerto.id);
      return acerto.id;
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: acertoId,
      acao: AcaoAuditoria.UPDATE,
      motivo: existente ? "Acerto regerado" : "Acerto gerado",
    });

    const detalhe = await this.detalhe(acertoId, null);
    return { ...detalhe, semRemuneracao: calculado.semRemuneracao };
  }

  /**
   * Gera pra vários de uma vez — é assim que o fechamento do mês acontece de
   * verdade, não motorista a motorista.
   *
   * Em série: são N acertos com várias consultas cada um, e paralelizar isso
   * só serviria pra competir com o lançamento de viagem pelo mesmo pool.
   */
  async gerarEmLote(input: GerarAcertosEmLoteInput, usuarioId: string) {
    const motoristas = input.motoristaIds?.length
      ? await this.prisma.motorista.findMany({
          where: { id: { in: input.motoristaIds } },
          select: { id: true, nome: true },
        })
      : await this.prisma.motorista.findMany({
          where: { ativo: true },
          select: { id: true, nome: true },
        });

    const resultados: { motoristaId: string; nome: string; ok: boolean; erro?: string }[] = [];
    for (const m of motoristas) {
      try {
        await this.gerar(
          {
            motoristaId: m.id,
            periodoInicio: input.periodoInicio,
            periodoFim: input.periodoFim,
          },
          usuarioId,
        );
        resultados.push({ motoristaId: m.id, nome: m.nome, ok: true });
      } catch (e) {
        // Um motorista com acerto já fechado não pode derrubar a geração dos
        // outros 30 — o operador quer o lote, não a primeira exceção.
        resultados.push({
          motoristaId: m.id,
          nome: m.nome,
          ok: false,
          erro: (e as Error).message,
        });
      }
    }
    return {
      total: resultados.length,
      gerados: resultados.filter((r) => r.ok).length,
      resultados,
    };
  }

  /** Lança item à mão: adiantamento, desconto, bônus. */
  async adicionarItem(acertoId: string, input: AdicionarItemAcertoInput, usuarioId: string) {
    const acerto = await this.exigirAberto(acertoId);

    // O input é sempre positivo; o sinal sai do tipo. Deixar o operador digitar
    // "-300" é convite pra alguém digitar "300" e creditar um desconto.
    const ehDebito = (TIPOS_DEBITO_ACERTO as readonly string[]).includes(input.tipo);
    const valor = ehDebito ? -Math.abs(input.valor) : Math.abs(input.valor);

    const item = await this.prisma.itemAcerto.create({
      data: {
        acertoId,
        tipo: input.tipo,
        descricao: input.descricao,
        valor: new Prisma.Decimal(valor),
        motivo: input.motivo ?? null,
        automatico: false,
        criadoPorId: usuarioId,
      },
    });

    await this.prisma.$transaction(async (tx) => this.recalcularTotais(tx, acertoId));
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: acertoId,
      acao: AcaoAuditoria.UPDATE,
      campo: "itens",
      valorDepois: { tipo: input.tipo, valor, descricao: input.descricao },
      motivo: input.motivo ?? `Lançou ${input.tipo}`,
    });
    void acerto;
    return item;
  }

  async removerItem(acertoId: string, itemId: string, usuarioId: string) {
    await this.exigirAberto(acertoId);
    const item = await this.prisma.itemAcerto.findFirst({ where: { id: itemId, acertoId } });
    if (!item) throw new NotFoundException("Item não encontrado");
    if (item.automatico) {
      throw new BadRequestException(
        "Este item foi gerado pela regra. Pra tirá-lo, corrija a viagem e gere o acerto de novo.",
      );
    }

    await this.prisma.itemAcerto.delete({ where: { id: itemId } });
    await this.prisma.$transaction(async (tx) => this.recalcularTotais(tx, acertoId));
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: acertoId,
      acao: AcaoAuditoria.UPDATE,
      campo: "itens",
      valorAntes: { tipo: item.tipo, valor: item.valor.toString(), descricao: item.descricao },
      motivo: "Removeu item lançado à mão",
    });
    return { ok: true };
  }

  /**
   * Fecha o acerto: daqui pra frente os itens não mudam mais sozinhos, mesmo
   * que alguém edite uma viagem do período depois. Um extrato que muda depois
   * de combinado não é extrato.
   */
  async fechar(id: string, usuarioId: string) {
    const acerto = await this.exigirAberto(id);
    const itens = await this.prisma.itemAcerto.findMany({ where: { acertoId: id } });
    if (itens.length === 0) {
      throw new BadRequestException("Acerto sem nenhum item. Gere antes de fechar.");
    }

    const totais = totalizarAcerto(itens);
    await this.prisma.acertoMotorista.update({
      where: { id },
      data: {
        status: "FECHADO",
        fechadoEm: new Date(),
        fechadoPorId: usuarioId,
        valorCreditos: totais.creditos,
        valorDebitos: totais.debitos,
        valorLiquido: totais.liquido,
      },
    });
    // Fechar o acerto cria a CONTA A PAGAR. É o que liga o que foi apurado ao
    // dinheiro que sai: sem isso o acerto seria mais um número na tela e o
    // pagamento continuaria sendo lembrado de cabeça.
    //
    // Só quando sobra algo a pagar. Líquido zero ou negativo (ele adiantou mais
    // do que rodou) não vira título — cobrar do motorista é outra conversa, e
    // não se faz criando um "a receber" no nome dele.
    const liquido = new Prisma.Decimal(totais.liquido);
    if (liquido.gt(0)) {
      const jaTem = await this.prisma.tituloPagar.findFirst({
        where: { acertoId: id, status: { not: "CANCELADO" } },
        select: { id: true },
      });
      if (!jaTem) {
        await this.prisma.tituloPagar.create({
          data: {
            motoristaId: acerto.motoristaId,
            acertoId: id,
            descricao: `Acerto ${acerto.periodoInicio.toISOString().slice(0, 10)} a ${acerto.periodoFim.toISOString().slice(0, 10)}`,
            emissao: new Date(),
            // Vence no dia do fechamento: acerto fechado é dívida vencida, não
            // prazo pra pagar. Quem quiser adiar muda o vencimento na tela.
            vencimento: new Date(),
            valor: liquido,
            criadoPorId: usuarioId,
          },
        });
      }
    }

    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "status",
      valorAntes: acerto.status,
      valorDepois: "FECHADO",
      motivo: `Fechado em ${totais.liquido}`,
    });
    return this.detalhe(id, null);
  }

  /** Reabre um acerto fechado. Ato deliberado, com rastro. */
  async reabrir(id: string, usuarioId: string) {
    const acerto = await this.prisma.acertoMotorista.findUnique({ where: { id } });
    if (!acerto) throw new NotFoundException("Acerto não encontrado");
    if (acerto.status === "ABERTO") return this.detalhe(id, null);
    if (acerto.status === "PAGO") {
      // Reabrir o que já foi pago faria o extrato divergir do dinheiro que saiu
      // da conta. Se o pagamento foi errado, o conserto é um item de ajuste no
      // acerto seguinte, não reescrever o passado.
      throw new ConflictException(
        "Acerto já pago não reabre. Lance um ajuste no próximo acerto.",
      );
    }

    await this.prisma.acertoMotorista.update({
      where: { id },
      data: { status: "ABERTO", fechadoEm: null, fechadoPorId: null },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "status",
      valorAntes: "FECHADO",
      valorDepois: "ABERTO",
      motivo: "Acerto reaberto",
    });
    return this.detalhe(id, null);
  }

  async marcarPago(id: string, input: MarcarAcertoPagoInput, usuarioId: string) {
    const acerto = await this.prisma.acertoMotorista.findUnique({ where: { id } });
    if (!acerto) throw new NotFoundException("Acerto não encontrado");
    if (acerto.status === "ABERTO") {
      throw new BadRequestException("Feche o acerto antes de marcar como pago.");
    }
    if (acerto.status === "PAGO") throw new ConflictException("Este acerto já está pago.");

    await this.prisma.acertoMotorista.update({
      where: { id },
      data: {
        status: "PAGO",
        pagoEm: input.pagoEm ? diaUtc(input.pagoEm) : new Date(),
        pagoMeio: input.meio,
        pagoPorId: usuarioId,
        ...(input.observacao ? { observacao: input.observacao } : {}),
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "status",
      valorAntes: acerto.status,
      valorDepois: "PAGO",
      motivo: `Pago via ${input.meio}`,
    });
    return this.detalhe(id, null);
  }

  private async exigirAberto(id: string) {
    const acerto = await this.prisma.acertoMotorista.findUnique({ where: { id } });
    if (!acerto) throw new NotFoundException("Acerto não encontrado");
    if (acerto.status !== "ABERTO") {
      throw new ConflictException(
        "Este acerto está fechado. Reabra pra mexer nos itens.",
      );
    }
    return acerto;
  }

  /** Reescreve os somatórios a partir dos itens. Dentro da transação de quem chama. */
  private async recalcularTotais(tx: Prisma.TransactionClient, acertoId: string) {
    const itens = await tx.itemAcerto.findMany({
      where: { acertoId },
      select: { valor: true },
    });
    const t = totalizarAcerto(itens);
    await tx.acertoMotorista.update({
      where: { id: acertoId },
      data: {
        valorCreditos: t.creditos,
        valorDebitos: t.debitos,
        valorLiquido: t.liquido,
      },
    });
  }
}
