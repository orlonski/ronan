import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { BuscaLocaisConfigService } from "../admin/busca-locais-config/busca-locais-config.service";

@ApiTags("motorista/busca-locais-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/busca-locais-config")
export class BuscaLocaisConfigMotoristaController {
  constructor(private readonly service: BuscaLocaisConfigService) {}

  /**
   * Config global da captura de GPS no fluxo "Estou no local de descarga".
   * App cacheia (offline) e aplica na próxima captura. Não vaza alteradoPor.
   */
  @Get()
  async get() {
    const cfg = await this.service.get();
    return {
      gpsAlvoMetros: cfg.gpsAlvoMetros,
      gpsMaxSegundos: cfg.gpsMaxSegundos,
      gpsLimiteSinalFracoM: cfg.gpsLimiteSinalFracoM,
    };
  }
}
