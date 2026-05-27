import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarVeiculoInput, CriarVeiculoInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { VeiculosService } from "./veiculos.service";

const ListVeiculosQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListVeiculosQuery = z.infer<typeof ListVeiculosQuery>;

@ApiTags("admin/veiculos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/veiculos")
export class VeiculosController {
  constructor(private readonly service: VeiculosService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListVeiculosQuery)) query: ListVeiculosQuery) {
    return this.service.list(query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CriarVeiculoInput)) body: CriarVeiculoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarVeiculoInput)) body: AtualizarVeiculoInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
