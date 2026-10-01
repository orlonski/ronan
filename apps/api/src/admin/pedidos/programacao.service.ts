import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import type {
  AtualizarViagemPlanejadaInput,
  CopiarProgramacaoInput,
  CriarViagemPlanejadaInput,
  PublicarProgramacaoInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { comoSistema } from "../../common/conta/conta-context";
import { inicioDiasAtras } from "../../common/timezone";
import { PushService } from "../../push/push.service";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { casarPlanejada, type PlanejadaParaCasar } from "../../common/pedido-saldo";
import { planejarCopia } from "../../common/programacao-copia";
import { PedidosService } from "./pedidos.service";
import { DocumentosVencendoService } from "./documentos-vencendo.service";

const INCLUDE = {
  pedido: {
    select: {
      id: true,
      numero: true,
      empresa: { select: { id: true, nome: true } },
      cliente: { select: { id: true, nome: true } },
      material: { select: { id: true, nome: true } },
      localCarga: { select: { id: true, nome: true, cidade: true, uf: true } },
      localDescarga: { select: { id: true, nome: true, cidade: true, uf: true } },
    },
  },
  motorista: { select: { id: true, nome: true, telefone: true } },
  veiculo: { select: { id: true, placa: true, capacidadeToneladas: true } },
  viagem: { select: { id: true, ticket: true, toneladas: true } },
} satisfies Prisma.ViagemPlanejadaInclude;

function diaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

@Injectable()
export class ProgramacaoService {
  private readonly log = new Logger(ProgramacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly pedidos: PedidosService,
    private readonly documentos: DocumentosVencendoService,
  ) {}

  /**
   * O quadro de um dia: quem vai levar o quê.
   *
   * Vem junto a capacidade programada por motorista, que é o que responde
   * "cabe mais uma?" sem o supervisor abrir outra tela.
   */
  async doDia(dataIso: string, escopo: EscopoAdmin) {
    const data = diaUtc(dataIso);
    const planejadas = await this.prisma.viagemPlanejada.findMany({
      where: {
        dataPrevista: data,
        status: { not: "CANCELADA" },
        ...(escopo ? { motorista: filtroEscopo(escopo) as Prisma.MotoristaWhereInput } : {}),
      },
      include: INCLUDE,
      orderBy: [{ sequencia: "asc" }, { criadoEm: "asc" }],
    });

    // Quem está livre: motorista ativo sem nada programado no dia. É a metade
    // da pergunta que o supervisor faz o tempo todo (a outra é "cabe mais?").
    const comProgramacao = new Set(planejadas.map((p) => p.motoristaId).filter(Boolean));
    const motoristas = await this.prisma.motorista.findMany({
      where: {
        ativo: true,
        status: "APROVADO",
        ...(escopo ? (filtroEscopo(escopo) as Prisma.MotoristaWhereInput) : {}),
      },
      select: {
        id: true,
        nome: true,
        veiculoDefault: { select: { id: true, placa: true, capacidadeToneladas: true } },
      },
      orderBy: { nome: "asc" },
    });

    // Selo de documento vencendo no motorista e no caminhão: é na hora de
    // programar que "a CNH do Zé vence sexta" muda alguma coisa.
    const veiculoIds = [
      ...new Set(
        [...planejadas.map((p) => p.veiculoId), ...motoristas.map((m) => m.veiculoDefault?.id)].filter(
          (v): v is string => v != null,
        ),
      ),
    ];
    const documentos = await this.documentos.alertas(motoristas.map((m) => m.id), veiculoIds);

    return {
      data: dataIso,
      planejadas,
      documentos,
      motoristas: motoristas.map((m) => ({
        ...m,
        programadas: planejadas.filter((p) => p.motoristaId === m.id).length,
        livre: !comProgramacao.has(m.id),
      })),
    };
  }

  async criar(input: CriarViagemPlanejadaInput, usuarioId: string) {
    if (input.pedidoId) {
      const pedido = await this.prisma.pedido.findUnique({ where: { id: input.pedidoId } });
      if (!pedido) throw new NotFoundException("Pedido não encontrado");
      if (pedido.status === "CANCELADO") {
        throw new BadRequestException("Esse pedido foi cancelado.");
      }
    }
    if (input.motoristaId) {
      const m = await this.prisma.motorista.findUnique({ where: { id: input.motoristaId } });
      if (!m) throw new NotFoundException("Motorista não encontrado");
    }

    const data = diaUtc(input.dataPrevista);
    const { repetir, ...resto } = input;

    // Programar "4 viagens hoje" é o caso normal, não a exceção — criar uma a
    // uma na tela seria quatro cliques pro mesmo trabalho.
    const sequenciaBase = await this.proximaSequencia(input.motoristaId ?? null, data);
    const criadas = await this.prisma.$transaction(
      Array.from({ length: repetir }, (_, i) =>
        this.prisma.viagemPlanejada.create({
          data: {
            ...resto,
            dataPrevista: data,
            sequencia: sequenciaBase + i,
            criadoPorId: usuarioId,
          },
          include: INCLUDE,
        }),
      ),
    );

    if (input.pedidoId) await this.marcarPedidoEmCurso(input.pedidoId);
    return criadas;
  }

  /**
   * Repete o quadro de outro dia no dia aberto. A decisão do que entra mora em
   * `common/programacao-copia.ts`; aqui só se busca e grava. As cópias nascem
   * PLANEJADA: o motorista só é avisado quando alguém publicar.
   */
  async copiar(input: CopiarProgramacaoInput, usuarioId: string, escopo: EscopoAdmin) {
    const filtroMotorista = escopo ? { motorista: filtroEscopo(escopo) as Prisma.MotoristaWhereInput } : {};
    const [origem, destino] = await Promise.all([
      this.prisma.viagemPlanejada.findMany({
        where: {
          dataPrevista: diaUtc(input.de),
          status: { notIn: ["CANCELADA", "RECUSADA"] },
          ...filtroMotorista,
        },
        include: INCLUDE,
        orderBy: [{ sequencia: "asc" }, { criadoEm: "asc" }],
      }),
      this.prisma.viagemPlanejada.findMany({
        where: { dataPrevista: diaUtc(input.para), status: { not: "CANCELADA" }, ...filtroMotorista },
        select: { id: true, pedidoId: true, motoristaId: true, veiculoId: true },
      }),
    ]);

    const pedidoIds = [...new Set(origem.map((o) => o.pedidoId).filter((x): x is string => x != null))];
    const [pedidos, saldos] = await Promise.all([
      this.prisma.pedido.findMany({ where: { id: { in: pedidoIds } }, select: { id: true, status: true } }),
      this.pedidos.saldosDe(pedidoIds),
    ]);
    const situacao = new Map(
      pedidos.map((p) => [p.id, { status: p.status, cumprido: saldos.get(p.id)?.situacao === "CUMPRIDO" }]),
    );

    const plano = planejarCopia(origem, destino, situacao);
    const acaoDe = new Map(plano.map((x) => [x.id, x.acao]));
    const itens = origem.map((o) => ({
      origemId: o.id,
      acao: acaoDe.get(o.id)!,
      pedido: o.pedido ? { numero: o.pedido.numero, cliente: o.pedido.cliente?.nome ?? null } : null,
      motorista: o.motorista?.nome ?? null,
      placa: o.veiculo?.placa ?? null,
      janelaInicio: o.janelaInicio,
    }));
    const copiar = origem.filter((o) => acaoDe.get(o.id) === "COPIA");

    if (!input.simular && copiar.length > 0) {
      const para = diaUtc(input.para);
      await this.prisma.$transaction(
        copiar.map((o) =>
          this.prisma.viagemPlanejada.create({
            data: {
              pedidoId: o.pedidoId,
              motoristaId: o.motoristaId,
              veiculoId: o.veiculoId,
              dataPrevista: para,
              janelaInicio: o.janelaInicio,
              janelaFim: o.janelaFim,
              sequencia: o.sequencia,
              observacao: o.observacao,
              criadoPorId: usuarioId,
            },
          }),
        ),
      );
    }
    return { gravado: !input.simular, copiadas: copiar.length, itens };
  }

  async atualizar(id: string, input: AtualizarViagemPlanejadaInput) {
    const atual = await this.prisma.viagemPlanejada.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException("Viagem programada não encontrada");
    // Depois que virou viagem de verdade, o plano é histórico: mexer nele
    // reescreveria o que foi combinado com o motorista e já aconteceu.
    if (atual.viagemId && input.status == null) {
      throw new BadRequestException(
        "Essa programação já virou viagem. Edite a viagem, não o plano.",
      );
    }

    return this.prisma.viagemPlanejada.update({
      where: { id },
      data: {
        ...input,
        ...(input.dataPrevista ? { dataPrevista: diaUtc(input.dataPrevista) } : {}),
      },
      include: INCLUDE,
    });
  }

  async remover(id: string) {
    const p = await this.prisma.viagemPlanejada.findUnique({ where: { id } });
    if (!p) throw new NotFoundException("Viagem programada não encontrada");
    // Já publicada o motorista viu: some da tela dele sem explicação nenhuma se
    // for apagada. Vira CANCELADA, que ele consegue ler.
    if (p.publicadoEm) {
      await this.prisma.viagemPlanejada.update({ where: { id }, data: { status: "CANCELADA" } });
      return { ok: true, cancelada: true };
    }
    await this.prisma.viagemPlanejada.delete({ where: { id } });
    return { ok: true, cancelada: false };
  }

  /**
   * Publica o dia: o motorista passa a ver no app e recebe push.
   *
   * Separado do salvar de propósito — montar o quadro é rascunho, e o supervisor
   * mexe nele a manhã inteira. Publicar é dizer "está combinado".
   */
  async publicar(input: PublicarProgramacaoInput) {
    const data = diaUtc(input.data);
    const where: Prisma.ViagemPlanejadaWhereInput = {
      dataPrevista: data,
      status: "PLANEJADA",
      motoristaId: input.motoristaIds?.length ? { in: input.motoristaIds } : { not: null },
    };

    const alvo = await this.prisma.viagemPlanejada.findMany({
      where,
      select: { id: true, motoristaId: true },
    });
    if (alvo.length === 0) {
      throw new BadRequestException(
        "Nada pra publicar: as viagens desse dia já foram publicadas ou não têm motorista.",
      );
    }

    await this.prisma.viagemPlanejada.updateMany({
      where,
      data: { status: "PUBLICADA", publicadoEm: new Date() },
    });

    // Um push por motorista, não por viagem: quatro viagens programadas não
    // são quatro notificações.
    const porMotorista = new Map<string, number>();
    for (const p of alvo) {
      if (!p.motoristaId) continue;
      porMotorista.set(p.motoristaId, (porMotorista.get(p.motoristaId) ?? 0) + 1);
    }

    const dataBR = `${input.data.slice(8, 10)}/${input.data.slice(5, 7)}`;
    const tokens = await this.prisma.motorista.findMany({
      where: { id: { in: [...porMotorista.keys()] } },
      select: { id: true, expoPushToken: true },
    });

    for (const m of tokens) {
      if (!m.expoPushToken) continue;
      const quantas = porMotorista.get(m.id) ?? 0;
      // `void`: push é aviso, não pode derrubar a publicação — o motorista vê a
      // programação ao abrir o app de qualquer jeito.
      void this.push
        .enviar({
          motoristaId: m.id,
          token: m.expoPushToken,
          titulo: `Sua programação de ${dataBR}`,
          corpo:
            quantas === 1
              ? "Tem 1 viagem programada pra você. Toque pra ver."
              : `Tem ${quantas} viagens programadas pra você. Toque pra ver.`,
          dados: { rota: "programacao", data: input.data },
          tipo: "programacao",
        })
        .catch((e) => this.log.warn(`push de programação falhou: ${(e as Error).message}`));
    }

    return { publicadas: alvo.length, motoristas: porMotorista.size };
  }

  /**
   * Liga a viagem real à programação que ela cumpriu.
   *
   * Chamado quando a viagem nasce. Best-effort e silencioso: não casar não é
   * erro — a maior parte das viagens vai continuar nascendo sem plano nenhum,
   * e obrigar plano pra lançar seria quebrar o app do motorista.
   */
  async casarComViagem(viagemId: string): Promise<void> {
    try {
      const viagem = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: {
          id: true,
          motoristaId: true,
          data: true,
          materialId: true,
          localCargaId: true,
          localDescargaId: true,
          status: true,
        },
      });
      if (!viagem?.data || STATUS_FORA_FECHAMENTO.includes(viagem.status)) return;

      const candidatas = (await this.prisma.viagemPlanejada.findMany({
        where: {
          motoristaId: viagem.motoristaId,
          dataPrevista: viagem.data,
          viagemId: null,
          status: { in: ["PLANEJADA", "PUBLICADA", "ACEITA", "EM_EXECUCAO"] },
        },
        select: {
          id: true,
          motoristaId: true,
          dataPrevista: true,
          pedidoId: true,
          pedido: {
            select: { materialId: true, localCargaId: true, localDescargaId: true },
          },
        },
      })) as Array<PlanejadaParaCasar & { pedidoId: string | null; pedido: unknown }>;

      if (candidatas.length === 0) return;

      // O que a planejada "quer" vem do pedido dela — a planejada em si só tem
      // quem, quando e a ordem no dia.
      const comAlvo: PlanejadaParaCasar[] = candidatas.map((c) => {
        const p = c.pedido as {
          materialId: string | null;
          localCargaId: string | null;
          localDescargaId: string | null;
        } | null;
        return {
          id: c.id,
          motoristaId: c.motoristaId,
          dataPrevista: c.dataPrevista,
          materialId: p?.materialId ?? null,
          localCargaId: p?.localCargaId ?? null,
          localDescargaId: p?.localDescargaId ?? null,
        };
      });

      const escolhida = casarPlanejada(comAlvo, {
        motoristaId: viagem.motoristaId,
        data: viagem.data,
        materialId: viagem.materialId,
        localCargaId: viagem.localCargaId,
        localDescargaId: viagem.localDescargaId,
      });
      if (!escolhida) return;

      await this.prisma.viagemPlanejada.update({
        where: { id: escolhida.id },
        data: { viagemId, status: "CUMPRIDA" },
      });
      const pedidoId = candidatas.find((c) => c.id === escolhida.id)?.pedidoId;
      if (pedidoId) await this.marcarPedidoEmCurso(pedidoId);
    } catch (e) {
      this.log.warn(`casamento de programação falhou (viagem ${viagemId}): ${(e as Error).message}`);
    }
  }

  /**
   * Marca como FURADA o que foi programado e não rodou.
   *
   * Roda de madrugada, olhando o dia anterior. É o dado que ninguém tem hoje:
   * quantas viagens combinadas simplesmente não aconteceram, e de quem.
   */
  async marcarFuradas(diaIso: string): Promise<{ furadas: number }> {
    const r = await this.prisma.viagemPlanejada.updateMany({
      where: {
        dataPrevista: diaUtc(diaIso),
        viagemId: null,
        status: { in: ["PLANEJADA", "PUBLICADA", "ACEITA"] },
      },
      data: { status: "FURADA" },
    });
    return { furadas: r.count };
  }

  /**
   * De madrugada, marca como FURADA o que foi programado ontem e não rodou.
   *
   * É o dado que ninguém tem hoje: quantas viagens combinadas simplesmente não
   * aconteceram, e de quem. Sem isto, a programação vira um quadro que só
   * acumula pendência antiga e ninguém confia.
   *
   * Roda às 4h20 e olha ONTEM — não hoje, que ainda está acontecendo.
   */
  @Cron("0 20 4 * * *", { name: "marcar-programacao-furada", timeZone: "America/Sao_Paulo" })
  async marcarFuradasDeOntem(): Promise<void> {
    try {
      // O dia civil é o de Brasília. Usar `new Date()` cru aqui daria "ontem"
      // errado: o cron roda às 4h20 BR, que já é o dia seguinte em UTC.
      const iso = inicioDiasAtras(1).toISOString().slice(0, 10);

      await comoSistema(async () => {
        const r = await this.marcarFuradas(iso);
        if (r.furadas > 0) {
          this.log.log(`programação de ${iso}: ${r.furadas} viagem(ns) não rodaram`);
        }
      });
    } catch (e) {
      this.log.error(`falha ao marcar programação furada: ${(e as Error).message}`);
    }
  }

  private async proximaSequencia(motoristaId: string | null, data: Date): Promise<number> {
    if (!motoristaId) return 0;
    const ultima = await this.prisma.viagemPlanejada.aggregate({
      where: { motoristaId, dataPrevista: data },
      _max: { sequencia: true },
    });
    return (ultima._max.sequencia ?? -1) + 1;
  }

  private async marcarPedidoEmCurso(pedidoId: string) {
    await this.prisma.pedido.updateMany({
      where: { id: pedidoId, status: "ABERTO" },
      data: { status: "EM_CURSO" },
    });
  }
}
