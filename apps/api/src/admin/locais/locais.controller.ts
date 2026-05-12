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
import { CriarLocalInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { LocaisService } from "./locais.service";

const ListLocaisQuery = paginationQuerySchema.extend({
  obraId: z.string().uuid().optional(),
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]).optional(),
  ativo: z.enum(["true", "false"]).optional(),
});
type ListLocaisQuery = z.infer<typeof ListLocaisQuery>;

@ApiTags("admin/locais")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/locais")
export class LocaisController {
  constructor(private readonly service: LocaisService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListLocaisQuery)) query: ListLocaisQuery) {
    return this.service.list(query);
  }

  @Post()
  create(@Body(new ZodValidationPipe(CriarLocalInput)) body: CriarLocalInput) {
    return this.service.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CriarLocalInput.partial())) body: Partial<CriarLocalInput>,
  ) {
    return this.service.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
