import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SalvarPerfilAcessoInput } from "@ronan/shared-types";
import { z } from "zod";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PerfisAcessoService } from "./perfis-acesso.service";

const AplicarInput = z.object({
  motoristaIds: z.array(z.string().uuid()).min(1).max(500),
});
type AplicarInput = z.infer<typeof AplicarInput>;

/**
 * Os moldes de acesso do app.
 *
 * ⚠️ `aplicar` tem chave própria, separada de `editar`: aplicar reescreve os
 * acessos de até quinhentas pessoas de uma vez, e isso é poder de outra ordem
 * que corrigir o nome do perfil. Quem pode renomear não necessariamente pode
 * mexer no que a frota inteira enxerga no celular.
 */
@ApiTags("admin/perfis-acesso")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/perfis-acesso")
export class PerfisAcessoController {
  constructor(private readonly service: PerfisAcessoService) {}

  @Get()
  @RequerPermissao("perfis-acesso.ver")
  listar() {
    return this.service.listar();
  }

  @Post()
  @RequerPermissao("perfis-acesso.criar")
  criar(@Body(new ZodValidationPipe(SalvarPerfilAcessoInput)) body: SalvarPerfilAcessoInput) {
    return this.service.criar(body);
  }

  @Patch(":id")
  @RequerPermissao("perfis-acesso.editar")
  editar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SalvarPerfilAcessoInput)) body: SalvarPerfilAcessoInput,
  ) {
    return this.service.editar(id, body);
  }

  @Post(":id/aplicar")
  @RequerPermissao("perfis-acesso.aplicar")
  aplicar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AplicarInput)) body: AplicarInput,
  ) {
    return this.service.aplicar(id, body.motoristaIds);
  }

  @Delete(":id")
  @RequerPermissao("perfis-acesso.excluir")
  desligar(@Param("id") id: string) {
    return this.service.desligar(id);
  }
}
