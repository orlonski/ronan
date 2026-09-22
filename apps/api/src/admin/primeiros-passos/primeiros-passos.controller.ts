import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { OnboardingService } from "../onboarding/onboarding.service";
import { PrimeirosPassosService } from "./primeiros-passos.service";

/**
 * Sem `@RequerPermissao`: são contagens do que a própria empresa tem, e todo
 * mundo que entra no painel precisa saber por onde começar.
 *
 * A lista, porém, é PODADA pelo que o usuário consegue fazer (ver o service).
 * A ideia antiga — "quem não tem permissão esbarra na trava na hora de criar,
 * que é o lugar certo" — não vale pra um checklist: ali o passo já foi
 * apresentado como o próximo da pessoa, e a trava vira um beco sem saída
 * dizendo "fale com um administrador" pra quem às vezes É o administrador.
 */
@ApiTags("admin/primeiros-passos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/primeiros-passos")
export class PrimeirosPassosController {
  constructor(
    private readonly service: PrimeirosPassosService,
    private readonly onboarding: OnboardingService,
  ) {}

  /**
   * Uma chamada só, porque é a home de quem acabou de entrar.
   *
   * `chegadaDispensada` vem junto de propósito: a tela precisa das duas
   * respostas pra decidir o que mostrar, e duas requisições fariam a chegada
   * piscar enquanto a segunda não voltasse. O resto do shape não mudou.
   */
  @Get()
  async listar(@CurrentUser() user: AuthAdminUser) {
    const [passos, estado] = await Promise.all([
      this.service.listar(user),
      this.onboarding.estado(user.id),
    ]);
    return { ...passos, chegadaDispensada: estado.chegadaDispensada };
  }
}
