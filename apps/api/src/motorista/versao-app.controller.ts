import { Controller, Get, Headers, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { VersaoAppResponse } from "@ronan/shared-types";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ForcaAtualizacaoService } from "../admin/forca-atualizacao/forca-atualizacao.service";

@ApiTags("motorista/versao-app")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/versao-app")
export class VersaoAppMotoristaController {
  constructor(private readonly service: ForcaAtualizacaoService) {}

  /**
   * Diz ao app se ele precisa atualizar pela loja. Lê a plataforma/versão dos
   * headers que o app já injeta (x-app-platform / x-app-version). A decisão é
   * fail-safe no backend; o app AINDA faz o próprio fail-open (erro/timeout =
   * nenhuma ação). Chamado no boot e ao voltar do background.
   */
  @Get()
  decidir(
    @CurrentUser() user: AuthMotorista,
    @Headers("x-app-platform") plataforma: string | undefined,
    @Headers("x-app-version") versao: string | undefined,
  ): Promise<VersaoAppResponse> {
    return this.service.decidir(plataforma, versao?.trim() || null, user.id);
  }
}
