import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";

/** Depois de quantos dias o arquivo de áudio some do MinIO. */
const DIAS_RETENCAO = 60;

/** Quantos apagar por passada — o job roda todo dia, não precisa correr. */
const LOTE = 300;

/**
 * Retenção dos áudios do chat.
 *
 * Áudio pesa muito mais que texto e a conversa nunca é apagada, então sem isso
 * o bucket só cresce. Depois de 60 dias o arquivo sai do MinIO, mas a MENSAGEM
 * fica: a bolha continua na conversa com a transcrição (quando houve), que é o
 * que alguém realmente vai querer reler meses depois. `audioKey` vira null e o
 * app trata como "áudio expirado".
 *
 * Não mexe em mensagem apagada — ali o arquivo já saiu no momento do apagar.
 */
@Injectable()
export class ChatAudioCleanupService {
  private readonly log = new Logger(ChatAudioCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  @Cron("0 30 4 * * *", { name: "limpar-audio-chat", timeZone: "America/Sao_Paulo" })
  async limpar(): Promise<void> {
    const corte = new Date(Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000);
    const antigos = await this.prisma.mensagemChat.findMany({
      where: { tipo: "AUDIO", audioKey: { not: null }, criadoEm: { lt: corte } },
      select: { id: true, audioKey: true },
      take: LOTE,
    });
    if (antigos.length === 0) return;

    this.log.log(`expirando ${antigos.length} áudio(s) do chat com mais de ${DIAS_RETENCAO} dias`);
    await Promise.all(
      antigos.map((m) =>
        this.uploads.removeObject(m.audioKey!).catch(() => {
          /* objeto já pode ter sumido — o update abaixo é o que importa */
        }),
      ),
    );
    await this.prisma.mensagemChat.updateMany({
      where: { id: { in: antigos.map((m) => m.id) } },
      data: { audioKey: null },
    });
  }
}
