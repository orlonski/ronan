import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarMaterialInput,
  CriarMaterialInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { MateriaisService } from "./materiais.service";

const ListMateriaisQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListMateriaisQuery = z.infer<typeof ListMateriaisQuery>;

@ApiTags("admin/materiais")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
/**
 * Catálogo compartilhado: não existe coluna de frota aqui — um material é o
 * mesmo pra todo mundo. A LEITURA leva @IgnoraEscopo (não há o que filtrar) +
 * @RequerPermissao — aí é a permissão que decide se o gestor de frota vê a
 * tela, e quem decide é o admin na matriz.
 *
 * A ESCRITA fica de fora de propósito: criar/editar material afeta todas as
 * frotas, então não é operação escopo-neutra e o EscopoGuard barra o restrito
 * mesmo que alguém marque a chave por engano.
 */
@Controller("admin/materiais")
export class MateriaisController {
  constructor(private readonly service: MateriaisService) {}

  @IgnoraEscopo()
  @RequerPermissao("materiais.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListMateriaisQuery)) query: ListMateriaisQuery) {
    return this.service.list(query);
  }

  @IgnoraEscopo()
  @RequerPermissao("materiais.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("materiais.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarMaterialInput)) body: CriarMaterialInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("materiais.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarMaterialInput)) body: AtualizarMaterialInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("materiais.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
