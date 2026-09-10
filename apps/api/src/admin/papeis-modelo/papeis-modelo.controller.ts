import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PapelModeloInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { PapeisModeloService } from "./papeis-modelo.service";

/**
 * Catálogo de papéis-modelo. Atrás do `PlataformaGuard`, junto de contas e
 * roteamento de WhatsApp: publicar um modelo que TODAS as empresas enxergam não
 * é algo que um administrador de empresa possa ganhar por engano na matriz.
 *
 * O outro lado — listar e copiar — mora em `admin/papeis`, com a permissão
 * `permissoes.gerenciar` que o admin de empresa já tem.
 */
@ApiTags("admin/papeis-modelo")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/papeis-modelo")
export class PapeisModeloController {
  constructor(private readonly service: PapeisModeloService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  criar(@Body(new ZodValidationPipe(PapelModeloInput)) body: PapelModeloInput) {
    return this.service.criar(body);
  }

  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(PapelModeloInput)) body: PapelModeloInput,
  ) {
    return this.service.atualizar(id, body);
  }

  @Delete(":id")
  remover(@Param("id") id: string) {
    return this.service.remover(id);
  }
}
