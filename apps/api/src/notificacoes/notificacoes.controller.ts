import { Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ListarNotificacoesQuery } from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { NotificacoesService } from "./notificacoes.service";

@ApiTags("motorista/notificacoes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/notificacoes")
export class NotificacoesController {
  constructor(private readonly service: NotificacoesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarNotificacoesQuery)) q: ListarNotificacoesQuery,
  ) {
    return this.service.listar(user.id, q);
  }

  // Rota fixa primeiro pra Express não capturar "lidas-todas" no :id abaixo
  @Patch("lidas-todas")
  marcarTodasLidas(@CurrentUser() user: AuthMotorista) {
    return this.service.marcarTodasLidas(user.id);
  }

  @Patch(":id/lida")
  marcarLida(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.marcarLida(user.id, id);
  }
}
