import { Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { FrotaAdminService } from "./frota.service";

const MapaQuery = z.object({
  /** Janela em minutos pra considerar "ativo". Default 60min. */
  janelaMinutos: z.coerce.number().int().min(1).max(1440).default(60),
});

@ApiTags("admin/frota")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/frota")
export class FrotaAdminController {
  constructor(private readonly service: FrotaAdminService) {}

  @EscopoPor("motorista")
  @RequerPermissao("mapa.ver")
  @Get("mapa")
  mapa(
    @Query(new ZodValidationPipe(MapaQuery)) query: z.infer<typeof MapaQuery>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.mapaFrota(query.janelaMinutos, user.escopo);
  }

  /**
   * Expurga posições > 90 dias. Idempotente. Pode ser chamado por cron
   * externo (Easypanel) ou manualmente pelo admin.
   */
  @RequerPermissao("mapa.expurgar")
  @Post("expurgar-posicoes")
  @HttpCode(200)
  expurgar() {
    return this.service.expurgarAntigas();
  }
}
