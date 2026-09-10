import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AtualizarPapelInput,
  CriarPapelDoModeloInput,
  CriarPapelInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { PapeisService } from "./papeis.service";

@ApiTags("admin/papeis")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@RequerPermissao("permissoes.gerenciar")
@Controller("admin/papeis")
export class PapeisController {
  constructor(private readonly service: PapeisService) {}

  @Get()
  list() {
    return this.service.list();
  }

  /**
   * Modelos publicados pela plataforma que esta empresa pode copiar.
   *
   * Antes de `:id` de propósito: `@Get(":id")` casaria com "modelos" e mandaria
   * a string pro `findOne`.
   */
  @Get("modelos")
  listarModelos() {
    return this.service.listarModelos();
  }

  /** Cria um papel desta empresa a partir de um modelo. */
  @Post("do-modelo")
  criarDoModelo(
    @Body(new ZodValidationPipe(CriarPapelDoModeloInput)) body: CriarPapelDoModeloInput,
  ) {
    return this.service.criarDoModelo(body);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("permissoes.gerenciar")
  @Post()
  create(@Body(new ZodValidationPipe(CriarPapelInput)) body: CriarPapelInput) {
    return this.service.create(body);
  }

  @RequerPermissao("permissoes.gerenciar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarPapelInput)) body: AtualizarPapelInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("permissoes.gerenciar")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
