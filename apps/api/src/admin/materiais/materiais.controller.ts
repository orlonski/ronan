import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarMaterialInput,
  CriarMaterialInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { MateriaisService } from "./materiais.service";

const ListMateriaisQuery = paginationQuerySchema.extend({
  ativo: z.enum(["true", "false"]).optional(),
});
type ListMateriaisQuery = z.infer<typeof ListMateriaisQuery>;

@ApiTags("admin/materiais")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
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

  @Post()
  create(@Body(new ZodValidationPipe(CriarMaterialInput)) body: CriarMaterialInput) {
    return this.service.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarMaterialInput)) body: AtualizarMaterialInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
