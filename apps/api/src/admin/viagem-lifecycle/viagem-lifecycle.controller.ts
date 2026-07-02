import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AtualizarTipoEventoViagemInput,
  CriarTipoEventoViagemInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { ViagemLifecycleAdminService } from "./viagem-lifecycle.service";

@ApiTags("admin/tipos-evento-viagem")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/tipos-evento-viagem")
export class TiposEventoViagemController {
  constructor(private readonly service: ViagemLifecycleAdminService) {}

  @Get()
  list() {
    return this.service.listarTipos();
  }

  @RequerPermissao("tipos-evento-viagem.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarTipoEventoViagemInput)) body: CriarTipoEventoViagemInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarTipo(body, user.id);
  }

  @RequerPermissao("tipos-evento-viagem.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarTipoEventoViagemInput))
    body: AtualizarTipoEventoViagemInput,
  ) {
    return this.service.atualizarTipo(id, body);
  }

  @RequerPermissao("tipos-evento-viagem.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerTipo(id);
  }
}

/**
 * Viagens em andamento ao vivo (dashboard). Path dedicado pra não colidir com
 * as rotas `admin/viagens/:id`.
 */
@ApiTags("admin/viagens-andamento")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/viagens-andamento")
export class ViagensAndamentoAdminController {
  constructor(private readonly service: ViagemLifecycleAdminService) {}

  @RequerPermissao("viagens.ver")
  @Get()
  list() {
    return this.service.viagensEmAndamento();
  }
}
