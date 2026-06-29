import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarEmpresaInput, CriarEmpresaInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { EmpresasService } from "./empresas.service";

const ListEmpresasQuery = paginationQuerySchema.extend({
  ativa: z.enum(["true", "false"]).optional(),
  papel: z.enum(["RECEBE_PLANILHA", "MANDA_FECHAMENTO", "AMBOS"]).optional(),
});
type ListEmpresasQuery = z.infer<typeof ListEmpresasQuery>;

@ApiTags("admin/empresas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/empresas")
export class EmpresasController {
  constructor(private readonly service: EmpresasService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListEmpresasQuery)) query: ListEmpresasQuery) {
    return this.service.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("empresas.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarEmpresaInput)) body: CriarEmpresaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("empresas.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarEmpresaInput)) body: AtualizarEmpresaInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("empresas.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
