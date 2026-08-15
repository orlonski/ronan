import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarTipoServicoInput, CriarTipoServicoInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { TiposServicoService } from "./tipos-servico.service";

const ListTiposServicoQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListTiposServicoQuery = z.infer<typeof ListTiposServicoQuery>;

@ApiTags("admin/tipos-servico")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
/**
 * Modos de serviço da conta (como a viagem é medida: peso x período/diária).
 * Catálogo compartilhado sem coluna de frota — mesmo tratamento de Materiais:
 * leitura com @IgnoraEscopo + permissão, escrita só pela matriz de papéis.
 */
@Controller("admin/tipos-servico")
export class TiposServicoController {
  constructor(private readonly service: TiposServicoService) {}

  @IgnoraEscopo()
  @RequerPermissao("tipos-servico.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListTiposServicoQuery)) query: ListTiposServicoQuery) {
    return this.service.list(query);
  }

  @IgnoraEscopo()
  @RequerPermissao("tipos-servico.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("tipos-servico.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarTipoServicoInput)) body: CriarTipoServicoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("tipos-servico.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarTipoServicoInput)) body: AtualizarTipoServicoInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("tipos-servico.editar")
  @Post(":id/padrao")
  definirPadrao(@Param("id") id: string) {
    return this.service.definirPadrao(id);
  }

  @RequerPermissao("tipos-servico.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
