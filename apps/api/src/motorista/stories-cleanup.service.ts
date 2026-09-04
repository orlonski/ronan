import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { comoSistema } from "../common/conta/conta-context";

/**
 * Limpeza dos stories expirados (24h). O feed já filtra por expiraEm > agora,
 * então nada expirado aparece mesmo se a limpeza atrasar — este job só libera
 * espaço: apaga a foto do MinIO e o registro (cascade remove visualizações e
 * reações). Roda de hora em hora.
 */
@Injectable()
export class StoriesCleanupService {
  private readonly log = new Logger(StoriesCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  @Cron("0 0 * * * *", { name: "limpar-stories", timeZone: "America/Sao_Paulo" })
  async limpar(): Promise<void> {
    // Expurgo por data, igual pra todo mundo: uma passada só.
    await comoSistema(() => this.limparDaVez());
  }

  private async limparDaVez(): Promise<void> {
    const expirados = await this.prisma.story.findMany({
      where: { expiraEm: { lte: new Date() } },
      select: { id: true, storageKey: true, oficial: true },
      take: 500,
    });
    if (expirados.length === 0) return;
    this.log.log(`limpando ${expirados.length} story(ies) expirado(s)`);
    // A foto do story OFICIAL é a mesma foto do aviso no canal, que não expira:
    // apagar o objeto aqui deixaria a bolha do aviso quebrada pra sempre. Some
    // só o story; quem manda no arquivo é a remoção do aviso.
    await Promise.all(
      expirados
        .filter((s) => !s.oficial)
        .map((s) => this.uploads.removeObject(s.storageKey)),
    );
    await this.prisma.story.deleteMany({
      where: { id: { in: expirados.map((s) => s.id) } },
    });
  }
}
