import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarMotoristaInput, CriarMotoristaInput, EnviarPushInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { MotoristasService } from "./motoristas.service";

const ListMotoristasQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListMotoristasQuery = z.infer<typeof ListMotoristasQuery>;

const AcessosInput = z.object({
  podeLancarViagem: z.boolean().optional(),
  podeIniciarViagem: z.boolean().optional(),
  podeLancarPedagio: z.boolean().optional(),
  podeLancarAbastecimento: z.boolean().optional(),
  podeUsarOcrTicket: z.boolean().optional(),
});
type AcessosInput = z.infer<typeof AcessosInput>;

@ApiTags("admin/motoristas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/motoristas")
export class MotoristasController {
  constructor(private readonly service: MotoristasService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListMotoristasQuery)) query: ListMotoristasQuery) {
    return this.service.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CriarMotoristaInput)) body: CriarMotoristaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarMotoristaInput)) body: AtualizarMotoristaInput,
  ) {
    return this.service.update(id, body);
  }

  @Patch(":id/acessos")
  atualizarAcessos(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AcessosInput)) body: AcessosInput,
  ) {
    return this.service.atualizarAcessos(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @Post(":id/push")
  enviarPush(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarPushInput)) body: EnviarPushInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.enviarPush(id, body, user.id);
  }
}
