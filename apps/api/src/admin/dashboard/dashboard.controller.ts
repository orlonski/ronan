import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { DashboardService } from "./dashboard.service";

@ApiTags("admin/dashboard")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/dashboard")
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @EscopoPor("viagem")
  @Roles("ADMIN_USER")
  @RequerPermissao("viagens.ver")
  @Get()
  snapshot(@CurrentUser() user: AuthAdminUser) {
    return this.service.snapshot(user.escopo);
  }
}
