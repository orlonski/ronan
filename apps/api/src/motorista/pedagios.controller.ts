import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CriarPedagioInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { PedagiosMotoristaService } from "./pedagios.service";

@ApiTags("motorista/pedagios")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/pedagios")
export class PedagiosMotoristaController {
  constructor(private readonly service: PedagiosMotoristaService) {}

  @Get()
  list(@CurrentUser() user: AuthMotorista) {
    return this.service.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarPedagioInput)) body: CriarPedagioInput,
  ) {
    return this.service.create(user.id, body);
  }
}
