import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { TranscricaoService } from "../ia/transcricao.service";
import { comoSistema } from "../common/conta/conta-context";

/** Quantos áudios transcrever por passada. Segura o custo de um susto. */
const LOTE = 20;

/**
 * Completa a transcrição de áudios que ficaram sem ela.
 *
 * A transcrição normal roda no envio. Isso deixa dois buracos, e os dois são
 * esperados na vida real:
 *
 * 1. A `OPENAI_API_KEY` ainda não estava configurada. O áudio entrou sem texto
 *    e ficaria assim pra sempre — no dia em que a chave for ligada, o histórico
 *    inteiro continuaria mudo. Este job faz a chave valer retroativamente.
 * 2. O Whisper falhou naquele momento (rede, 5xx, rate limit).
 *
 * Roda de hora em hora e não faz nada quando não há chave — então ligar a
 * chave depois é a única ação necessária; o resto se resolve sozinho.
 *
 * Só pega áudio que ainda TEM arquivo: passada a retenção de 60 dias o
 * `audioKey` vira null e não há mais o que transcrever.
 */
@Injectable()
export class ChatTranscricaoPendenteService {
  private readonly log = new Logger(ChatTranscricaoPendenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly transcricao: TranscricaoService,
  ) {}

  @Cron("0 15 * * * *", { name: "transcrever-audios-pendentes", timeZone: "America/Sao_Paulo" })
  async completar(): Promise<void> {
    // Transcreve áudio que ficou pra trás; não cruza dado entre empresas.
    await comoSistema(() => this.completarDaVez());
  }

  private async completarDaVez(): Promise<void> {
    if (!this.transcricao.configurado) return;

    const pendentes = await this.prisma.mensagemChat.findMany({
      where: {
        tipo: "AUDIO",
        transcricao: null,
        audioKey: { not: null },
        apagadaEm: null,
      },
      select: { id: true, audioKey: true },
      orderBy: { criadoEm: "desc" },
      take: LOTE,
    });
    if (pendentes.length === 0) return;

    this.log.log(`transcrevendo ${pendentes.length} áudio(s) que ficaram pra trás`);
    for (const m of pendentes) {
      try {
        const buffer = await this.uploads.getObjectBuffer(m.audioKey!);
        const ext = m.audioKey!.split(".").pop()?.toLowerCase() ?? "m4a";
        const mimetype =
          ext === "mp3"
            ? "audio/mpeg"
            : ext === "ogg"
              ? "audio/ogg"
              : ext === "webm"
                ? "audio/webm"
                : "audio/m4a";
        const r = await this.transcricao.transcreverBuffer(buffer, mimetype, `audio.${ext}`);
        if (!r.texto) continue; // silêncio/ruído ou falha — tenta de novo na próxima
        await this.prisma.mensagemChat.update({
          where: { id: m.id },
          data: { transcricao: r.texto },
        });
      } catch (e) {
        this.log.warn(`Falha ao transcrever ${m.id}: ${e}`);
      }
    }
  }
}
