import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AtualizarClienteInput, CriarClienteInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ClientesService } from "./clientes.service";

const ListClientesQuery = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  ativa: z.enum(["true", "false"]).optional(),
});
type ListClientesQuery = z.infer<typeof ListClientesQuery>;

@ApiTags("admin/clientes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/clientes")
export class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListClientesQuery)) query: ListClientesQuery) {
    return this.service.list(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(CriarClienteInput)) body: CriarClienteInput) {
    return this.service.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarClienteInput)) body: AtualizarClienteInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
