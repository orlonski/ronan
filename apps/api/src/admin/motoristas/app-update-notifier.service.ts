import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PushService } from "../../push/push.service";

/**
 * Avisa os motoristas, por push, que saiu uma versão nova do app — pra acelerar
 * a adoção (a push é um "abra o app pra instalar"; quem abre, baixa o OTA novo).
 *
 * Sem cron / sem job em background: é disparado pelo PRÓPRIO publish, via o
 * endpoint `POST /app/deploy/nova-versao` (ver AppDeployController), que o comando
 * de publicar chama logo após `eas update`. O backend não roda nada ocioso —
 * só reage a essa chamada.
 */
@Injectable()
export class AppUpdateNotifierService {
  private readonly logger = new Logger(AppUpdateNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Dispara a push pra todos os motoristas ativos com token. Retorna quantos. */
  async notificarTodos(): Promise<number> {
    const alvos = await this.prisma.motorista.findMany({
      where: { ativo: true, expoPushToken: { not: null } },
      select: { id: true, expoPushToken: true },
    });
    if (alvos.length === 0) return 0;

    this.logger.log(`Nova versão publicada — avisando ${alvos.length} motorista(s)`);
    let ok = 0;
    for (const m of alvos) {
      if (!m.expoPushToken) continue;
      try {
        await this.push.enviar({
          motoristaId: m.id,
          token: m.expoPushToken,
          titulo: "Atualização disponível 🚀",
          corpo: "Toque pra abrir o app e instalar a nova versão.",
        });
        ok++;
      } catch {
        // Um token ruim não pode travar os demais.
      }
    }
    return ok;
  }
}
