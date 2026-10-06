import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma, type TipoRemuneracao } from "@prisma/client";
import type {
  AdicionarItemAcertoInput,
  ConferenciaDoAcerto,
  DecidirPedagioDobroInput,
  DecidirPedagioTagInput,
  DescartarAcertoInput,
  GerarAcertoInput,
  GerarAcertosEmLoteInput,
  IncluirDeForaAcertoInput,
  MarcarAcertoPagoInput,
} from "@ronan/shared-types";
import { TIPOS_DEBITO_ACERTO } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { filtroEscopo, SEM_ESCOPO, type EscopoAdmin } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { dentroDeEmprego, periodosDeEmprego } from "../../common/regime-vigente";
import { inicioDoDiaBR } from "../../common/timezone";
import { diaSP } from "../../common/despesa-regras";
import {
  calcularAcerto,
  descricaoPedagioAvulso,
  itensReembolsoDespesa,
  pedagioDaViagem,
  resolverRemuneracao,
  totalizarAcerto,
  type AbastecimentoParaAcerto,
  type ItemCalculado,
  type ViagemParaAcerto,
} from "../../common/acerto-motorista";
import {
  chaveDoItem,
  diaMesDeData,
  detectarPedagioEmDobro,
  ficaramDeFora,
  rotuloDoAcerto,
  selecionarItensDoAcerto,
  type DecisaoDobro,
  type OcupacaoItem,
} from "../../common/acerto-selecao";
import { conciliarCartao } from "../../common/cartao-combustivel";
import {
  ajusteDaDecisao,
  decisaoAindaVale,
  pagoNaIda,
  situacaoTagDaViagem,
  sugestaoDeReembolso,
} from "../../common/tag-pedagio/pedagio-lancado";
import { tagDasViagens } from "../../common/tag-pedagio/tag-das-viagens";
import { contaIdAtual } from "../../common/conta/conta-context";

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
      chavePixAlteradaEm: true,
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

  /** Telefone do parceiro do acerto (pro "mandar no WhatsApp" do painel). */
  async telefoneDoMotoristaDoAcerto(id: string): Promise<string | null> {
    const a = await this.prisma.acertoMotorista.findUnique({
      where: { id },
      select: { motorista: { select: { telefone: true } } },
    });
    return a?.motorista.telefone ?? null;
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
   * O que a régua pagaria entre dois dias, pra um motorista — sem olhar se já
   * está em algum acerto. Usado pelo gerar (o período) e pela lista "Ficou de
   * fora" (o que é anterior ao período).
   *
   * As três buscas usam o dia civil de São Paulo: `Viagem.data` e
   * `Pedagio.data` são @db.Date (o dia gravado), e `Abastecimento.data` é
   * instante — a janela ancora em 03:00Z, senão o diesel das 21h às 23h59 do
   * último dia caía no acerto seguinte.
   */
  private async calcularCandidatos(
    motorista: {
      id: string;
      cpf: string | null;
      tipoRemuneracao?: TipoRemuneracao | null;
      percentualFrete?: Prisma.Decimal | null;
      valorPorViagem?: Prisma.Decimal | null;
      valorPorTonelada?: Prisma.Decimal | null;
      valorPorKm?: Prisma.Decimal | null;
      modalidade: Parameters<typeof resolverRemuneracao>[1];
    },
    deYmd: string,
    ateYmd: string,
    /** O acerto sendo (re)gerado, quando já existe — o ajuste da tag precisa saber onde está. */
    acertoAtualId: string | null = null,
  ) {
    const de = diaUtc(deYmd);
    const ate = diaUtc(ateYmd);
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

    const [viagens, abastecimentos, pedagiosAvulsos] = await Promise.all([
      this.prisma.viagem.findMany({
        where: {
          motoristaId: motorista.id,
          data: { gte: de, lte: ate },
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
          veiculoId: true,
          cliente: { select: { nome: true } },
          valor: { select: { valorFrete: true } },
          pedagios: { select: { id: true, valor: true, pracaPedagio: true } },
        },
        orderBy: { data: "asc" },
      }),
      this.prisma.abastecimento.findMany({
        where: {
          motoristaId: motorista.id,
          data: {
            gte: inicioDoDiaBR(deYmd),
            lt: new Date(inicioDoDiaBR(ateYmd).getTime() + 86_400_000),
          },
        },
        select: { id: true, data: true, valorTotal: true, postoNome: true, emComboio: true },
        orderBy: { data: "asc" },
      }),
      this.prisma.pedagio.findMany({
        where: {
          motoristaId: motorista.id,
          data: { gte: de, lte: ate },
          viagemId: null,
        },
        select: { id: true, data: true, valor: true, pracaPedagio: true },
        orderBy: { data: "asc" },
      }),
    ]);

    // Avulso que a empresa disse ser o MESMO pedágio da viagem não volta a
    // entrar ao regerar. Decisão de gente, com autor (0b).
    const tirados = pedagiosAvulsos.length
      ? await this.prisma.decisaoPedagioDobro.findMany({
          where: { pedagioId: { in: pedagiosAvulsos.map((p) => p.id) }, decisao: "MESMO_PEDAGIO" },
          select: { pedagioId: true },
        })
      : [];
    const pedagiosTirados = new Set(tirados.map((t) => t.pedagioId));

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

    const avulsos = pedagiosAvulsos
      .filter((p) => foraDoEmprego(p.data) && !pedagiosTirados.has(p.id))
      .map((p) => ({ id: p.id, data: p.data, valor: p.valor, praca: p.pracaPedagio }));

    const calculado = calcularAcerto({
      viagens: viagensParaAcerto,
      abastecimentos: abastecimentosParaAcerto,
      pedagiosAvulsos: avulsos,
      regra,
    });

    // Gasto de viagem (módulo `despesas`): entra pela MESMA seleção que viagem,
    // diesel e pedágio — mesma trava contra pagar duas vezes (chave DESPESA:id),
    // mesmo "puxar do ABERTO esquecido", mesma lista "Ficou de fora".
    const despesas = await this.despesasDoPeriodo(motorista.id, deYmd, ateYmd, foraDoEmprego);
    calculado.itens.push(...itensReembolsoDespesa(despesas, regra));

    // Conferência da tag (módulo `tag-pedagio`): o reembolso de pedágio da
    // viagem segue a decisão da empresa, e decisão tomada depois de o acerto
    // fechar vira ajuste aqui.
    if (regra.reembolsaPedagio) {
      await this.aplicarConferenciaTag(
        calculado.itens,
        motorista.id,
        viagens.filter((v) => v.data != null).map((v) => ({ id: v.id, data: v.data, veiculoId: v.veiculoId })),
        acertoAtualId,
      );
    }

    // A data de cada lançamento, pra lista "Ficou de fora" dizer de quando é.
    const dataPorRef = new Map<string, Date>();
    for (const v of viagensParaAcerto) dataPorRef.set(v.id, v.data);
    for (const a of abastecimentosParaAcerto) dataPorRef.set(a.id, a.data);
    for (const p of avulsos) dataPorRef.set(p.id, p.data);
    for (const d of despesas) dataPorRef.set(d.id, diaUtc(diaSP(d.data)));

    return { calculado, regra, periodosEmprego, dataPorRef };
  }

  /** Todas as linhas de acerto (de qualquer acerto) que apontam pros lançamentos. */
  private async ocupacoesDe(itens: ItemCalculado[]): Promise<OcupacaoItem[]> {
    const viagemIds = [...new Set(itens.map((i) => i.viagemId).filter((x): x is string => !!x))];
    const pedagioIds = [...new Set(itens.map((i) => i.pedagioId).filter((x): x is string => !!x))];
    const abastIds = [
      ...new Set(itens.map((i) => i.abastecimentoId).filter((x): x is string => !!x)),
    ];
    const ou: Prisma.ItemAcertoWhereInput[] = [];
    if (viagemIds.length) ou.push({ viagemId: { in: viagemIds } });
    if (pedagioIds.length) ou.push({ pedagioId: { in: pedagioIds } });
    if (abastIds.length) ou.push({ abastecimentoId: { in: abastIds } });
    const despesaIds = [...new Set(itens.map((i) => i.despesaId).filter((x): x is string => !!x))];
    if (despesaIds.length) ou.push({ despesaId: { in: despesaIds } });
    const decisaoIds = [
      ...new Set(itens.map((i) => i.decisaoPedagioTagId).filter((x): x is string => !!x)),
    ];
    if (decisaoIds.length) ou.push({ decisaoPedagioTagId: { in: decisaoIds } });
    if (ou.length === 0) return [];

    const linhas = await this.prisma.itemAcerto.findMany({
      where: { OR: ou },
      select: {
        id: true,
        tipo: true,
        viagemId: true,
        pedagioId: true,
        abastecimentoId: true,
        despesaId: true,
        decisaoPedagioTagId: true,
        automatico: true,
        puxadoDe: true,
        acerto: { select: { id: true, status: true, periodoInicio: true, periodoFim: true } },
      },
    });
    const out: OcupacaoItem[] = [];
    for (const l of linhas) {
      const chave = chaveDoItem(l);
      if (!chave) continue;
      out.push({
        itemId: l.id,
        chave,
        acertoId: l.acerto.id,
        status: l.acerto.status,
        periodoInicio: l.acerto.periodoInicio,
        periodoFim: l.acerto.periodoFim,
        automatico: l.automatico,
        puxadoDe: l.puxadoDe,
      });
    }
    return out;
  }

  /**
   * Gera ou REGENERA o acerto de um motorista no período.
   *
   * Regenerar é a operação normal, não a exceção: o operador abre o acerto no
   * dia 25, entram mais viagens até o 31, e ele gera de novo. Por isso só os
   * itens AUTOMÁTICOS são refeitos — o adiantamento que ele lançou à mão no dia
   * 25 tem que sobreviver, senão o trabalho dele se perde toda vez.
   *
   * O que entra: data dentro do período E fora de acerto FECHADO/PAGO. O que
   * está em outro ABERTO vem pra cá com aviso. Ver common/acerto-selecao.ts.
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

    const { calculado, periodosEmprego } = await this.calcularCandidatos(
      motorista,
      input.periodoInicio,
      input.periodoFim,
      existente?.id ?? null,
    );
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

    const selecao = selecionarItensDoAcerto({
      candidatos: calculado.itens,
      acertoAtualId: existente?.id ?? null,
      ocupacoes: await this.ocupacoesDe(calculado.itens),
    });

    const atual = { periodoInicio: inicio, periodoFim: fim };
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

      // O item que estava em outro acerto ABERTO sai de lá (e o total de lá é
      // refeito). Nunca de FECHADO/PAGO — a seleção já não puxa desses.
      const origens = [...new Set(selecao.puxar.map((p) => p.acertoId))];
      if (selecao.puxar.length > 0) {
        await tx.itemAcerto.deleteMany({
          where: {
            id: { in: selecao.puxar.map((p) => p.itemId) },
            acerto: { status: "ABERTO" },
          },
        });
        for (const origem of origens) await this.recalcularTotais(tx, origem);
      }

      // Só o automático é varrido. Ver o comentário do método.
      await tx.itemAcerto.deleteMany({ where: { acertoId: acerto.id, automatico: true } });

      if (selecao.entram.length > 0) {
        await tx.itemAcerto.createMany({
          data: selecao.entram.map((i) => ({
            acertoId: acerto.id,
            tipo: i.tipo,
            viagemId: i.viagemId ?? null,
            pedagioId: i.pedagioId ?? null,
            abastecimentoId: i.abastecimentoId ?? null,
            despesaId: i.despesaId ?? null,
            decisaoPedagioTagId: i.decisaoPedagioTagId ?? null,
            descricao: i.descricao,
            valor: i.valor,
            motivo: i.motivo ?? null,
            automatico: true,
            puxadoDe: i.puxadoDe,
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
    // O acerto que perdeu o item precisa contar a história também: senão o
    // número dele muda e ninguém sabe por quê.
    for (const origem of [...new Set(selecao.puxar.map((p) => p.acertoId))]) {
      const n = selecao.puxar.filter((p) => p.acertoId === origem).length;
      await this.auditoria.log({
        usuarioId,
        entidade: "AcertoMotorista",
        entidadeId: origem,
        acao: AcaoAuditoria.UPDATE,
        campo: "itens",
        motivo: `${n} item(ns) saíram deste acerto pro ${rotuloDoAcerto(atual)}`,
      });
    }

    const detalhe = await this.detalhe(acertoId, null);
    return {
      ...detalhe,
      semRemuneracao: calculado.semRemuneracao,
      puxados: selecao.puxar.length,
      jaFechados: selecao.jaFechados.length + selecao.aMaoEmOutro.length,
    };
  }

  /**
   * Gastos de viagem candidatos ao acerto: APROVADOS, de tipo que devolve, com
   * DATA (dia civil de SP) dentro do período e fora de dia de emprego CLT (o
   * mesmo `foraDoEmprego` de viagem/diesel/pedágio — B10). Com ou sem viagem: o
   * vínculo nunca decide pagamento. Quem decide se já está em outro acerto é a
   * seleção (`selecionarItensDoAcerto`), igual pros outros lançamentos.
   */
  private async despesasDoPeriodo(
    motoristaId: string,
    deYmd: string,
    ateYmd: string,
    foraDoEmprego: (data: Date | null) => boolean,
  ) {
    const de = inicioDoDiaBR(deYmd);
    const ate = new Date(inicioDoDiaBR(ateYmd).getTime() + 86_400_000);
    const despesas = await this.prisma.despesa.findMany({
      where: {
        motoristaId,
        status: "APROVADA",
        tipoDespesa: { devolve: true },
        data: { gte: de, lt: ate },
      },
      select: { id: true, data: true, tipoNome: true, valorAprovado: true, descricao: true },
      orderBy: { data: "asc" },
    });
    return despesas.filter((d) => foraDoEmprego(diaUtc(diaSP(d.data))));
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

    const resultados: {
      motoristaId: string;
      nome: string;
      ok: boolean;
      erro?: string;
      puxados?: number;
    }[] = [];
    for (const m of motoristas) {
      try {
        const r = await this.gerar(
          {
            motoristaId: m.id,
            periodoInicio: input.periodoInicio,
            periodoFim: input.periodoFim,
          },
          usuarioId,
        );
        resultados.push({ motoristaId: m.id, nome: m.nome, ok: true, puxados: r.puxados });
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
      /** Itens que saíram de outro acerto ABERTO pros gerados agora. */
      puxados: resultados.reduce((s, r) => s + (r.puxados ?? 0), 0),
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

    // A trava: o mesmo lançamento não pode estar em dois acertos FECHADO/PAGO.
    // Confere antes pra dizer QUAL item e EM QUAL acerto; o unique do banco
    // (`chaveFechada`) segura a corrida entre dois fechamentos ao mesmo tempo.
    const comChave = itens
      .map((i) => ({ id: i.id, descricao: i.descricao, chave: chaveDoItem(i) }))
      .filter((i): i is { id: string; descricao: string; chave: string } => i.chave != null);
    const repetidoAqui = comChave.find(
      (i, idx) => comChave.findIndex((j) => j.chave === i.chave) !== idx,
    );
    if (repetidoAqui) {
      throw new ConflictException(
        `"${repetidoAqui.descricao}" aparece duas vezes neste acerto. Remova uma das linhas antes de fechar.`,
      );
    }
    if (comChave.length > 0) {
      const conflitos = await this.prisma.itemAcerto.findMany({
        where: { chaveFechada: { in: comChave.map((i) => i.chave) }, acertoId: { not: id } },
        select: {
          chaveFechada: true,
          acerto: { select: { periodoInicio: true, periodoFim: true, status: true } },
        },
        take: 5,
      });
      if (conflitos.length > 0) throw this.erroItemJaFechado(conflitos, comChave);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.acertoMotorista.update({
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
        for (const i of comChave) {
          await tx.itemAcerto.update({ where: { id: i.id }, data: { chaveFechada: i.chave } });
        }
      });
    } catch (e) {
      // Outro fechamento pegou o mesmo item entre a conferência e aqui. 409
      // legível, nunca 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const conflitos = await this.prisma.itemAcerto.findMany({
          where: { chaveFechada: { in: comChave.map((i) => i.chave) }, acertoId: { not: id } },
          select: {
            chaveFechada: true,
            acerto: { select: { periodoInicio: true, periodoFim: true, status: true } },
          },
          take: 5,
        });
        throw this.erroItemJaFechado(conflitos, comChave);
      }
      throw e;
    }
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

    await this.prisma.$transaction(async (tx) => {
      await tx.acertoMotorista.update({
        where: { id },
        data: { status: "ABERTO", fechadoEm: null, fechadoPorId: null },
      });
      // Aberto não trava item: solta a chave pra que regerar (ou outro acerto)
      // possa mexer de novo. Volta a travar no próximo fechamento.
      await tx.itemAcerto.updateMany({ where: { acertoId: id }, data: { chaveFechada: null } });
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

  private erroItemJaFechado(
    conflitos: {
      chaveFechada: string | null;
      acerto: { periodoInicio: Date; periodoFim: Date; status: string };
    }[],
    itens: { chave: string; descricao: string }[],
  ): ConflictException {
    const frases = conflitos.map((c) => {
      const item = itens.find((i) => i.chave === c.chaveFechada);
      const estado = c.acerto.status === "PAGO" ? "pago" : "fechado";
      return `"${item?.descricao ?? "lançamento"}" já está no ${rotuloDoAcerto(c.acerto)} (${estado})`;
    });
    return new ConflictException(
      `${frases.join("; ")}. O mesmo lançamento não pode ser pago em dois acertos — ` +
        "gere este acerto de novo (o que já está fechado sai sozinho) e feche outra vez.",
    );
  }

  /**
   * Descarta um acerto ABERTO gerado errado (período trocado, lote no mês
   * errado). Os itens dele ficam livres pra outro acerto pegar. Fica a
   * auditoria com o que ele tinha e o motivo.
   *
   * FECHADO/PAGO não descarta: é combinado com o motorista (e o pago já saiu
   * do caixa). Pra mexer, reabre — e pago nem isso.
   */
  async descartar(id: string, input: DescartarAcertoInput, usuarioId: string) {
    const acerto = await this.prisma.acertoMotorista.findUnique({
      where: { id },
      include: {
        motorista: { select: { nome: true } },
        itens: { select: { tipo: true, descricao: true, valor: true, automatico: true } },
      },
    });
    if (!acerto) throw new NotFoundException("Acerto não encontrado");
    if (acerto.status !== "ABERTO") {
      throw new ConflictException(
        acerto.status === "PAGO"
          ? "Acerto pago não se descarta: o dinheiro já saiu. Se algo saiu errado, lance um ajuste no próximo acerto."
          : "Acerto fechado não se descarta. Reabra antes, se precisar mesmo descartar.",
      );
    }
    // Acerto que já foi fechado uma vez e reaberto pode ter conta a pagar viva.
    const titulo = await this.prisma.tituloPagar.findFirst({
      where: { acertoId: id, status: { not: "CANCELADO" } },
      select: { id: true },
    });
    if (titulo) {
      throw new ConflictException(
        "Este acerto já gerou uma conta a pagar. Cancele a conta a pagar antes de descartar o acerto.",
      );
    }

    await this.prisma.acertoMotorista.delete({ where: { id } });
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.DELETE,
      campo: "acerto",
      valorAntes: {
        motorista: acerto.motorista.nome,
        motoristaId: acerto.motoristaId,
        periodoInicio: acerto.periodoInicio.toISOString().slice(0, 10),
        periodoFim: acerto.periodoFim.toISOString().slice(0, 10),
        liquido: acerto.valorLiquido.toString(),
        itens: acerto.itens.map((i) => ({
          tipo: i.tipo,
          descricao: i.descricao,
          valor: i.valor.toString(),
          automatico: i.automatico,
        })),
      },
      motivo: input.motivo,
    });
    return { ok: true };
  }

  /**
   * O que conferir antes de fechar: possível pedágio em dobro (0b), reembolso
   * de diesel que passou no cartão da empresa (0d) e o que ficou de fora de
   * acertos anteriores (0c). Só leitura — nada entra nem sai daqui.
   */
  async conferencia(id: string): Promise<ConferenciaDoAcerto> {
    const acerto = await this.prisma.acertoMotorista.findUnique({
      where: { id },
      include: {
        itens: {
          select: {
            id: true,
            tipo: true,
            viagemId: true,
            pedagioId: true,
            abastecimentoId: true,
            descricao: true,
            valor: true,
          },
        },
      },
    });
    if (!acerto) throw new NotFoundException("Acerto não encontrado");

    const [pedagio, cartao, deFora, pedagioTag] = await Promise.all([
      this.conferirPedagioEmDobro(acerto.id, acerto.itens),
      this.conferirCartao(acerto.itens),
      acerto.status === "ABERTO" ? this.listarDeFora(acerto) : Promise.resolve([]),
      this.conferirPedagioTag(acerto),
    ]);

    return {
      pedagioEmDobro: pedagio.grupos.map((g) => ({
        ...g,
        avulsos: g.avulsos.map((a) => ({
          ...a,
          decisao: a.decisao
            ? {
                decisao: a.decisao.decisao,
                decididoPor: a.decisao.decididoPor,
                decididoEm: a.decisao.decididoEm.toISOString(),
              }
            : null,
        })),
      })),
      pedagiosTirados: pedagio.tirados,
      pagoNoCartao: cartao,
      ficouDeFora: deFora.map((i) => ({
        chave: i.chave,
        tipo: i.tipo,
        descricao: i.descricao,
        valor: i.valor,
        data: i.data.toISOString(),
      })),
      pedagioTag,
    };
  }

  private async conferirPedagioEmDobro(
    acertoId: string,
    itens: {
      id: string;
      tipo: string;
      viagemId: string | null;
      pedagioId: string | null;
      descricao: string;
      valor: Prisma.Decimal;
    }[],
  ) {
    const daViagem = itens.filter((i) => i.tipo === "REEMBOLSO_PEDAGIO" && i.viagemId);
    const avulsos = itens.filter((i) => i.tipo === "REEMBOLSO_PEDAGIO" && !i.viagemId && i.pedagioId);

    const [viagens, pedagios, decisoes] = await Promise.all([
      daViagem.length && avulsos.length
        ? this.prisma.viagem.findMany({
            where: { id: { in: daViagem.map((i) => i.viagemId!) } },
            select: { id: true, data: true, valorPedagioTotal: true },
          })
        : Promise.resolve([]),
      avulsos.length
        ? this.prisma.pedagio.findMany({
            where: { id: { in: avulsos.map((i) => i.pedagioId!) } },
            select: { id: true, data: true },
          })
        : Promise.resolve([]),
      this.prisma.decisaoPedagioDobro.findMany({
        where: {
          OR: [
            { pedagioId: { in: avulsos.map((i) => i.pedagioId!) } },
            { acertoId, decisao: "MESMO_PEDAGIO" },
          ],
        },
        include: {
          decididoPor: { select: { nome: true } },
          pedagio: { select: { data: true, valor: true, pracaPedagio: true } },
        },
      }),
    ]);

    const viagemPorId = new Map(viagens.map((v) => [v.id, v]));
    const pedagioPorId = new Map(pedagios.map((p) => [p.id, p]));
    const mapaDecisoes = new Map<string, DecisaoDobro>(
      decisoes.map((d) => [
        d.pedagioId,
        { decisao: d.decisao, decididoPor: d.decididoPor?.nome ?? null, decididoEm: d.decididoEm },
      ]),
    );

    const grupos = detectarPedagioEmDobro({
      viagens: daViagem.flatMap((i) => {
        const v = viagemPorId.get(i.viagemId!);
        if (!v?.data) return [];
        return [
          {
            itemId: i.id,
            viagemId: v.id,
            dia: v.data.toISOString().slice(0, 10),
            valorPedagioTotal: v.valorPedagioTotal,
            valor: i.valor,
            descricao: i.descricao,
          },
        ];
      }),
      avulsos: avulsos.flatMap((i) => {
        const p = pedagioPorId.get(i.pedagioId!);
        if (!p) return [];
        return [
          {
            itemId: i.id,
            pedagioId: p.id,
            dia: p.data.toISOString().slice(0, 10),
            valor: i.valor,
            descricao: i.descricao,
          },
        ];
      }),
      decisoes: mapaDecisoes,
    });

    const tirados = decisoes
      .filter((d) => d.decisao === "MESMO_PEDAGIO" && d.acertoId === acertoId)
      .map((d) => ({
        pedagioId: d.pedagioId,
        descricao: descricaoPedagioAvulso({ data: d.pedagio.data, praca: d.pedagio.pracaPedagio }),
        valor: d.pedagio.valor.toFixed(2),
        decididoPor: d.decididoPor?.nome ?? null,
        decididoEm: d.decididoEm.toISOString(),
      }));

    return { grupos, tirados };
  }

  /**
   * Reembolso de abastecimento que casa com passada no cartão-combustível da
   * empresa. Usa a MESMA conciliação da tela do cartão (dia vizinho + placa),
   * calculada agora. Não corta nada: a empresa decide.
   */
  private async conferirCartao(
    itens: { id: string; tipo: string; abastecimentoId: string | null }[],
  ): Promise<ConferenciaDoAcerto["pagoNoCartao"]> {
    const doAcerto = itens.filter((i) => i.tipo === "REEMBOLSO_ABASTECIMENTO" && i.abastecimentoId);
    if (doAcerto.length === 0) return [];

    const meus = await this.prisma.abastecimento.findMany({
      where: { id: { in: doAcerto.map((i) => i.abastecimentoId!) } },
      select: { id: true, veiculoId: true, data: true },
    });
    if (meus.length === 0) return [];
    const veiculoIds = [...new Set(meus.map((a) => a.veiculoId))];
    const t0 = Math.min(...meus.map((a) => a.data.getTime()));
    const t1 = Math.max(...meus.map((a) => a.data.getTime()));
    // Folga de 2 dias: o casamento aceita o dia vizinho, e a transação vizinha
    // pode estar disputando com outro abastecimento do mesmo caminhão.
    const de = new Date(t0 - 2 * 86_400_000);
    const ate = new Date(t1 + 2 * 86_400_000);

    const transacoes = await this.prisma.transacaoCartao.findMany({
      where: { veiculoId: { in: veiculoIds }, data: { gte: de, lte: ate } },
      select: { id: true, data: true, placa: true, veiculoId: true, litros: true, valor: true, posto: true },
    });
    if (transacoes.length === 0) return [];

    // Os outros abastecimentos do caminhão na janela entram na disputa, igual
    // na tela do cartão — senão o deste acerto "roubava" a passada de outro.
    const todos = await this.prisma.abastecimento.findMany({
      where: { veiculoId: { in: veiculoIds }, data: { gte: de, lte: ate } },
      select: { id: true, veiculoId: true, data: true, litros: true, valorTotal: true, emComboio: true },
    });
    const { itens: casados } = conciliarCartao(
      transacoes.map((t) => ({
        id: t.id,
        data: t.data,
        placa: t.placa,
        veiculoId: t.veiculoId,
        litros: t.litros != null ? Number(t.litros) : null,
        valor: Number(t.valor),
      })),
      todos.map((a) => ({
        id: a.id,
        veiculoId: a.veiculoId,
        data: a.data,
        litros: Number(a.litros),
        valorTotal: a.valorTotal != null ? Number(a.valorTotal) : null,
        emComboio: a.emComboio,
      })),
    );
    const transacaoPorAbast = new Map<string, (typeof transacoes)[number]>();
    const tPorId = new Map(transacoes.map((t) => [t.id, t]));
    for (const c of casados) {
      if (c.abastecimentoId) transacaoPorAbast.set(c.abastecimentoId, tPorId.get(c.transacaoId)!);
    }

    return doAcerto.flatMap((i) => {
      const t = transacaoPorAbast.get(i.abastecimentoId!);
      if (!t) return [];
      return [
        {
          itemId: i.id,
          abastecimentoId: i.abastecimentoId!,
          transacao: {
            data: t.data.toISOString(),
            valor: Number(t.valor),
            posto: t.posto,
            placa: t.placa,
          },
        },
      ];
    });
  }

  /**
   * "Ficou de fora de acertos anteriores": o que tem data ANTERIOR ao período
   * deste acerto, a régua pagaria, e não está em acerto nenhum. Nada daqui
   * entra sozinho (D3) — a empresa marca.
   *
   * O piso é o início do PRIMEIRO acerto do motorista: antes dele a empresa
   * pagava fora do sistema, e listar o histórico inteiro seria só ruído.
   */
  private async listarDeFora(acerto: {
    id: string;
    motoristaId: string;
    periodoInicio: Date;
  }) {
    const primeiro = await this.prisma.acertoMotorista.findFirst({
      where: { motoristaId: acerto.motoristaId },
      orderBy: { periodoInicio: "asc" },
      select: { periodoInicio: true },
    });
    if (!primeiro || primeiro.periodoInicio.getTime() >= acerto.periodoInicio.getTime()) return [];

    const motorista = await this.prisma.motorista.findUnique({
      where: { id: acerto.motoristaId },
      include: { modalidade: true },
    });
    if (!motorista) return [];

    const deYmd = primeiro.periodoInicio.toISOString().slice(0, 10);
    const ateYmd = new Date(acerto.periodoInicio.getTime() - 86_400_000).toISOString().slice(0, 10);
    const { calculado, dataPorRef } = await this.calcularCandidatos(motorista, deYmd, ateYmd);
    const ocupadas = new Set((await this.ocupacoesDe(calculado.itens)).map((o) => o.chave));

    // O ajuste da tag não tem data de período: entra sozinho no acerto que gerar.
    const candidatos = calculado.itens.filter((i) => i.tipo !== "AJUSTE");
    return ficaramDeFora(candidatos, ocupadas).map((i) => ({
      ...i,
      data:
        dataPorRef.get(i.viagemId ?? i.pedagioId ?? i.abastecimentoId ?? "") ?? acerto.periodoInicio,
    }));
  }

  /** A empresa marcou o que entra da lista "Ficou de fora". */
  async incluirDeFora(id: string, input: IncluirDeForaAcertoInput, usuarioId: string) {
    const acerto = await this.exigirAberto(id);
    const lista = await this.listarDeFora(acerto);
    const pedidas = new Set(input.chaves);
    const escolhidas = lista.filter((i) => pedidas.has(i.chave));
    if (escolhidas.length === 0) {
      throw new ConflictException(
        "Esses lançamentos não estão mais de fora — outro acerto já pegou. Recarregue a tela.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.itemAcerto.createMany({
        data: escolhidas.map((i) => ({
          acertoId: id,
          tipo: i.tipo,
          viagemId: i.viagemId ?? null,
          pedagioId: i.pedagioId ?? null,
          abastecimentoId: i.abastecimentoId ?? null,
          descricao: i.descricao,
          valor: i.valor,
          // À mão: é decisão da empresa, sobrevive a regerar, e sai pela lixeira.
          automatico: false,
          motivo: "Ficou de fora de acerto anterior — incluído pela empresa.",
          criadoPorId: usuarioId,
        })),
      });
      await this.recalcularTotais(tx, id);
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "itens",
      valorDepois: escolhidas.map((i) => ({ descricao: i.descricao, valor: i.valor })),
      motivo: `Incluiu ${escolhidas.length} lançamento(s) que tinham ficado de fora`,
    });
    return this.detalhe(id, null);
  }

  /**
   * "É o mesmo pedágio" tira o avulso deste acerto (e de qualquer regeração);
   * "são pedágios diferentes" só cala o aviso. Decisão de gente, com autor.
   */
  async decidirPedagioDobro(id: string, input: DecidirPedagioDobroInput, usuarioId: string) {
    const acerto = await this.exigirAberto(id);
    const pedagio = await this.prisma.pedagio.findFirst({
      where: { id: input.pedagioId, motoristaId: acerto.motoristaId, viagemId: null },
      select: { id: true },
    });
    if (!pedagio) throw new NotFoundException("Pedágio avulso não encontrado neste acerto.");

    const anterior = await this.prisma.decisaoPedagioDobro.findFirst({
      where: { pedagioId: input.pedagioId },
      select: { id: true, decisao: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const dados = {
        viagemId: input.viagemId ?? null,
        acertoId: id,
        decisao: input.decisao,
        decididoPorId: usuarioId,
        decididoEm: new Date(),
      };
      if (anterior) {
        await tx.decisaoPedagioDobro.update({ where: { id: anterior.id }, data: dados });
      } else {
        await tx.decisaoPedagioDobro.create({ data: { pedagioId: input.pedagioId, ...dados } });
      }
      if (input.decisao === "MESMO_PEDAGIO") {
        await tx.itemAcerto.deleteMany({
          where: {
            acertoId: id,
            tipo: "REEMBOLSO_PEDAGIO",
            pedagioId: input.pedagioId,
            viagemId: null,
          },
        });
        await this.recalcularTotais(tx, id);
      }
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "pedagioEmDobro",
      valorAntes: anterior?.decisao ?? null,
      valorDepois: { pedagioId: input.pedagioId, viagemId: input.viagemId, decisao: input.decisao },
      motivo:
        input.decisao === "MESMO_PEDAGIO"
          ? "É o mesmo pedágio da viagem: o avulso saiu do acerto"
          : "São pedágios diferentes: os dois ficam",
    });
    return this.conferencia(id);
  }

  /** Volta atrás numa decisão. Se o avulso tinha saído, o acerto é regerado e ele volta. */
  async desfazerDecisaoPedagio(id: string, pedagioId: string, usuarioId: string) {
    const acerto = await this.exigirAberto(id);
    const d = await this.prisma.decisaoPedagioDobro.findFirst({
      where: { pedagioId },
      select: { id: true, decisao: true },
    });
    if (!d) throw new NotFoundException("Não há decisão sobre esse pedágio.");
    await this.prisma.decisaoPedagioDobro.delete({ where: { id: d.id } });
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "pedagioEmDobro",
      valorAntes: { pedagioId, decisao: d.decisao },
      valorDepois: null,
      motivo: "Desfez a decisão sobre possível pedágio em dobro",
    });
    if (d.decisao === "MESMO_PEDAGIO") {
      await this.gerar(
        {
          motoristaId: acerto.motoristaId,
          periodoInicio: acerto.periodoInicio.toISOString().slice(0, 10),
          periodoFim: acerto.periodoFim.toISOString().slice(0, 10),
        },
        usuarioId,
      );
    }
    return this.conferencia(id);
  }

  // ------------------------------------------------- conferência da tag

  /**
   * O reembolso de pedágio da viagem segue a decisão da empresa sobre o que a
   * tag pagou — enquanto o lançado e o pago pela tag forem os mesmos da
   * decisão. Decisão sobre viagem já reembolsada num acerto FECHADO/PAGO vira
   * AJUSTE no acerto que está sendo gerado (acerto fechado não reabre). Sem o
   * módulo, não faz nada.
   */
  private async aplicarConferenciaTag(
    itens: ItemCalculado[],
    motoristaId: string,
    viagens: Array<{ id: string; data: Date | null; veiculoId: string | null }>,
    acertoAtualId: string | null,
  ) {
    const tag = await tagDasViagens(this.prisma, viagens);
    if (!tag) return;

    const doPeriodo = itens.filter((i) => i.tipo === "REEMBOLSO_PEDAGIO" && i.viagemId);
    const decisoes = doPeriodo.length
      ? await this.prisma.decisaoPedagioTag.findMany({
          where: { viagemId: { in: doPeriodo.map((i) => i.viagemId!) } },
          include: { itensAcerto: { select: { acertoId: true } } },
        })
      : [];
    const decisaoDe = new Map(decisoes.map((d) => [d.viagemId, d]));
    for (const item of doPeriodo) {
      const d = decisaoDe.get(item.viagemId!);
      if (!d || !decisaoAindaVale(d, item.valor, tag.get(item.viagemId!)?.cobertura)) continue;
      // A decisão já virou AJUSTE em outro acerto, calculado sobre o que ESTE
      // pagou. Aplicar aqui também (acerto reaberto e regerado) descontaria a
      // mesma diferença duas vezes.
      if (d.itensAcerto.some((i) => i.acertoId !== acertoAtualId)) continue;
      if (d.valorReembolso.lte(0)) {
        itens.splice(itens.indexOf(item), 1);
        continue;
      }
      item.valor = d.valorReembolso.toFixed(2);
      item.descricao = `${item.descricao} · conferido com a tag`;
    }

    const fechados = await this.prisma.itemAcerto.findMany({
      where: {
        tipo: "REEMBOLSO_PEDAGIO",
        acerto: { motoristaId, status: { in: ["FECHADO", "PAGO"] } },
        viagem: { decisaoPedagioTag: { some: {} } },
      },
      select: {
        viagemId: true,
        valor: true,
        acerto: { select: { periodoInicio: true, periodoFim: true } },
        viagem: {
          select: {
            id: true,
            data: true,
            veiculoId: true,
            valorPedagioTotal: true,
            pedagios: { select: { id: true, valor: true } },
            decisaoPedagioTag: {
              include: { itensAcerto: { select: { acertoId: true, acerto: { select: { status: true } } } } },
            },
          },
        },
      },
    });
    const viagensFechadas = fechados.flatMap((f) => (f.viagem ? [f.viagem] : []));
    const tagFechadas = viagensFechadas.length ? await tagDasViagens(this.prisma, viagensFechadas) : null;
    for (const f of fechados) {
      const v = f.viagem;
      const d = v?.decisaoPedagioTag[0];
      if (!v || !d || !f.viagemId) continue;
      if (!decisaoAindaVale(d, pedagioDaViagem(v).valor, tagFechadas?.get(v.id)?.cobertura)) continue;
      // Já está em outro acerto ABERTO: fica lá (senão todo acerto gerado o puxava pra si).
      if (d.itensAcerto.some((i) => i.acertoId !== acertoAtualId && i.acerto.status === "ABERTO")) continue;
      const ajuste = ajusteDaDecisao(d.valorReembolso, f.valor);
      if (ajuste.eq(0)) continue;
      const dia = v.data ? diaMesDeData(v.data) : "?";
      itens.push({
        tipo: "AJUSTE",
        viagemId: f.viagemId,
        decisaoPedagioTagId: d.id,
        valor: ajuste.toFixed(2),
        descricao: `Pedágio da viagem de ${dia} conferido com a tag — reembolsado antes no ${rotuloDoAcerto(f.acerto)}`,
        motivo:
          d.motivo ??
          `Conferência da tag: devolver R$ ${d.valorReembolso.toFixed(2)} dos R$ ${d.valorLancado.toFixed(2)} lançados`,
      });
    }
  }

  /** Viagens com pedágio lançado em que a tag pagou passagens — deste período e já acertadas. */
  private async conferirPedagioTag(acerto: {
    id: string;
    motoristaId: string;
    periodoInicio: Date;
    periodoFim: Date;
  }): Promise<ConferenciaDoAcerto["pedagioTag"]> {
    const motorista = await this.prisma.motorista.findUnique({
      where: { id: acerto.motoristaId },
      include: { modalidade: true },
    });
    if (!motorista || !resolverRemuneracao(motorista, motorista.modalidade).reembolsaPedagio) return null;

    // Ajuste de acerto anterior: olha uma janela de 4 meses pra trás, que é o
    // que uma fatura atrasada alcança.
    const desde = new Date(acerto.periodoInicio.getTime() - 120 * 86_400_000);
    const viagens = await this.prisma.viagem.findMany({
      where: {
        motoristaId: acerto.motoristaId,
        data: { gte: desde, lte: acerto.periodoFim },
        status: { notIn: STATUS_FORA_FECHAMENTO },
      },
      select: {
        id: true,
        data: true,
        veiculoId: true,
        valorPedagioTotal: true,
        pedagios: { select: { id: true, valor: true } },
        localCarga: { select: { nome: true } },
        localDescarga: { select: { nome: true } },
      },
    });
    const tag = await tagDasViagens(this.prisma, viagens);
    if (!tag) return null;

    const comLancado = viagens.filter((v) => pedagioDaViagem(v).valor.gt(0));
    const ids = comLancado.map((v) => v.id);
    const [itens, decisoes] = ids.length
      ? await Promise.all([
          this.prisma.itemAcerto.findMany({
            where: { viagemId: { in: ids }, tipo: "REEMBOLSO_PEDAGIO" },
            select: {
              viagemId: true,
              valor: true,
              acerto: { select: { id: true, status: true, periodoInicio: true, periodoFim: true } },
            },
          }),
          this.prisma.decisaoPedagioTag.findMany({
            where: { viagemId: { in: ids } },
            include: {
              decididoPor: { select: { nome: true } },
              itensAcerto: { select: { acerto: { select: { status: true } } } },
            },
          }),
        ])
      : [[], []];
    const decisaoDe = new Map(decisoes.map((d) => [d.viagemId, d]));

    const out: NonNullable<ConferenciaDoAcerto["pedagioTag"]> = { viagens: [], faturaNaoChegou: 0, naoCasadas: 0 };
    for (const v of comLancado) {
      const lancado = pedagioDaViagem(v).valor;
      const t = tag.get(v.id)!;
      const sit = situacaoTagDaViagem({ ...t, lancado });
      const doPeriodo = v.data! >= acerto.periodoInicio && v.data! <= acerto.periodoFim;
      const daqui = itens.find((i) => i.viagemId === v.id && i.acerto.id === acerto.id);
      const fechado = itens.find((i) => i.viagemId === v.id && i.acerto.status !== "ABERTO");
      const d = decisaoDe.get(v.id);
      const decisaoValida = d && decisaoAindaVale(d, lancado, t.cobertura) ? d : null;
      // Ajuste já num acerto fechado: não muda mais, mesmo que os números mudem.
      const travada = !!d?.itensAcerto.some((i) => i.acerto.status !== "ABERTO");

      if (sit.situacao !== "TAG_PAGOU") {
        if (doPeriodo && sit.situacao === "FATURA_NAO_CHEGOU") out.faturaNaoChegou++;
        if (doPeriodo && sit.situacao === "NAO_CASADA") out.naoCasadas++;
        continue;
      }
      // De acerto anterior só aparece o que ainda pede decisão ou ajuste.
      if (!doPeriodo && (!fechado || travada)) continue;
      if (!doPeriodo && decisaoValida && ajusteDaDecisao(decisaoValida.valorReembolso, fechado!.valor).eq(0)) continue;

      out.viagens.push({
        viagemId: v.id,
        dia: v.data!.toISOString().slice(0, 10),
        rota: v.localCarga && v.localDescarga ? `${v.localCarga.nome} → ${v.localDescarga.nome}` : null,
        lancado: lancado.toFixed(2),
        tag: sit.tag,
        vale: sit.vale,
        retorno: sit.retorno,
        sugestao: sit.sugestao,
        noAcerto: daqui ? daqui.valor.toFixed(2) : null,
        jaPago: fechado ? { valor: fechado.valor.toFixed(2), acerto: rotuloDoAcerto(fechado.acerto) } : null,
        decisao: decisaoValida
          ? {
              valorReembolso: decisaoValida.valorReembolso.toFixed(2),
              motivo: decisaoValida.motivo,
              decididoPor: decisaoValida.decididoPor?.nome ?? null,
              decididoEm: decisaoValida.decididoEm.toISOString(),
            }
          : null,
        travada,
      });
    }
    out.viagens.sort((a, b) => a.dia.localeCompare(b.dia));
    return out;
  }

  async decidirPedagioTag(id: string, input: DecidirPedagioTagInput, usuarioId: string) {
    const acerto = await this.exigirAberto(id);
    const viagem = await this.prisma.viagem.findFirst({
      where: { id: input.viagemId, motoristaId: acerto.motoristaId },
      select: {
        id: true,
        data: true,
        veiculoId: true,
        valorPedagioTotal: true,
        pedagios: { select: { id: true, valor: true } },
      },
    });
    if (!viagem) throw new NotFoundException("Viagem não encontrada neste acerto.");
    const tag = await tagDasViagens(this.prisma, [viagem]);
    if (!tag) throw new BadRequestException("A conferência da tag não está contratada nesta empresa.");
    const cobertura = tag.get(viagem.id)?.cobertura;
    if (!cobertura) throw new BadRequestException("Nenhuma passagem da tag está ligada a esta viagem.");

    const lancado = pedagioDaViagem(viagem).valor;
    const valor = new Prisma.Decimal(input.valorReembolso.toFixed(2));
    if (valor.gt(lancado)) {
      throw new BadRequestException(`O reembolso não pode passar do que foi lançado (R$ ${lancado.toFixed(2)}).`);
    }
    const sugestao = sugestaoDeReembolso(lancado, cobertura);
    // Fora da sugestão é decisão de gente sobre dinheiro de parceiro: por escrito.
    const motivo = input.motivo?.trim() || null;
    if (!valor.eq(sugestao) && (!motivo || motivo.length < 10)) {
      throw new BadRequestException("Valor diferente da sugestão: escreva o motivo (pelo menos 10 letras).");
    }

    const anterior = await this.prisma.decisaoPedagioTag.findFirst({
      where: { viagemId: viagem.id },
      include: { itensAcerto: { select: { acerto: { select: { status: true } } } } },
    });
    if (anterior?.itensAcerto.some((i) => i.acerto.status !== "ABERTO")) {
      throw new ConflictException("O ajuste desta viagem já está num acerto fechado e não muda mais.");
    }
    const dados = {
      valorLancado: lancado,
      valorTag: pagoNaIda(cobertura),
      valorReembolso: valor,
      motivo,
      acertoId: id,
      decididoPorId: usuarioId,
      decididoEm: new Date(),
    };
    await this.prisma.$transaction(async (tx) => {
      // Ajuste da decisão antiga que estava em outro acerto aberto sai de lá:
      // a decisão nova gera o seu (senão ficavam os dois).
      if (anterior) await this.tirarAjustesAbertos(tx, anterior.id);
      await tx.decisaoPedagioTag.upsert({
        where: { contaId_viagemId: { contaId: contaIdAtual(), viagemId: viagem.id } },
        create: { viagemId: viagem.id, ...dados },
        update: dados,
      });
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "pedagioTag",
      valorAntes: anterior ? { viagemId: viagem.id, valorReembolso: anterior.valorReembolso.toFixed(2) } : null,
      valorDepois: { viagemId: viagem.id, valorReembolso: valor.toFixed(2), lancado: lancado.toFixed(2) },
      motivo: motivo ?? `Conferência da tag: devolver R$ ${valor.toFixed(2)} dos R$ ${lancado.toFixed(2)} lançados`,
    });
    await this.regerar(acerto, usuarioId);
    return this.conferencia(id);
  }

  async desfazerDecisaoPedagioTag(id: string, viagemId: string, usuarioId: string) {
    const acerto = await this.exigirAberto(id);
    const d = await this.prisma.decisaoPedagioTag.findFirst({
      where: { viagemId, viagem: { motoristaId: acerto.motoristaId } },
      include: { itensAcerto: { select: { acerto: { select: { status: true } } } } },
    });
    if (!d) throw new NotFoundException("Não há decisão sobre o pedágio desta viagem.");
    if (d.itensAcerto.some((i) => i.acerto.status !== "ABERTO")) {
      throw new ConflictException("O ajuste desta viagem já está num acerto fechado e não muda mais.");
    }
    await this.prisma.$transaction(async (tx) => {
      // Sem isto o ajuste ficava órfão (a FK vira null) num acerto aberto, e
      // decidir de novo descontava duas vezes.
      await this.tirarAjustesAbertos(tx, d.id);
      await tx.decisaoPedagioTag.delete({ where: { id: d.id } });
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "AcertoMotorista",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "pedagioTag",
      valorAntes: { viagemId, valorReembolso: d.valorReembolso.toFixed(2) },
      valorDepois: null,
      motivo: "Desfez a conferência do pedágio com a tag",
    });
    await this.regerar(acerto, usuarioId);
    return this.conferencia(id);
  }

  /** Tira os ajustes desta decisão dos acertos ABERTOS e refaz o total de cada um. */
  private async tirarAjustesAbertos(tx: Prisma.TransactionClient, decisaoId: string) {
    const itens = await tx.itemAcerto.findMany({
      where: { decisaoPedagioTagId: decisaoId, acerto: { status: "ABERTO" } },
      select: { id: true, acertoId: true },
    });
    if (itens.length === 0) return;
    await tx.itemAcerto.deleteMany({ where: { id: { in: itens.map((i) => i.id) } } });
    for (const acertoId of new Set(itens.map((i) => i.acertoId))) await this.recalcularTotais(tx, acertoId);
  }

  private regerar(acerto: { motoristaId: string; periodoInicio: Date; periodoFim: Date }, usuarioId: string) {
    return this.gerar(
      {
        motoristaId: acerto.motoristaId,
        periodoInicio: acerto.periodoInicio.toISOString().slice(0, 10),
        periodoFim: acerto.periodoFim.toISOString().slice(0, 10),
      },
      usuarioId,
    );
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
