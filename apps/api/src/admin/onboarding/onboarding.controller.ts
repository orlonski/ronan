import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { PermiteSomenteLeitura } from "../../auth/decorators/permite-somente-leitura.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { OnboardingService } from "./onboarding.service";

/** A chave carrega a versão dentro ("home.v1"), por isso é string livre. */
const TourBody = z.object({ chave: z.string().min(1).max(60) });

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
  /**
   * O tour desta rota, já podado pelas permissões de quem pergunta.
   *
   * A rota vem do cliente porque quem sabe onde a pessoa está é o navegador —
   * o App Router não manda isso pro servidor.
   */
  @Get("tour")
  tour(@Query("rota") rota: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.tourDaRota(rota || "/", user);
  }

  /**
   * `@PermiteSomenteLeitura`: marcar um tour como visto é preferência da
   * pessoa sobre a própria tela, não operação da empresa. E quem está em
   * somente leitura também assiste ao tour — ele explica onde ver as coisas,
   * que é justamente o que continua funcionando.
   */
  @PermiteSomenteLeitura()
  @Post("tour/visto")
  @HttpCode(204)
  async tourVisto(
    @Body(new ZodValidationPipe(TourBody)) body: z.infer<typeof TourBody>,
    @CurrentUser() user: AuthAdminUser,
  ): Promise<void> {
    await this.service.marcarTourVisto(user.id, body.chave);
  }

  /** "Rever o passo a passo" — devolve o tour pra quem já tinha visto. */
  @PermiteSomenteLeitura()
  @Post("tour/rever")
  @HttpCode(204)
  async tourRever(
    @Body(new ZodValidationPipe(TourBody)) body: z.infer<typeof TourBody>,
    @CurrentUser() user: AuthAdminUser,
  ): Promise<void> {
    await this.service.esquecerTour(user.id, body.chave);
  }

  /**
   * `@PermiteSomenteLeitura` porque esconder um bloco da própria home é ajuste
   * de sessão, não operação da empresa — e quem está em somente leitura também
   * tem o direito de tirar da frente um convite que não pode mais cumprir.
   */
  @PermiteSomenteLeitura()
  @Post("dispensar")
  @HttpCode(204)
  async dispensar(@CurrentUser() user: AuthAdminUser): Promise<void> {
    await this.service.dispensarChegada(user.id);
  }

  @PermiteSomenteLeitura()
  @Post("quero-continuar")
  @HttpCode(200)
  querorContinuar(@CurrentUser() user: AuthAdminUser) {
    return this.service.quereroContinuar(user.nome);
  }
}
