import { Injectable, Logger } from "@nestjs/common";
import {
  Prisma,
  StatusConferenciaTicket,
  StatusViagem,
  TipoDivergencia,
  type ConferenciaTicket,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import { ConferenciaFilaService } from "./conferencia-fila.service";
import { resumirConferencia, type ResultadoConferencia } from "../common/conferencia-ticket";

/**
 * O que fazer com o veredito.
 *
 * Três regras governam este arquivo, e as três existem por motivo caro:
 *
 * 1. **O robô nunca escreve `revisadoEm`/`revisadoPor`.** Esse campo é o que
 *    faz o FechamentoProcessor parar de sobrescrever o status, e exige um User
 *    de verdade. Um robô carimbando ali congela a viagem contra o match e ainda
 *    mente no painel sobre quem revisou. Por isso este serviço reusa as PEÇAS
 *    do `preValidar` (chat + push), nunca o método.
 *
 * 2. **Só `DIVERGE` chega ao motorista.** `INCERTO` para no painel. Nunca se
 *    cobra alguém na estrada por causa de uma leitura duvidosa.
 *
 * 3. **Modo sombra é o padrão.** Enquanto ele estiver ligado, nada disso é
 *    escrito: o veredito é gravado e mais nada. É assim que dá pra comparar o
 *    robô com o conferente humano antes de deixar ele agir.
 */
@Injectable()
export class AplicarVereditoService {
  private readonly log = new Logger("ConferenciaTicket");

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: ConferenciaFilaService,
    private readonly push: PushService,
  ) {}

  async aplicar(
    job: ConferenciaTicket,
    dados: {
      resultado: ResultadoConferencia;
      leitura: unknown;
      custoUsd: number;
      modelo: string;
      passadas: number;
      escalou: boolean;
    },
    modoSombra: boolean,
  ): Promise<void> {
    const { resultado } = dados;
    const acao = modoSombra ? "NENHUMA" : await this.agir(job, resultado);

    await this.fila.finalizar(job, {
      status: StatusConferenciaTicket.CONCLUIDA,
      veredito: resultado.veredito,
      confianca: (dados.leitura as { confianca?: number })?.confianca ?? null,
      leitura: (dados.leitura ?? {}) as Prisma.InputJsonValue,
      divergencias: resultado.divergencias as unknown as Prisma.InputJsonValue,
      incertezas: resultado.incertezas as unknown as Prisma.InputJsonValue,
      modelo: dados.modelo,
      custoUsd: new Prisma.Decimal(dados.custoUsd),
      passadas: dados.passadas,
      escalouEm: dados.escalou ? new Date() : null,
      acao,
      aplicadoEm: acao === "NENHUMA" ? null : new Date(),
    });

    this.log.log(
      JSON.stringify({
        evento: "conferencia",
        viagemId: job.viagemId,
        veredito: resultado.veredito,
        acao,
        divergencias: resultado.divergencias.length,
        incertezas: resultado.incertezas.length,
        custoUsd: dados.custoUsd,
        passadas: dados.passadas,
      }),
    );
  }

  /** Executa o desfecho. Só é chamado fora do modo sombra. */
  private async agir(job: ConferenciaTicket, r: ResultadoConferencia): Promise<string> {
    if (r.veredito === "BATE" || r.veredito === "NAO_APLICAVEL") {
      // De propósito NÃO marca a viagem como OK. Auto-aprovar sem `revisadoEm`
      // faria o FechamentoProcessor sobrescrever o status depois; e escrever
      // `revisadoEm` seria o robô assinando no lugar de um humano. O selo de
      // "conferido pela IA" vem da própria tabela de conferência, no painel.
      return "NENHUMA";
    }

    if (r.veredito === "INCERTO") {
      // Fila de revisão humana: a viagem passa a "Conferindo" (status que os
      // dois apps já sabem exibir e que o painel já filtra) sem incomodar o
      // motorista. `revisadoEm` continua null, então ela não some do contador
      // de "a conferir".
      await this.moverParaConferencia(job.viagemId);
      return "FILA_REVISAO";
    }

    await this.avisarMotorista(job, r);
    return "AVISOU_MOTORISTA";
  }

  private async moverParaConferencia(viagemId: string): Promise<void> {
    try {
      await this.prisma.viagem.updateMany({
        // O `where` de status é a última trava contra corrida: se um humano
        // mexeu entre a leitura e agora, nada acontece.
        where: { id: viagemId, status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA] } },
        data: { status: StatusViagem.EM_CONFERENCIA },
      });
    } catch (err) {
      this.log.warn(`Não consegui mover ${viagemId} pra conferência: ${(err as Error).message}`);
    }
  }

  /**
   * Marca divergente e avisa. Reusa o caminho que o motorista já conhece:
   * status `DIVERGENTE` + `tipoDivergencia` + mensagem no chat da viagem + push.
   *
   * `tipoDivergencia` é `OUTRO` por ora — o motorista corrige editando a viagem
   * normal, e o texto do chat diz exatamente o quê. Um tipo próprio exigiria
   * card novo nos dois apps (e um fallback genérico no nativo, que hoje não
   * tem), o que é trabalho de app, não de servidor.
   */
  private async avisarMotorista(job: ConferenciaTicket, r: ResultadoConferencia): Promise<void> {
    const texto = resumirConferencia(r);

    const alterou = await this.prisma.viagem.updateMany({
      where: { id: job.viagemId, status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA] } },
      data: {
        status: StatusViagem.DIVERGENTE,
        motivoStatus: texto,
        tipoDivergencia: TipoDivergencia.OUTRO,
        // NUNCA revisadoEm/revisadoPor aqui — ver o cabeçalho do arquivo.
      },
    });
    if (alterou.count === 0) {
      this.log.debug(`Viagem ${job.viagemId} mudou antes do aviso; nada foi escrito.`);
      return;
    }

    // O chat é onde o motorista lê o porquê. `usuarioId` nulo é aceito, e o
    // `autorNome` é snapshot — então dá pra assinar como conferência.
    try {
      await this.prisma.viagemMensagem.create({
        data: {
          viagemId: job.viagemId,
          autor: "ADMIN",
          usuarioId: null,
          autorNome: "Conferência automática",
          texto,
          acao: "MARCOU_DIVERGENTE",
        },
      });
    } catch (err) {
      this.log.warn(`Não consegui escrever no chat de ${job.viagemId}: ${(err as Error).message}`);
    }

    try {
      const viagem = await this.prisma.viagem.findUnique({
        where: { id: job.viagemId },
        select: { motoristaId: true, motorista: { select: { expoPushToken: true } } },
      });
      if (!viagem) return;
      await this.push.enviar({
        motoristaId: viagem.motoristaId,
        token: viagem.motorista?.expoPushToken ?? "",
        titulo: "Dá uma conferida nessa viagem",
        // Tom: parceiro autônomo, não funcionário. "Dá uma conferida",
        // nunca "você lançou errado" — quem lê está na estrada e pode estar
        // certo (a leitura é que pode ter falhado).
        corpo: texto,
        dados: { viagemId: job.viagemId, rota: "conferencia-ticket" },
        tipo: "viagem-divergente",
        criadoPorId: null,
      });
    } catch (err) {
      this.log.warn(`Push da conferência falhou: ${(err as Error).message}`);
    }
  }
}
