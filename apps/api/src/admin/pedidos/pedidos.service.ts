import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AtualizarPedidoInput, CriarPedidoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { aplicarMinimos, resolverRegraMinimo, type RegraMinimoRow } from "../../common/viagem-minimos";
import { calcularSaldoPedido, type ViagemAbatida } from "../../common/pedido-saldo";

type ListParams = PaginationQuery & {
  empresaId?: string;
  status?: string;
  /** "true" = só o que ainda tem saldo. É como a tela abre. */
  abertos?: "true" | "false";
};

const INCLUDE = {
  empresa: { select: { id: true, nome: true } },
  cliente: { select: { id: true, nome: true } },
  material: { select: { id: true, nome: true } },
  localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
  tipoServico: { select: { id: true, nome: true } },
  _count: { select: { planejadas: true } },
} satisfies Prisma.PedidoInclude;

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

@Injectable()
export class PedidosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListParams) {
    const where: Prisma.PedidoWhereInput = {};
    if (params.empresaId) where.empresaId = params.empresaId;
    if (params.status) where.status = params.status as Prisma.PedidoWhereInput["status"];
    if (params.abertos === "true") where.status = { in: ["ABERTO", "EM_CURSO"] };

    const paged = await paginate(this.prisma.pedido, {
      params,
      where: where as Record<string, unknown>,
      // Pedido é da relação com o tomador, não de uma frota.
      escopo: SEM_ESCOPO,
      searchFields: ["empresa.nome", "cliente.nome", "material.nome", "observacao"],
      sortable: {
        numero: "numero",
        prazoEm: "prazoEm",
        prioridade: "prioridade",
        criadoEm: "criadoEm",
      },
      defaultSort: { field: "prioridade", order: "desc" },
      include: INCLUDE,
    });

    // O saldo é derivado, então precisa das viagens de cada pedido. Uma consulta
    // agregada pra todos os pedidos da página — não uma por pedido.
    const linhas = paged.data as Array<Record<string, unknown> & { id: string }>;
    const saldos = await this.saldosDe(linhas.map((p) => p.id));
    return {
      ...paged,
      data: linhas.map((p) => ({ ...p, saldo: saldos.get(p.id) ?? null })),
    };
  }

  async findOne(id: string) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id }, include: INCLUDE });
    if (!pedido) throw new NotFoundException("Pedido não encontrado");
    const saldos = await this.saldosDe([id]);

    // As viagens que abateram, pra tela poder mostrar de onde veio o número.
    const viagens = await this.viagensDoPedido(pedido);
    return {
      ...pedido,
      saldo: saldos.get(id) ?? null,
      viagens: viagens.slice(0, 100),
    };
  }

  async create(data: CriarPedidoInput, usuarioId: string) {
    await this.validarRefs(data);

    // Numeração sequencial por conta. `max + 1` dentro da transação: duas
    // criações simultâneas na mesma conta pegariam o mesmo número fora dela, e
    // o índice único transformaria isso num erro feio em vez de na próxima
    // sequência. O retry cobre a corrida rara.
    return this.prisma.$transaction(async (tx) => {
      const ultimo = await tx.pedido.aggregate({ _max: { numero: true } });
      return tx.pedido.create({
        data: {
          ...data,
          numero: (ultimo._max.numero ?? 0) + 1,
          inicioEm: diaUtc(data.inicioEm),
          prazoEm: data.prazoEm ? diaUtc(data.prazoEm) : null,
          criadoPorId: usuarioId,
        },
        include: INCLUDE,
      });
    });
  }

  async update(id: string, data: AtualizarPedidoInput) {
    await this.ensureExists(id);
    await this.validarRefs(data);
    return this.prisma.pedido.update({
      where: { id },
      data: {
        ...data,
        ...(data.inicioEm ? { inicioEm: diaUtc(data.inicioEm) } : {}),
        ...(data.prazoEm !== undefined
          ? { prazoEm: data.prazoEm ? diaUtc(data.prazoEm) : null }
          : {}),
      },
      include: INCLUDE,
    });
  }

  /**
   * Pedido com programação vira CANCELADO; sem nada, some de verdade.
   *
   * Apagar um pedido que já gerou viagem programada deixaria o quadro do dia
   * apontando pro vazio — e a `ViagemPlanejada` sobreviveria com `pedidoId`
   * null, sem ninguém saber de onde veio.
   */
  async remove(id: string) {
    await this.ensureExists(id);
    const planejadas = await this.prisma.viagemPlanejada.count({ where: { pedidoId: id } });
    if (planejadas > 0) {
      await this.prisma.pedido.update({ where: { id }, data: { status: "CANCELADO" } });
      return { ok: true, cancelado: true, planejadas };
    }
    await this.prisma.pedido.delete({ where: { id } });
    return { ok: true, cancelado: false, planejadas: 0 };
  }

  /**
   * As viagens reais que abatem o pedido.
   *
   * Casa pelo que o pedido definiu: empresa sempre, e cliente/material/locais
   * quando preenchidos. Campo em branco no pedido = "qualquer" — quem pediu
   * "20 viagens de brita" sem dizer a obra quer contar todas as de brita.
   *
   * Sempre exclui `STATUS_FORA_FECHAMENTO`: viagem sem peso abatendo pedido por
   * tonelada contaria 0 t e daria o pedido como mais atrasado do que está.
   */
  private montarWhereViagens(pedido: {
    empresaId: string;
    clienteId: string | null;
    materialId: string | null;
    localCargaId: string | null;
    localDescargaId: string | null;
    inicioEm: Date;
    prazoEm: Date | null;
  }): Prisma.ViagemWhereInput {
    return {
      status: { notIn: STATUS_FORA_FECHAMENTO },
      cliente: pedido.clienteId
        ? { id: pedido.clienteId }
        : { empresaId: pedido.empresaId },
      ...(pedido.materialId ? { materialId: pedido.materialId } : {}),
      ...(pedido.localCargaId ? { localCargaId: pedido.localCargaId } : {}),
      ...(pedido.localDescargaId ? { localDescargaId: pedido.localDescargaId } : {}),
      data: {
        gte: pedido.inicioEm,
        // Sem prazo, conta até hoje: um pedido aberto acumula o que vier.
        ...(pedido.prazoEm ? { lte: pedido.prazoEm } : {}),
      },
    };
  }

  private async viagensDoPedido(pedido: Parameters<PedidosService["montarWhereViagens"]>[0]) {
    return this.prisma.viagem.findMany({
      where: this.montarWhereViagens(pedido),
      select: {
        id: true,
        data: true,
        ticket: true,
        km: true,
        toneladas: true,
        materialId: true,
        motorista: { select: { id: true, nome: true } },
        veiculo: { select: { id: true, placa: true } },
        cliente: { select: { id: true, nome: true, empresaId: true } },
      },
      orderBy: { data: "desc" },
    });
  }

  /** Saldo de vários pedidos de uma vez. */
  private async saldosDe(ids: string[]) {
    const mapa = new Map<string, ReturnType<typeof calcularSaldoPedido>>();
    if (ids.length === 0) return mapa;

    const pedidos = await this.prisma.pedido.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        empresaId: true,
        clienteId: true,
        materialId: true,
        localCargaId: true,
        localDescargaId: true,
        inicioEm: true,
        prazoEm: true,
        quantidadeAlvo: true,
        unidadeAlvo: true,
      },
    });

    // O mínimo por faixa vale aqui também: se a viagem fatura 27 t, é 27 t que
    // o cliente recebeu na conta dele — abater pelo real deixaria o pedido
    // eternamente atrasado na tela de quem cobra pelo efetivo.
    const regras = (await this.prisma.regraMinimo.findMany({
      where: { ativo: true },
    })) as unknown as RegraMinimoRow[];

    for (const p of pedidos) {
      const viagens = await this.viagensDoPedido(p);
      const abatidas: ViagemAbatida[] = viagens.map((v) => {
        const override =
          v.cliente?.empresaId && regras.length > 0
            ? (resolverRegraMinimo(regras, v.cliente.empresaId, v.materialId, v.km ?? 0) ??
              undefined)
            : undefined;
        return { toneladas: aplicarMinimos(v, override).toneladasEfetiva };
      });
      mapa.set(
        p.id,
        calcularSaldoPedido({
          quantidadeAlvo: p.quantidadeAlvo,
          unidadeAlvo: p.unidadeAlvo,
          viagens: abatidas,
          prazoEm: p.prazoEm,
        }),
      );
    }
    return mapa;
  }

  private async validarRefs(data: {
    empresaId?: string;
    clienteId?: string | null;
    materialId?: string | null;
    localCargaId?: string | null;
    localDescargaId?: string | null;
    tipoServicoId?: string | null;
  }) {
    if (data.empresaId) {
      const e = await this.prisma.empresa.findUnique({ where: { id: data.empresaId } });
      if (!e) throw new NotFoundException("Cliente não encontrado");
    }
    if (data.clienteId) {
      const c = await this.prisma.cliente.findUnique({
        where: { id: data.clienteId },
        select: { empresaId: true },
      });
      if (!c) throw new NotFoundException("Obra não encontrada");
      // Cliente de outra empresa no pedido faria o abatimento nunca casar —
      // o filtro exige as duas coisas ao mesmo tempo.
      if (data.empresaId && c.empresaId !== data.empresaId) {
        throw new BadRequestException("Essa obra é de outro cliente.");
      }
    }
    for (const [campo, id] of [
      ["Material", data.materialId],
      ["Local de carga", data.localCargaId],
      ["Local de descarga", data.localDescargaId],
      ["Modo de serviço", data.tipoServicoId],
    ] as const) {
      if (!id) continue;
      const achou =
        campo === "Material"
          ? await this.prisma.material.findUnique({ where: { id } })
          : campo === "Modo de serviço"
            ? await this.prisma.tipoServico.findUnique({ where: { id } })
            : await this.prisma.local.findUnique({ where: { id } });
      if (!achou) throw new NotFoundException(`${campo} não encontrado`);
    }
  }

  private async ensureExists(id: string) {
    const p = await this.prisma.pedido.findUnique({ where: { id } });
    if (!p) throw new NotFoundException("Pedido não encontrado");
    return p;
  }
}
