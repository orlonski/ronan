import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { comoSistema } from "../common/conta/conta-context";

const RETENCAO_DIAS = 90;

/**
 * Expurgo da telemetria de operação do motorista (EventoMotorista). Guardar tudo
 * pra sempre não faz sentido — 90 dias é folgado pra diagnóstico. Roda 1x/dia de
 * madrugada. Vale pra todos os tipos (viagem_salva, gps_*, nv_* etc).
 */
@Injectable()
export class EventosCleanupService {
  private readonly log = new Logger(EventosCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron("0 30 3 * * *", { name: "expurgar-eventos-motorista", timeZone: "America/Sao_Paulo" })
  async expurgar(): Promise<void> {
    // Expurgo por data, igual pra todo mundo: uma passada só.
    await comoSistema(() => this.expurgarDaVez());
  }

  private async expurgarDaVez(): Promise<void> {
    const corte = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.eventoMotorista.deleteMany({
      where: { recebidoEm: { lt: corte } },
    });
    if (count > 0) {
      this.log.log(`expurgados ${count} evento(s) de telemetria (> ${RETENCAO_DIAS}d)`);
    }
  }
}
