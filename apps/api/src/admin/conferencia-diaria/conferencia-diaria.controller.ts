import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AtualizarConfigConferenciaDiariaSchema } from "@ronan/shared-types";
import type { AtualizarConfigConferenciaDiaria } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

/**
 * Conferência diária de viagens (Fase 1: só sombra — nada é enviado).
 *
 * O `ModuloGuard` global deriva o módulo (`conferencia`) da permissão de cada
 * handler; por isso todo handler declara `@RequerPermissao`.
 */
@ApiTags("admin/conferencia-diaria")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/conferencia-diaria")
export class ConferenciaDiariaController {
  constructor(private readonly service: ConferenciaDiariaService) {}

  @RequerPermissao("config-conferencia-diaria.ver")
  @Get("config")
  config() {
    return this.service.config();
  }

  @RequerPermissao("config-conferencia-diaria.editar")
  @Put("config")
  atualizarConfig(
    @Body(new ZodValidationPipe(AtualizarConfigConferenciaDiariaSchema))
    body: AtualizarConfigConferenciaDiaria,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizarConfig(body, user.id);
  }

  /** O que o job já registrou hoje: quem seria perguntado e por quê. */
  @RequerPermissao("conferencia-diaria.ver")
  @Get("hoje")
  hoje() {
    return this.service.listaDoDia();
  }

  /** Calcula agora com a regra salva, sem gravar. POST porque é uma execução, não uma leitura. */
  @RequerPermissao("config-conferencia-diaria.editar")
  @HttpCode(200)
  @Post("simular")
  simular() {
    return this.service.simular();
  }
}
