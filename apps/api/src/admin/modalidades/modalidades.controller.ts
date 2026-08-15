import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarModalidadeMotoristaInput,
  CriarModalidadeMotoristaInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { ModalidadesService } from "./modalidades.service";

const ListQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListQuery = z.infer<typeof ListQuery>;

@ApiTags("admin/modalidades")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
/**
 * Modalidades (vínculo) do motorista. Catálogo compartilhado sem coluna de
 * frota — mesmo tratamento de Materiais e Modos de serviço: leitura com
 * @IgnoraEscopo + permissão, escrita pela matriz de papéis.
 */
@Controller("admin/modalidades")
export class ModalidadesController {
  constructor(private readonly service: ModalidadesService) {}

  @IgnoraEscopo()
  @RequerPermissao("modalidades.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListQuery)) query: ListQuery) {
    return this.service.list(query);
  }

  @IgnoraEscopo()
  @RequerPermissao("modalidades.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("modalidades.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarModalidadeMotoristaInput))
    body: CriarModalidadeMotoristaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("modalidades.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarModalidadeMotoristaInput))
    body: AtualizarModalidadeMotoristaInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("modalidades.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
