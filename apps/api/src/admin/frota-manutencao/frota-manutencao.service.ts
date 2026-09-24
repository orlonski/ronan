import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AtualizarManutencaoInput,
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

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

@Injectable()
export class FrotaManutencaoService {
  constructor(private readonly prisma: PrismaService) {}

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
      emOficina: emOficina.map((m) => ({
        id: m.id,
        veiculo: m.veiculo,
        descricao: m.descricao,
        desde: m.iniciadaEm,
      })),
    };
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
