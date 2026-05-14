import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarMotoristaInput, CriarMotoristaInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { MotoristasService } from "./motoristas.service";

const ListMotoristasQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListMotoristasQuery = z.infer<typeof ListMotoristasQuery>;

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
  create(@Body(new ZodValidationPipe(CriarMotoristaInput)) body: CriarMotoristaInput) {
    return this.service.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarMotoristaInput)) body: AtualizarMotoristaInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
