import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { PrimeirosPassosService } from "./primeiros-passos.service";

/**
 * Sem `@RequerPermissao`: são contagens do que a própria empresa tem, e todo
 * mundo que entra no painel precisa saber por onde começar. Quem não tem
 * permissão pra criar um caminhão vai esbarrar na trava na hora de criar — que
 * é o lugar certo.
 */
@ApiTags("admin/primeiros-passos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/primeiros-passos")
export class PrimeirosPassosController {
  constructor(private readonly service: PrimeirosPassosService) {}

  @Get()
  listar() {
    return this.service.listar();
  }
}
