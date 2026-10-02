import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, StatusViagem } from "@prisma/client";
import {
  UNIDADE_PEDIDO_LABEL,
  type PedirCaminhaoInput,
  type PortalObraProgramada,
  type PortalObraResumo,
  type PortalObraTicket,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { PedidosService } from "../admin/pedidos/pedidos.service";
import { STATUS_FORA_FECHAMENTO } from "../common/viagem-status";
import { aplicarMinimos, resolverRegraMinimo, type RegraMinimoRow } from "../common/viagem-minimos";
import { inicioDoDiaData } from "../common/timezone";
import { podeAprovarProgramada, STATUS_PROGRAMACAO_VISIVEL } from "./encarregado-regras";
import {
  serializarPedidoObra,
  serializarProgramada,
  serializarSolicitacao,
  serializarTicket,
} from "./encarregado-whitelist";
import type { AuthEncarregado } from "./encarregado.guard";

/**
 * Viagem que a obra NÃO vê: a que ainda está rodando (EM_ANDAMENTO seria a
 * posição ao vivo do caminhão por tabela), a sem peso, a incompleta e o
 * rascunho do aparelho. Ticket do dia é o que já chegou com peso.
 */
const STATUS_FORA_DO_PORTAL: StatusViagem[] = [...STATUS_FORA_FECHAMENTO, StatusViagem.RASCUNHO_OFFLINE];

/** Quanto pra frente/trás a programação pode ser consultada de uma vez. */
const JANELA_MAX_DIAS = 31;

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function somarDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function isoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * O que o encarregado vê e faz no portal da obra.
 *
 * Toda consulta aqui leva `enc.clienteId` (a OBRA dele) no where — a trava de
 * conta garante a empresa, e isto garante a obra. Os dois juntos são o que
 * impede o encarregado de uma obra ver a do vizinho da mesma transportadora.
 */
@Injectable()
export class EncarregadoPortalService {
  private readonly log = new Logger("PortalObra");

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly inbox: AdminInboxService,
    private readonly pedidos: PedidosService,
  ) {}

  async resumo(enc: AuthEncarregado): Promise<PortalObraResumo> {
    const [conta, obra] = await Promise.all([
      this.prisma.conta.findUnique({ where: { id: enc.contaId }, select: { nome: true, logoUrl: true } }),
      this.prisma.cliente.findUnique({ where: { id: enc.clienteId }, select: { nome: true } }),
    ]);
    if (!conta || !obra) throw new NotFoundException("Obra não encontrada");

    // Pedido cumprido ainda aparece por 30 dias: "fechou o que a gente pediu?"
    // é pergunta da semana seguinte, não do dia.
    const corte = somarDias(new Date(), -30);
    const pedidos = await this.prisma.pedido.findMany({
      where: {
        clienteId: enc.clienteId,
        OR: [{ status: { in: ["ABERTO", "EM_CURSO"] } }, { status: "CUMPRIDO", alteradoEm: { gte: corte } }],
      },
      select: {
        id: true,
        numero: true,
        empresaId: true,
        clienteId: true,
        materialId: true,
        localCargaId: true,
        localDescargaId: true,
        inicioEm: true,
        prazoEm: true,
        unidadeAlvo: true,
        material: { select: { nome: true } },
      },
      orderBy: [{ prioridade: "desc" }, { numero: "desc" }],
      take: 30,
    });
    const saldos = await this.pedidos.saldosDe(pedidos.map((p) => p.id));

    const linhas = [];
    for (const p of pedidos) {
      const saldo = saldos.get(p.id);
      if (!saldo) continue;
      let valorEntregue: Prisma.Decimal | null = null;
      if (enc.podeVerValores) {
        const ids = (await this.pedidos.viagensDoPedido(p)).map((v) => v.id);
        const soma = ids.length
          ? await this.prisma.viagemValor.aggregate({
              where: { viagemId: { in: ids } },
              _sum: { valorTotal: true },
            })
          : null;
        valorEntregue = soma?._sum.valorTotal ?? null;
      }
      linhas.push(serializarPedidoObra(p, saldo, { podeVerValores: enc.podeVerValores, valorEntregue }));
    }

    const [solicitacoes, materiais] = await Promise.all([
      this.prisma.solicitacaoObra.findMany({
        where: { clienteId: enc.clienteId },
        select: {
          id: true,
          data: true,
          quantidade: true,
          unidade: true,
          material: { select: { nome: true } },
          observacao: true,
          status: true,
          recusaMotivo: true,
          viagensProgramadas: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: "desc" },
        take: 20,
      }),
      enc.podePedirCaminhao
        ? this.prisma.material.findMany({
            where: { ativo: true },
            select: { id: true, nome: true },
            orderBy: { nome: "asc" },
            take: 100,
          })
        : Promise.resolve([]),
    ]);

    return {
      marca: { nome: conta.nome, logoUrl: conta.logoUrl },
      obra: { nome: obra.nome },
      encarregado: {
        nome: enc.nome,
        podeVerValores: enc.podeVerValores,
        podePedirCaminhao: enc.podePedirCaminhao,
      },
      pedidos: linhas,
      solicitacoes: solicitacoes.map(serializarSolicitacao),
      materiais,
    };
  }

  /** A programação da obra: o que está combinado pros próximos dias. */
  async programacao(enc: AuthEncarregado, de?: string, ate?: string): Promise<{ de: string; ate: string; itens: PortalObraProgramada[] }> {
    const inicio = de ? diaUtc(de) : inicioDoDiaData();
    const fim = ate ? diaUtc(ate) : somarDias(inicio, 7);
    if (fim < inicio) throw new BadRequestException("O fim precisa ser depois do começo.");
    if (fim.getTime() - inicio.getTime() > JANELA_MAX_DIAS * 86_400_000) {
      throw new BadRequestException(`Escolha no máximo ${JANELA_MAX_DIAS} dias.`);
    }

    const planejadas = await this.prisma.viagemPlanejada.findMany({
      // A planejada não tem obra própria: a obra é a do PEDIDO. Pedido sem obra
      // ("qualquer obra do cliente") não aparece — mostrar seria arriscar
      // exibir a programação de outra obra do mesmo cliente.
      where: {
        pedido: { clienteId: enc.clienteId },
        dataPrevista: { gte: inicio, lte: fim },
        status: { in: STATUS_PROGRAMACAO_VISIVEL },
      },
      select: {
        id: true,
        dataPrevista: true,
        janelaInicio: true,
        janelaFim: true,
        status: true,
        viagemId: true,
        aprovadaObraEm: true,
        veiculo: { select: { placa: true } },
        pedido: { select: { numero: true, material: { select: { nome: true } } } },
      },
      orderBy: [{ dataPrevista: "asc" }, { janelaInicio: "asc" }, { sequencia: "asc" }],
      take: 300,
    });
    return { de: isoDia(inicio), ate: isoDia(fim), itens: planejadas.map(serializarProgramada) };
  }

  /** "Pode vir": a obra confirma uma viagem programada. Idempotente. */
  async aprovar(enc: AuthEncarregado, planejadaId: string): Promise<PortalObraProgramada> {
    const select = {
      id: true,
      dataPrevista: true,
      janelaInicio: true,
      janelaFim: true,
      status: true,
      viagemId: true,
      aprovadaObraEm: true,
      veiculo: { select: { placa: true } },
      pedido: { select: { numero: true, material: { select: { nome: true } } } },
    } satisfies Prisma.ViagemPlanejadaSelect;

    // 404 (e não 403) pra planejada de outra obra: um 403 confirmaria que o id
    // existe.
    const p = await this.prisma.viagemPlanejada.findFirst({
      where: { id: planejadaId, pedido: { clienteId: enc.clienteId } },
      select,
    });
    if (!p) throw new NotFoundException("Viagem não encontrada");
    if (p.aprovadaObraEm) return serializarProgramada(p);
    if (!podeAprovarProgramada(p)) {
      throw new BadRequestException("Essa viagem não está mais esperando aprovação.");
    }
    const atualizada = await this.prisma.viagemPlanejada.update({
      where: { id: p.id },
      data: { aprovadaObraEm: new Date(), aprovadaObraPorId: enc.encarregadoId },
      select,
    });
    return serializarProgramada(atualizada);
  }

  /** As viagens que chegaram na obra num dia, com o ticket. */
  async tickets(
    enc: AuthEncarregado,
    dia?: string,
  ): Promise<{ dia: string; total: { viagens: number; toneladas: string }; viagens: PortalObraTicket[] }> {
    const data = dia ? diaUtc(dia) : inicioDoDiaData();
    const viagens = await this.prisma.viagem.findMany({
      where: { clienteId: enc.clienteId, data, status: { notIn: STATUS_FORA_DO_PORTAL } },
      select: {
        id: true,
        data: true,
        criadoOfflineEm: true,
        sincronizadoEm: true,
        ticket: true,
        km: true,
        toneladas: true,
        materialId: true,
        cliente: { select: { empresaId: true } },
        veiculo: { select: { placa: true } },
        material: { select: { nome: true } },
        fotos: { select: { id: true, rotacao: true }, orderBy: { capturadaEm: "asc" } },
        // Nem lê o valor sem a permissão: o que não sai do banco não vaza.
        valor: enc.podeVerValores ? { select: { valorTotal: true } } : false,
      },
      orderBy: [{ criadoOfflineEm: "asc" }, { sincronizadoEm: "asc" }],
      take: 300,
    });

    // O peso que CONTA pra obra é o efetivo (pós-mínimo) — é o que abate do
    // pedido e o que vai na fatura. Mostrar o real aqui faria a soma do dia não
    // bater com o saldo do resumo.
    const regras = (await this.prisma.regraMinimo.findMany({ where: { ativo: true } })) as unknown as RegraMinimoRow[];
    let soma = new Prisma.Decimal(0);
    const itens = viagens.map((v) => {
      const override =
        v.cliente?.empresaId && regras.length > 0
          ? (resolverRegraMinimo(regras, v.cliente.empresaId, v.materialId, v.km ?? 0) ?? undefined)
          : undefined;
      const efetiva = v.toneladas != null ? aplicarMinimos(v, override).toneladasEfetiva : null;
      if (efetiva != null) soma = soma.add(efetiva);
      return serializarTicket(
        { ...v, valor: (v as { valor?: { valorTotal: Prisma.Decimal } | null }).valor ?? null },
        efetiva != null ? new Prisma.Decimal(efetiva) : null,
        enc.podeVerValores,
      );
    });
    return { dia: isoDia(data), total: { viagens: itens.length, toneladas: soma.toFixed(3) }, viagens: itens };
  }

  /** A foto do ticket, servida pela API — o bucket nunca é público. */
  async foto(enc: AuthEncarregado, viagemId: string, fotoId: string) {
    const foto = await this.prisma.ticketFoto.findFirst({
      where: {
        id: fotoId,
        viagemId,
        viagem: { clienteId: enc.clienteId, status: { notIn: STATUS_FORA_DO_PORTAL } },
      },
      select: { storageKey: true },
    });
    if (!foto) throw new NotFoundException("Foto não encontrada");
    const buffer = await this.uploads.getObjectBuffer(foto.storageKey);
    const ext = foto.storageKey.split(".").pop()?.toLowerCase();
    return { buffer, contentType: ext === "png" ? "image/png" : "image/jpeg" };
  }

  /** "Preciso de caminhão": vira pedido pro escritório confirmar. */
  async pedirCaminhao(enc: AuthEncarregado, input: PedirCaminhaoInput) {
    if (!enc.podePedirCaminhao) {
      throw new ForbiddenException("Pedir caminhão por aqui não está liberado pra você. Fale com a transportadora.");
    }
    const hoje = inicioDoDiaData();
    const data = diaUtc(input.data);
    if (data < hoje) throw new BadRequestException("Escolha hoje ou um dia pra frente.");
    if (data > somarDias(hoje, 90)) throw new BadRequestException("Dá pra pedir com até 90 dias de antecedência.");

    let materialNome: string | null = null;
    if (input.materialId) {
      // A trava filtra pela empresa: material de outra transportadora não existe aqui.
      const m = await this.prisma.material.findFirst({
        where: { id: input.materialId, ativo: true },
        select: { nome: true },
      });
      if (!m) throw new BadRequestException("Esse material não está disponível. Escolha outro.");
      materialNome = m.nome;
    }

    const criada = await this.prisma.solicitacaoObra.create({
      data: {
        encarregadoId: enc.encarregadoId,
        clienteId: enc.clienteId,
        data,
        quantidade: new Prisma.Decimal(input.quantidade),
        unidade: input.unidade,
        materialId: input.materialId ?? null,
        observacao: input.observacao?.trim() || null,
      },
      select: {
        id: true,
        data: true,
        quantidade: true,
        unidade: true,
        material: { select: { nome: true } },
        observacao: true,
        status: true,
        recusaMotivo: true,
        viagensProgramadas: true,
        criadoEm: true,
        cliente: { select: { nome: true } },
      },
    });

    const qtd = Number(criada.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    const dataBR = `${input.data.slice(8, 10)}/${input.data.slice(5, 7)}`;
    // Fire-and-forget: o sininho é aviso. O pedido já está gravado e aparece na
    // programação de qualquer jeito.
    void this.inbox
      .disparar({
        tipo: "pedido-obra",
        titulo: `${criada.cliente.nome} pediu caminhão pra ${dataBR}`,
        corpo: `${qtd} ${UNIDADE_PEDIDO_LABEL[input.unidade]}${materialNome ? ` de ${materialNome}` : ""}. Pedido por ${enc.nome} (encarregado).`,
        dados: { solicitacaoId: criada.id, data: input.data },
        permissao: "programacao.editar",
      })
      .catch((e: unknown) => this.log.warn(`aviso de pedido da obra falhou: ${(e as Error).message}`));

    return serializarSolicitacao(criada);
  }
}
