import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma } from "@prisma/client";
import type {
  AtualizarFaturaInput,
  CriarTituloPagarInput,
  DarBaixaInput,
  GerarFaturaInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import {
  apurarTitulo,
  gerarParcelas,
  montarAging,
  vencimentoPeloPrazo,
  type TituloParaAging,
} from "../../common/financeiro";

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

@Injectable()
export class FinanceiroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ---------------------------------------------------------------- faturas

  /**
   * Transforma o período conferido em cobrança.
   *
   * As linhas saem do `ViagemValor` — o valor congelado de cada viagem — e são
   * copiadas pra `FaturaLinha`. A cópia é o ponto: a fatura emitida não pode
   * mudar porque alguém corrigiu o km depois. Mês fechado que muda sozinho é
   * como a contabilidade do cliente perde a fé no sistema.
   */
  async gerarFatura(input: GerarFaturaInput, usuarioId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: input.empresaId },
      select: { id: true, nome: true, prazoPagamentoDias: true },
    });
    if (!empresa) throw new NotFoundException("Empresa não encontrada");

    const inicio = diaUtc(input.periodoInicio);
    const fim = diaUtc(input.periodoFim);

    const viagens = await this.prisma.viagem.findMany({
      where: {
        cliente: { empresaId: empresa.id },
        data: { gte: inicio, lte: fim },
        status: { notIn: STATUS_FORA_FECHAMENTO },
        // Só o que tem valor: viagem sem preço cadastrado entraria como R$ 0,00
        // na fatura, e zero numa cobrança parece conferido e aceito.
        valor: { isNot: null },
        // Não refatura o que já está em fatura viva.
        faturaLinhas: { none: { fatura: { status: { not: "CANCELADA" } } } },
      },
      select: {
        id: true,
        data: true,
        ticket: true,
        cliente: { select: { nome: true } },
        material: { select: { nome: true } },
        valor: {
          select: { quantidade: true, precoUnitario: true, valorTotal: true, base: true },
        },
      },
      orderBy: { data: "asc" },
    });

    if (viagens.length === 0) {
      throw new BadRequestException(
        `Nenhuma viagem com valor pra faturar de ${empresa.nome} nesse período. ` +
          `Confira se a tabela de preços está cadastrada e se as viagens já foram precificadas.`,
      );
    }

    const bruto = viagens.reduce(
      (acc, v) => acc.add(new Prisma.Decimal(v.valor!.valorTotal)),
      new Prisma.Decimal(0),
    );

    const prazo = input.prazoDias ?? empresa.prazoPagamentoDias ?? null;
    const parcelas = gerarParcelas({
      valorTotal: bruto,
      parcelas: input.parcelas,
      primeiroVencimento: vencimentoPeloPrazo(fim, prazo),
    });

    const fatura = await this.prisma.$transaction(async (tx) => {
      const ultima = await tx.fatura.aggregate({ _max: { numero: true } });
      const criada = await tx.fatura.create({
        data: {
          numero: (ultima._max.numero ?? 0) + 1,
          empresaId: empresa.id,
          fechamentoId: input.fechamentoId ?? null,
          periodoInicio: inicio,
          periodoFim: fim,
          valorBruto: bruto,
          valorLiquido: bruto,
          observacao: input.observacao ?? null,
          criadoPorId: usuarioId,
        },
      });

      await tx.faturaLinha.createMany({
        // `Viagem.data` é nullable (o lifecycle abre sem data). O filtro de
        // status já tira as incompletas, mas o tipo não sabe — e faturar uma
        // viagem sem data seria cobrar por algo que não dá pra localizar no
        // período.
        data: viagens
          .filter((v): v is typeof v & { data: Date } => v.data != null)
          .map((v) => ({
          faturaId: criada.id,
          viagemId: v.id,
          descricao: [
            v.data.toISOString().slice(0, 10).split("-").reverse().join("/"),
            v.ticket ? `ticket ${v.ticket}` : null,
            v.cliente?.nome,
            v.material?.nome,
          ]
            .filter(Boolean)
            .join(" · "),
          quantidade: v.valor!.quantidade,
          precoUnitario: v.valor!.precoUnitario,
          valor: v.valor!.valorTotal,
        })),
      });

      await tx.tituloReceber.createMany({
        data: parcelas.map((p) => ({
          faturaId: criada.id,
          empresaId: empresa.id,
          parcela: p.parcela,
          emissao: new Date(),
          vencimento: p.vencimento,
          valor: p.valor,
        })),
      });

      return criada;
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "Fatura",
      entidadeId: fatura.id,
      acao: AcaoAuditoria.UPDATE,
      motivo: `Fatura ${fatura.numero} gerada com ${viagens.length} viagem(ns)`,
      valorDepois: { valorBruto: bruto.toFixed(2), parcelas: parcelas.length },
    });

    return this.detalheFatura(fatura.id);
  }

  listFaturas(params: PaginationQuery & { empresaId?: string; status?: string }) {
    const where: Prisma.FaturaWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.status) where.status = params.status as Prisma.FaturaWhereInput["status"];
    return paginate(this.prisma.fatura, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["empresa.nome", "observacao"],
      sortable: { numero: "numero", periodoInicio: "periodoInicio", valorLiquido: "valorLiquido" },
      defaultSort: { field: "numero", order: "desc" },
      include: {
        empresa: { select: { id: true, nome: true } },
        _count: { select: { linhas: true, titulos: true } },
      },
    });
  }

  async detalheFatura(id: string) {
    const f = await this.prisma.fatura.findUnique({
      where: { id },
      include: {
        empresa: { select: { id: true, nome: true, cnpj: true, prazoPagamentoDias: true } },
        linhas: { orderBy: { descricao: "asc" } },
        titulos: {
          orderBy: { parcela: "asc" },
          include: { baixas: { orderBy: { data: "asc" } } },
        },
      },
    });
    if (!f) throw new NotFoundException("Fatura não encontrada");

    return {
      ...f,
      titulos: f.titulos.map((t) => ({ ...t, ...apurarTitulo(t.valor, t.baixas, t.status) })),
    };
  }

  async atualizarFatura(id: string, input: AtualizarFaturaInput, usuarioId: string) {
    const f = await this.prisma.fatura.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("Fatura não encontrada");

    // Cancelar fatura com título já baixado deixaria dinheiro recebido apontando
    // pro vazio. O conserto de um recebimento errado é outro lançamento, não
    // apagar o passado.
    if (input.status === "CANCELADA") {
      const comBaixa = await this.prisma.baixaTitulo.count({
        where: { tituloReceber: { faturaId: id } },
      });
      if (comBaixa > 0) {
        throw new ConflictException(
          "Essa fatura já tem recebimento lançado. Cancele as baixas antes, ou lance um ajuste.",
        );
      }
    }

    const atualizada = await this.prisma.fatura.update({
      where: { id },
      data: {
        ...input,
        ...(input.status === "EMITIDA" && !f.emitidaEm ? { emitidaEm: new Date() } : {}),
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "Fatura",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      valorAntes: { status: f.status },
      valorDepois: { status: atualizada.status },
    });
    return this.detalheFatura(id);
  }

  // ---------------------------------------------------------------- títulos

  listReceber(params: PaginationQuery & { empresaId?: string; status?: string; vencidos?: string }) {
    const where: Prisma.TituloReceberWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.status) where.status = params.status as Prisma.TituloReceberWhereInput["status"];
    if (params.vencidos === "true") {
      where.status = { in: ["ABERTO", "PARCIAL"] };
      where.vencimento = { lt: new Date() };
    }
    return paginate(this.prisma.tituloReceber, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["empresa.nome", "observacao"],
      sortable: { vencimento: "vencimento", valor: "valor", status: "status" },
      defaultSort: { field: "vencimento", order: "asc" },
      include: {
        empresa: { select: { id: true, nome: true } },
        fatura: { select: { id: true, numero: true } },
      },
    });
  }

  listPagar(params: PaginationQuery & { status?: string; vencidos?: string }) {
    const where: Prisma.TituloPagarWhereInput = {};
    if (params.status) where.status = params.status as Prisma.TituloPagarWhereInput["status"];
    if (params.vencidos === "true") {
      where.status = { in: ["ABERTO", "PARCIAL"] };
      where.vencimento = { lt: new Date() };
    }
    return paginate(this.prisma.tituloPagar, {
      params,
      where: where as Record<string, unknown>,
      escopo: SEM_ESCOPO,
      searchFields: ["descricao", "fornecedor.nome", "motorista.nome"],
      sortable: { vencimento: "vencimento", valor: "valor", status: "status" },
      defaultSort: { field: "vencimento", order: "asc" },
      include: {
        motorista: { select: { id: true, nome: true } },
        transportadora: { select: { id: true, nome: true } },
        fornecedor: { select: { id: true, nome: true, tipo: true } },
        veiculo: { select: { id: true, placa: true } },
      },
    });
  }

  async criarTituloPagar(input: CriarTituloPagarInput, usuarioId: string) {
    return this.prisma.tituloPagar.create({
      data: {
        descricao: input.descricao,
        valor: input.valor,
        emissao: input.emissao ? diaUtc(input.emissao) : new Date(),
        vencimento: diaUtc(input.vencimento),
        motoristaId: input.motoristaId ?? null,
        transportadoraId: input.transportadoraId ?? null,
        fornecedorId: input.fornecedorId ?? null,
        veiculoId: input.veiculoId ?? null,
        observacao: input.observacao ?? null,
        criadoPorId: usuarioId,
      },
    });
  }

  /**
   * Baixa num título, de qualquer um dos dois lados.
   *
   * O status NÃO é escrito à mão: é derivado da soma das baixas. Um booleano
   * "pago" não responde "recebemos metade em março e o resto em abril?", que é a
   * pergunta que o financeiro faz toda semana.
   */
  async darBaixa(
    tipo: "receber" | "pagar",
    id: string,
    input: DarBaixaInput,
    usuarioId: string,
  ) {
    const titulo =
      tipo === "receber"
        ? await this.prisma.tituloReceber.findUnique({
            where: { id },
            include: { baixas: true },
          })
        : await this.prisma.tituloPagar.findUnique({
            where: { id },
            include: { baixas: true },
          });
    if (!titulo) throw new NotFoundException("Título não encontrado");
    if (titulo.status === "CANCELADO") {
      throw new ConflictException("Esse título foi cancelado.");
    }

    const antes = apurarTitulo(titulo.valor, titulo.baixas, titulo.status);
    // Baixa maior que o saldo é quase sempre dedo errado; aceitar calado faz o
    // relatório mentir pra sempre.
    if (new Prisma.Decimal(input.valor).gt(new Prisma.Decimal(antes.saldo))) {
      throw new BadRequestException(
        `O saldo desse título é R$ ${antes.saldo}. Baixe no máximo esse valor.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.baixaTitulo.create({
        data: {
          ...(tipo === "receber" ? { tituloReceberId: id } : { tituloPagarId: id }),
          data: input.data ? diaUtc(input.data) : new Date(),
          valor: input.valor,
          meio: input.meio,
          usuarioId,
          observacao: input.observacao ?? null,
        },
      });

      const baixas =
        tipo === "receber"
          ? await tx.baixaTitulo.findMany({ where: { tituloReceberId: id }, select: { valor: true } })
          : await tx.baixaTitulo.findMany({ where: { tituloPagarId: id }, select: { valor: true } });
      const depois = apurarTitulo(titulo.valor, baixas, titulo.status);

      const data = { valorPago: depois.valorPago, status: depois.status };
      if (tipo === "receber") await tx.tituloReceber.update({ where: { id }, data });
      else await tx.tituloPagar.update({ where: { id }, data });
    });

    await this.auditoria.log({
      usuarioId,
      entidade: tipo === "receber" ? "TituloReceber" : "TituloPagar",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "baixa",
      valorDepois: { valor: input.valor, meio: input.meio },
      motivo: input.observacao ?? `Baixa de R$ ${input.valor}`,
    });

    return tipo === "receber"
      ? this.prisma.tituloReceber.findUnique({ where: { id }, include: { baixas: true } })
      : this.prisma.tituloPagar.findUnique({ where: { id }, include: { baixas: true } });
  }

  /** Desfaz uma baixa lançada errado. */
  async estornarBaixa(baixaId: string, usuarioId: string) {
    const baixa = await this.prisma.baixaTitulo.findUnique({ where: { id: baixaId } });
    if (!baixa) throw new NotFoundException("Baixa não encontrada");

    await this.prisma.$transaction(async (tx) => {
      await tx.baixaTitulo.delete({ where: { id: baixaId } });

      if (baixa.tituloReceberId) {
        const t = await tx.tituloReceber.findUniqueOrThrow({
          where: { id: baixa.tituloReceberId },
          include: { baixas: { select: { valor: true } } },
        });
        const r = apurarTitulo(t.valor, t.baixas, t.status);
        await tx.tituloReceber.update({
          where: { id: t.id },
          data: { valorPago: r.valorPago, status: r.status },
        });
      }
      if (baixa.tituloPagarId) {
        const t = await tx.tituloPagar.findUniqueOrThrow({
          where: { id: baixa.tituloPagarId },
          include: { baixas: { select: { valor: true } } },
        });
        const r = apurarTitulo(t.valor, t.baixas, t.status);
        await tx.tituloPagar.update({
          where: { id: t.id },
          data: { valorPago: r.valorPago, status: r.status },
        });
      }
    });

    await this.auditoria.log({
      usuarioId,
      entidade: baixa.tituloReceberId ? "TituloReceber" : "TituloPagar",
      entidadeId: baixa.tituloReceberId ?? baixa.tituloPagarId ?? baixaId,
      acao: AcaoAuditoria.DELETE,
      campo: "baixa",
      valorAntes: { valor: baixa.valor.toString(), meio: baixa.meio },
      motivo: "Baixa estornada",
    });
    return { ok: true };
  }

  /**
   * O painel do financeiro: quanto entra, quanto sai e o que está vencido.
   *
   * É a resposta para "quem está me devendo e há quanto tempo" — a pergunta que
   * o dono faz todo dia e que o sistema não respondia.
   */
  async resumo() {
    const [receber, pagar] = await Promise.all([
      this.prisma.tituloReceber.findMany({
        where: { status: { in: ["ABERTO", "PARCIAL"] } },
        select: { vencimento: true, valor: true, valorPago: true, status: true },
      }),
      this.prisma.tituloPagar.findMany({
        where: { status: { in: ["ABERTO", "PARCIAL"] } },
        select: { vencimento: true, valor: true, valorPago: true, status: true },
      }),
    ]);

    const maioresDevedores = await this.prisma.tituloReceber.groupBy({
      by: ["empresaId"],
      where: { status: { in: ["ABERTO", "PARCIAL"] } },
      _sum: { valor: true, valorPago: true },
      orderBy: { _sum: { valor: "desc" } },
      take: 5,
    });

    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: maioresDevedores.map((d) => d.empresaId) } },
      select: { id: true, nome: true },
    });
    const nomePorId = new Map(empresas.map((e) => [e.id, e.nome]));

    return {
      receber: montarAging(receber as TituloParaAging[]),
      pagar: montarAging(pagar as TituloParaAging[]),
      maioresDevedores: maioresDevedores.map((d) => ({
        empresaId: d.empresaId,
        nome: nomePorId.get(d.empresaId) ?? "—",
        saldo: new Prisma.Decimal(d._sum.valor ?? 0)
          .sub(new Prisma.Decimal(d._sum.valorPago ?? 0))
          .toFixed(2),
      })),
    };
  }
}
