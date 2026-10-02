import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria, Prisma, type StatusSolicitacaoObra } from "@prisma/client";
import type { ConfirmarSolicitacaoObraInput, RecusarSolicitacaoObraInput } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { PedidosService } from "../admin/pedidos/pedidos.service";

const INCLUDE = {
  cliente: { select: { id: true, nome: true, empresa: { select: { id: true, nome: true } } } },
  encarregado: { select: { id: true, nome: true, telefone: true } },
  material: { select: { id: true, nome: true } },
  pedido: { select: { id: true, numero: true } },
  respondidoPor: { select: { nome: true } },
} satisfies Prisma.SolicitacaoObraInclude;

/**
 * Os pedidos de caminhão que chegam das obras, no lado do escritório. Aparecem
 * na programação: confirmar programa as viagens; recusar exige motivo, que a
 * obra lê no portal.
 */
@Injectable()
export class SolicitacoesObraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly pedidos: PedidosService,
  ) {}

  async listar(status: StatusSolicitacaoObra = "PENDENTE") {
    const itens = await this.prisma.solicitacaoObra.findMany({
      where: { status },
      include: INCLUDE,
      // Pendente: o mais urgente (a data mais próxima) primeiro. Respondida:
      // o mais recente primeiro, que é o que alguém vem conferir.
      orderBy: status === "PENDENTE" ? [{ data: "asc" }, { criadoEm: "asc" }] : [{ respondidoEm: "desc" }],
      take: 50,
    });

    // Os pedidos abertos de cada obra, pro escritório escolher onde encaixar
    // sem abrir outra tela. Só os da MESMA obra: encaixar em pedido de outra
    // obra faria a viagem abater o saldo errado.
    const obraIds = [...new Set(itens.map((i) => i.clienteId))];
    const abertos = obraIds.length
      ? await this.prisma.pedido.findMany({
          where: { clienteId: { in: obraIds }, status: { in: ["ABERTO", "EM_CURSO"] } },
          select: {
            id: true,
            numero: true,
            clienteId: true,
            unidadeAlvo: true,
            material: { select: { nome: true } },
          },
          orderBy: { numero: "desc" },
        })
      : [];
    const saldos = await this.pedidos.saldosDe(abertos.map((p) => p.id));

    return itens.map((s) => ({
      ...s,
      pedidosDaObra: abertos
        .filter((p) => p.clienteId === s.clienteId)
        .map((p) => ({
          id: p.id,
          numero: p.numero,
          unidade: p.unidadeAlvo,
          material: p.material?.nome ?? null,
          restante: saldos.get(p.id)?.restante ?? null,
        })),
    }));
  }

  async contarPendentes() {
    return { pendentes: await this.prisma.solicitacaoObra.count({ where: { status: "PENDENTE" } }) };
  }

  /**
   * Confirma: encaixa num pedido da obra (ou cria um com o que ela pediu) e
   * programa as viagens no dia pedido. As planejadas nascem PLANEJADA, sem
   * publicar — o motorista só fica sabendo quando alguém publicar o dia, como
   * qualquer outra do quadro.
   */
  async confirmar(id: string, input: ConfirmarSolicitacaoObraInput, usuarioId: string) {
    const sol = await this.prisma.solicitacaoObra.findUnique({
      where: { id },
      include: { cliente: { select: { empresaId: true } }, encarregado: { select: { nome: true } } },
    });
    if (!sol) throw new NotFoundException("Pedido da obra não encontrado");
    if (sol.status !== "PENDENTE") throw new BadRequestException("Esse pedido já foi respondido.");

    if (input.pedidoId) {
      const p = await this.prisma.pedido.findUnique({
        where: { id: input.pedidoId },
        select: { clienteId: true, status: true },
      });
      if (!p) throw new NotFoundException("Pedido não encontrado");
      if (p.clienteId !== sol.clienteId) throw new BadRequestException("Esse pedido é de outra obra.");
      if (p.status === "CANCELADO") throw new BadRequestException("Esse pedido foi cancelado.");
    }
    if (input.motoristaId) {
      const m = await this.prisma.motorista.findUnique({ where: { id: input.motoristaId }, select: { id: true } });
      if (!m) throw new NotFoundException("Motorista não encontrado");
    }
    if (input.veiculoId) {
      const v = await this.prisma.veiculo.findUnique({ where: { id: input.veiculoId }, select: { id: true } });
      if (!v) throw new NotFoundException("Caminhão não encontrado");
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      // Corrida: dois do escritório confirmando o mesmo pedido ao mesmo tempo
      // programariam em dobro. O updateMany condicional é o cadeado.
      const trava = await tx.solicitacaoObra.updateMany({
        where: { id, status: "PENDENTE" },
        data: { status: "CONFIRMADA", respondidoPorId: usuarioId, respondidoEm: new Date() },
      });
      if (trava.count === 0) throw new BadRequestException("Esse pedido já foi respondido.");

      let pedidoId = input.pedidoId ?? null;
      if (!pedidoId) {
        const ultimo = await tx.pedido.aggregate({ _max: { numero: true } });
        const novo = await tx.pedido.create({
          data: {
            numero: (ultimo._max.numero ?? 0) + 1,
            empresaId: sol.cliente.empresaId,
            clienteId: sol.clienteId,
            materialId: sol.materialId,
            quantidadeAlvo: sol.quantidade,
            unidadeAlvo: sol.unidade,
            inicioEm: sol.data,
            observacao: `Pedido pela obra no portal (${sol.encarregado.nome}).${sol.observacao ? ` ${sol.observacao}` : ""}`,
            criadoPorId: usuarioId,
          },
          select: { id: true },
        });
        pedidoId = novo.id;
      }

      const base = input.motoristaId
        ? ((
            await tx.viagemPlanejada.aggregate({
              where: { motoristaId: input.motoristaId, dataPrevista: sol.data },
              _max: { sequencia: true },
            })
          )._max.sequencia ?? -1) + 1
        : 0;
      for (let i = 0; i < input.viagens; i++) {
        await tx.viagemPlanejada.create({
          data: {
            pedidoId,
            motoristaId: input.motoristaId ?? null,
            veiculoId: input.veiculoId ?? null,
            dataPrevista: sol.data,
            janelaInicio: input.janelaInicio ?? null,
            sequencia: base + i,
            solicitacaoObraId: id,
            observacao: sol.observacao,
            criadoPorId: usuarioId,
          },
        });
      }
      await tx.pedido.updateMany({ where: { id: pedidoId, status: "ABERTO" }, data: { status: "EM_CURSO" } });
      return tx.solicitacaoObra.update({
        where: { id },
        data: { pedidoId, viagensProgramadas: input.viagens },
        include: INCLUDE,
      });
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "SolicitacaoObra",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      motivo: `Pedido da obra confirmado: ${input.viagens} viagem(ns) programada(s).`,
      metadata: { pedidoId: resultado.pedidoId, criouPedido: !input.pedidoId },
    });
    return resultado;
  }

  async recusar(id: string, input: RecusarSolicitacaoObraInput, usuarioId: string) {
    const r = await this.prisma.solicitacaoObra.updateMany({
      where: { id, status: "PENDENTE" },
      data: {
        status: "RECUSADA",
        recusaMotivo: input.motivo,
        respondidoPorId: usuarioId,
        respondidoEm: new Date(),
      },
    });
    if (r.count === 0) {
      const existe = await this.prisma.solicitacaoObra.findUnique({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException("Pedido da obra não encontrado");
      throw new BadRequestException("Esse pedido já foi respondido.");
    }
    await this.auditoria.log({
      usuarioId,
      entidade: "SolicitacaoObra",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      motivo: `Pedido da obra recusado: ${input.motivo}`,
    });
    return this.prisma.solicitacaoObra.findUnique({ where: { id }, include: INCLUDE });
  }
}
