import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarRegraSobretaxaInput, CriarRegraSobretaxaInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { SobretaxaCombustivelService } from "./sobretaxa-combustivel.service";

const ListQuery = z.object({ empresaId: z.string().uuid() });
type ListQuery = z.infer<typeof ListQuery>;

/**
 * Sobretaxa de combustível do cliente. É cláusula de preço do contrato, então
 * mora sob as chaves da tabela de preço (`tabelas-preco.*`) e no mesmo módulo
 * contratado: quem pode mexer no preço do cliente pode mexer na sobretaxa, e
 * quem não vê preço também não vê isto.
 */
@ApiTags("admin/sobretaxa-combustivel")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/sobretaxa-combustivel")
export class SobretaxaCombustivelController {
  constructor(private readonly service: SobretaxaCombustivelService) {}

  @RequerPermissao("tabelas-preco.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListQuery)) q: ListQuery) {
    return this.service.list(q.empresaId);
  }

  @RequerPermissao("tabelas-preco.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarRegraSobretaxaInput)) body: CriarRegraSobretaxaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("tabelas-preco.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarRegraSobretaxaInput)) body: AtualizarRegraSobretaxaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.update(id, body, user.id);
  }

  @RequerPermissao("tabelas-preco.excluir")
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.remove(id, user.id);
  }
}
