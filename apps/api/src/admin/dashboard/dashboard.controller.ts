import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { DashboardService } from "./dashboard.service";

@ApiTags("admin/dashboard")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/dashboard")
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Roles("ADMIN", "OPERADOR")
  @Get()
  snapshot() {
    return this.service.snapshot();
  }
}
