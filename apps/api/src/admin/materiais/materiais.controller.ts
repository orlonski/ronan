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
@Controller("admin/materiais")
export class MateriaisController {
  constructor(private readonly service: MateriaisService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListMateriaisQuery)) query: ListMateriaisQuery) {
    return this.service.list(query);
  }

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
