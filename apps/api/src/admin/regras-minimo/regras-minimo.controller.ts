import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarRegraMinimoInput,
  CriarRegraMinimoInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { RegrasMinimoService } from "./regras-minimo.service";

const ListRegrasQuery = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  ativo: z.enum(["true", "false"]).optional(),
});
type ListRegrasQuery = z.infer<typeof ListRegrasQuery>;

@ApiTags("admin/regras-minimo")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/regras-minimo")
export class RegrasMinimoController {
  constructor(private readonly service: RegrasMinimoService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListRegrasQuery)) query: ListRegrasQuery) {
    return this.service.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("regras-minimo.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarRegraMinimoInput)) body: CriarRegraMinimoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("regras-minimo.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarRegraMinimoInput)) body: AtualizarRegraMinimoInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("regras-minimo.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
