import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AtualizarConfigKmAtipicoInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { KmAtipicoConfigService } from "./km-atipico-config.service";

@ApiTags("admin/km-atipico-config")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/km-atipico-config")
export class KmAtipicoConfigController {
  constructor(private readonly service: KmAtipicoConfigService) {}

  @Roles("ADMIN_USER")
  @Get()
  get() {
    return this.service.get();
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
