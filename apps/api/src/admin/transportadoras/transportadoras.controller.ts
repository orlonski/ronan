import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarTransportadoraInput, CriarTransportadoraInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { TransportadorasService } from "./transportadoras.service";

const ListTransportadorasQuery = paginationQuerySchema.extend({
  ativa: z.enum(["true", "false"]).optional(),
});
type ListTransportadorasQuery = z.infer<typeof ListTransportadorasQuery>;

@ApiTags("admin/transportadoras")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@RequerPermissao("transportadoras.ver")
@Controller("admin/transportadoras")
export class TransportadorasController {
  constructor(private readonly service: TransportadorasService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListTransportadorasQuery)) query: ListTransportadorasQuery) {
    return this.service.list(query);
  }

  @Get("nao-classificados")
  naoClassificados() {
    return this.service.naoClassificados();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("transportadoras.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarTransportadoraInput)) body: CriarTransportadoraInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("transportadoras.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarTransportadoraInput)) body: AtualizarTransportadoraInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("transportadoras.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
