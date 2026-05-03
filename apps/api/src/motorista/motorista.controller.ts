import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { MotoristaService } from "./motorista.service";

@ApiTags("motorista")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m")
export class MotoristaController {
  constructor(private readonly service: MotoristaService) {}

  @Get("me")
  me(@CurrentUser() user: AuthMotorista) {
    return this.service.me(user.id);
  }

  @Get("catalogos")
  catalogos(@CurrentUser() user: AuthMotorista) {
    return this.service.catalogos(user.id);
  }
}
