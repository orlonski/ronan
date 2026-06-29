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
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { ClientesService } from "./clientes.service";

const ListClientesQuery = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  ativa: z.enum(["true", "false"]).optional(),
});
type ListClientesQuery = z.infer<typeof ListClientesQuery>;

@ApiTags("admin/clientes")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
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

  @RequerPermissao("clientes.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarClienteInput)) body: CriarClienteInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("clientes.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarClienteInput)) body: AtualizarClienteInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("clientes.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
