import { Controller, Delete, Get, HttpCode, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ListarNotificacoesAdminQuery } from "@ronan/shared-types";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { NotificacoesService } from "./notificacoes.service";

@ApiTags("admin/notificacoes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/notificacoes")
export class NotificacoesAdminController {
  constructor(private readonly service: NotificacoesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListarNotificacoesAdminQuery)) q: ListarNotificacoesAdminQuery,
  ) {
    return this.service.listarAdmin(q);
  }

  @Roles("ADMIN")
  @RequerPermissao("notificacoes.excluir")
  @Delete(":id")
  @HttpCode(204)
  async excluir(@Param("id") id: string) {
    await this.service.excluirAdmin(id);
  }
}
