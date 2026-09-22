import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { PermiteSomenteLeitura } from "../../auth/decorators/permite-somente-leitura.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { OnboardingService } from "./onboarding.service";

/**
 * O que acompanha o usuário novo — e quem está saindo.
 *
 * Sem `@RequerPermissao`, e declarado em `endpoints-sem-permissao.ts`: pedir
 * pra continuar não é uma tela que se compra nem uma ação que se delega. É o
 * próprio usuário dizendo "quero falar com vocês", e gatear isso por chave
 * deixaria mudo justamente quem não tem papel configurado.
 */
@ApiTags("admin/onboarding")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/onboarding")
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  /**
   * `@PermiteSomenteLeitura` é o ponto do endpoint, não um detalhe: ele existe
   * pra ser chamado por quem JÁ está travado. Sem o escape, o pedido de voltar
   * a ser cliente morreria no mesmo guard que bloqueou a pessoa.
   */
  @PermiteSomenteLeitura()
  @Post("quero-continuar")
  @HttpCode(200)
  querorContinuar(@CurrentUser() user: AuthAdminUser) {
    return this.service.quereroContinuar(user.nome);
  }
}
