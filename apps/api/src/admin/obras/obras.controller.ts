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
import { AtualizarObraInput, CriarObraInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ObrasService } from "./obras.service";

const ListObrasQuery = paginationQuerySchema.extend({
  empresaClienteId: z.string().uuid().optional(),
  ativa: z.enum(["true", "false"]).optional(),
});
type ListObrasQuery = z.infer<typeof ListObrasQuery>;

@ApiTags("admin/obras")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/obras")
export class ObrasController {
  constructor(private readonly service: ObrasService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListObrasQuery)) query: ListObrasQuery) {
    return this.service.list(query);
  }

  @Post()
  create(@Body(new ZodValidationPipe(CriarObraInput)) body: CriarObraInput) {
    return this.service.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarObraInput)) body: AtualizarObraInput,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
