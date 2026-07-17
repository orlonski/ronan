import { Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AtualizarConfigKmAtipicoInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { KmAtipicoService } from "../../km-atipico/km-atipico.service";
import { KmAtipicoConfigService } from "./km-atipico-config.service";

@ApiTags("admin/km-atipico-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/km-atipico-config")
export class KmAtipicoConfigController {
  constructor(
    private readonly service: KmAtipicoConfigService,
    private readonly kmAtipico: KmAtipicoService,
  ) {}

  @Roles("ADMIN_USER")
  @Get()
  get() {
    return this.service.get();
  }

  /** Contadores do backfill (quantas viagens ainda faltam avaliar). */
  @Roles("ADMIN_USER")
  @Get("status")
  status() {
    return this.kmAtipico.status();
  }

  /**
   * Reavalia todo o histórico ainda não carimbado (backfill). Fire-and-forget:
   * responde na hora com os contadores e roda em background. Idempotente.
   */
  @Roles("ADMIN_USER")
  @RequerPermissao("config-km-atipico.editar")
  @Post("reavaliar")
  async reavaliar() {
    const antes = await this.kmAtipico.status();
    void this.kmAtipico.reavaliarTudo();
    return { iniciado: true, ...antes };
  }

  @Roles("ADMIN_USER")
  @RequerPermissao("config-km-atipico.editar")
  @Put()
  update(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(AtualizarConfigKmAtipicoInput))
    body: AtualizarConfigKmAtipicoInput,
  ) {
    return this.service.update(body, user.id);
  }
}
