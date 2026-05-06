import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TrackingConfigService } from "../admin/tracking-config/tracking-config.service";

@ApiTags("motorista/tracking-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/tracking-config")
export class TrackingConfigMotoristaController {
  constructor(private readonly service: TrackingConfigService) {}

  /**
   * Devolve a config global. App cacheia e aplica no próximo
   * "Iniciar viagem com GPS". Mudanças entram em vigor na viagem
   * seguinte (não no meio).
   */
  @Get()
  async get() {
    const cfg = await this.service.get();
    // Não vaza alteradoPor / alteradoEm pro motorista
    return {
      distanciaMinMetros: cfg.distanciaMinMetros,
      intervaloMaxSegundos: cfg.intervaloMaxSegundos,
      precisaoAlta: cfg.precisaoAlta,
      accuracyMaxMetros: cfg.accuracyMaxMetros,
      velocidadeMaxKmh: cfg.velocidadeMaxKmh,
      autoFinalizarHoras: cfg.autoFinalizarHoras,
      detectorAtivado: cfg.detectorAtivado,
      detectorVelocidadeKmh: cfg.detectorVelocidadeKmh,
      detectorLeituras: cfg.detectorLeituras,
    };
  }
}
