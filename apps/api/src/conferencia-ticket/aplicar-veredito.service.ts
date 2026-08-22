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
import { ConferenciaConfig } from "./conferencia.config";
import { resumirConferencia, type ResultadoConferencia } from "../common/conferencia-ticket";

/**
 * O que fazer com o veredito.
 *
 * Quatro regras governam este arquivo, e as quatro existem por motivo caro:
 *
 * 1. **`revisadoEm` só é escrito ao APROVAR, e sempre junto de
 *    `conferidoPorIaEm`.** Preencher `revisadoEm` é o que faz o
 *    FechamentoProcessor preservar a decisão em vez de sobrescrever o status —
 *    exatamente o que se quer numa viagem já conferida. Mas sozinho ele diria
 *    "alguém revisou" sem dizer quem, o que é pior que não aprovar; o segundo
 *    campo é o que deixa a tela falar em voz alta que foi o sistema.
 *    Ao marcar divergência, `revisadoEm` NÃO é tocado: ali a decisão ainda é de
 *    gente. E `revisadoPor` nunca é preenchido — não há User por trás.
 *
 * 2. **Aprovar exige mais certeza que acusar.** Acusar errado incomoda um
 *    motorista honesto, e ele reclama; aprovar errado passa dinheiro errado
 *    adiante e ninguém revisa o que já está aprovado. Por isso a aprovação tem
 *    limiar próprio, mínimo de campos conferidos e nasce desligada.
 *
 * 3. **Só `DIVERGE` chega ao motorista.** `INCERTO` para no painel. Nunca se
 *    cobra alguém na estrada por causa de uma leitura duvidosa.
 *
 * 4. **Modo sombra é o padrão.** Enquanto ele estiver ligado, nada disso é
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
    private readonly config: ConferenciaConfig,
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
    const confianca = (dados.leitura as { confianca?: number })?.confianca ?? 0;
    const acao = modoSombra ? "NENHUMA" : await this.agir(job, resultado, confianca);

    await this.fila.finalizar(job, {
      status: StatusConferenciaTicket.CONCLUIDA,
      veredito: resultado.veredito,
      confianca,
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
  private async agir(
    job: ConferenciaTicket,
    r: ResultadoConferencia,
    confianca: number,
  ): Promise<string> {
    if (r.veredito === "NAO_APLICAVEL") return "NENHUMA";

    if (r.veredito === "BATE") {
      return this.aprovarSeCabivel(job, r, confianca);
    }

    if (r.veredito === "ILEGIVEL") {
      // Aqui o desfecho útil não é chamar um conferente: ele veria a mesma foto
      // borrada. Quem resolve é o motorista, mandando outra — e pra isso o app
      // já tem card pronto e endpoint de resposta há tempos (FOTO_ILEGIVEL),
      // nos dois apps, sem precisar de OTA nem de tela nova.
      await this.pedirFotoNova(job);
      return "PEDIU_FOTO";
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

  /**
   * Aprova a viagem que confere — mesma marca que a conferência humana deixa.
   *
   * `revisadoEm` preenchido é o que faz o FechamentoProcessor preservar a
   * decisão em vez de sobrescrever o status; é o comportamento certo pra uma
   * viagem já conferida. `revisadoPorId` fica nulo, porque não há pessoa por
   * trás, e `conferidoPorIaEm` diz em voz alta quem foi — sem isso a viagem
   * apareceria como revisada e ninguém saberia por quem.
   *
   * Três travas, porque aprovar errado é mais silencioso que acusar errado:
   * leitura tem que estar bem confiante, um número mínimo de campos tem que ter
   * sido realmente conferido, e nada de incerteza pendurada.
   */
  private async aprovarSeCabivel(
    job: ConferenciaTicket,
    r: ResultadoConferencia,
    confianca: number,
  ): Promise<string> {
    if (!this.config.autoAprovar) return "NENHUMA";
    if (confianca < this.config.confiancaParaAprovar) return "NENHUMA";
    if (r.conferidos.length < this.config.minCamposParaAprovar) return "NENHUMA";
    if (r.incertezas.length > 0 || r.divergencias.length > 0) return "NENHUMA";

    const alterou = await this.prisma.viagem.updateMany({
      where: {
        id: job.viagemId,
        // Só toca no que ainda está esperando conferência. Se um humano mexeu
        // no meio, nada acontece.
        status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA] },
        revisadoEm: null,
      },
      data: {
        status: StatusViagem.OK,
        revisadoEm: new Date(),
        conferidoPorIaEm: new Date(),
        motivoStatus: null,
        tipoDivergencia: null,
      },
    });
    if (alterou.count === 0) return "NENHUMA";

    // Fica registrado no chat da viagem: quem abrir depois vê que foi o sistema
    // e com base em quê, sem precisar caçar noutra tela.
    try {
      await this.prisma.viagemMensagem.create({
        data: {
          viagemId: job.viagemId,
          autor: "ADMIN",
          usuarioId: null,
          autorNome: "Conferência automática",
          texto: `Confere com o documento (${r.conferidos.length} campos verificados, leitura ${Math.round(confianca * 100)}%).`,
          acao: "CONFERIU",
        },
      });
    } catch {
      /* o registro no chat é conveniência; a aprovação já está gravada */
    }

    return "APROVOU";
  }

  /**
   * Pede foto nova ao motorista, pelo caminho que ele já conhece.
   *
   * `FOTO_ILEGIVEL` é o único `TipoDivergencia` cujo card existe nos DOIS apps
   * com botão de tirar outra foto, e cujo endpoint de resposta já devolve a
   * viagem pra `AJUSTADA` e avisa o painel. Reusar isso é o que torna este
   * desfecho possível hoje, em vez de virar trabalho de app.
   *
   * A foto nova, quando chega, enfileira conferência nova sozinha — o
   * `adicionarFoto` já faz isso.
   */
  private async pedirFotoNova(job: ConferenciaTicket): Promise<void> {
    const texto =
      "Não consegui ler o ticket dessa viagem pela foto. Dá pra mandar outra, " +
      "com o papel todo no quadro e boa luz?";

    const alterou = await this.prisma.viagem.updateMany({
      where: { id: job.viagemId, status: { in: [StatusViagem.ENVIADA, StatusViagem.AJUSTADA] } },
      data: {
        status: StatusViagem.DIVERGENTE,
        motivoStatus: texto,
        tipoDivergencia: TipoDivergencia.FOTO_ILEGIVEL,
        // Sem revisadoEm: a decisão sobre esta viagem continua pendente.
      },
    });
    if (alterou.count === 0) return;

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
      const viagem = await this.prisma.viagem.findUnique({
        where: { id: job.viagemId },
        select: { motoristaId: true, motorista: { select: { expoPushToken: true } } },
      });
      if (viagem) {
        await this.push.enviar({
          motoristaId: viagem.motoristaId,
          token: viagem.motorista?.expoPushToken ?? "",
          titulo: "Preciso de outra foto do ticket",
          corpo: texto,
          dados: { viagemId: job.viagemId, rota: "foto-ilegivel" },
          tipo: "viagem-divergente",
          criadoPorId: null,
        });
      }
    } catch (err) {
      this.log.warn(`Aviso de foto ilegível falhou: ${(err as Error).message}`);
    }
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
