import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AtualizarPerfilInput, AtualizarPlacasInput, RegistrarPushTokenInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Roles } from "./decorators/roles.decorator";
import { RolesGuard } from "./guards/roles.guard";
import { EuService } from "./eu.service";
import type { AuthIdentidade } from "./types";

/**
 * O que a PESSOA vê e faz sobre si mesma — vale com ou sem empresa.
 *
 * Prefixo próprio (`m/eu`) e papel próprio (`IDENTIDADE`) porque o token daqui
 * NÃO abre nada de empresa: quem não aceitou convite nenhum não tem dado de
 * transportadora pra ler. As rotas `m/*` continuam exigindo `MOTORISTA`, que é
 * o vínculo. Ver docs/identidade-motorista.md.
 */
@ApiTags("motorista")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("IDENTIDADE")
@Controller("m/eu")
export class EuController {
  constructor(private readonly service: EuService) {}

  @Get()
  perfil(@CurrentUser() user: AuthIdentidade) {
    return this.service.perfil(user.id);
  }

  @Patch()
  atualizar(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(AtualizarPerfilInput)) body: AtualizarPerfilInput,
  ) {
    return this.service.atualizarPerfil(user.id, body);
  }

  @Get("empresas")
  empresas(@CurrentUser() user: AuthIdentidade) {
    return this.service.empresas(user.id);
  }

  @Get("convites")
  convites(@CurrentUser() user: AuthIdentidade) {
    return this.service.convites(user.id);
  }

  @HttpCode(200)
  @Post("convites/:motoristaId/aceitar")
  aceitar(@CurrentUser() user: AuthIdentidade, @Param("motoristaId") motoristaId: string) {
    return this.service.aceitar(user.id, motoristaId);
  }

  @HttpCode(200)
  @Post("convites/:motoristaId/recusar")
  recusar(@CurrentUser() user: AuthIdentidade, @Param("motoristaId") motoristaId: string) {
    return this.service.recusar(user.id, motoristaId);
  }

  @Patch("placas")
  placas(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(AtualizarPlacasInput)) body: AtualizarPlacasInput,
  ) {
    return this.service.atualizarPlacas(user.id, body.placas, body.placaDefault);
  }

  @HttpCode(200)
  @Post("push-token")
  pushToken(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(RegistrarPushTokenInput)) body: RegistrarPushTokenInput,
  ) {
    return this.service.registrarPushToken(user.id, body.token);
  }
}
