import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CriarPedagioInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { PedagiosMotoristaService } from "./pedagios.service";

const MesSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve estar no formato YYYY-MM");

const ListarPedagiosQuery = z.object({
  mes: MesSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

@ApiTags("motorista/pedagios")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@Controller("m/pedagios")
export class PedagiosMotoristaController {
  constructor(private readonly service: PedagiosMotoristaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarPedagiosQuery))
    query: z.infer<typeof ListarPedagiosQuery>,
  ) {
    return this.service.list(user.id, query);
  }

  @Post()
  @AcessoMotorista("podeLancarPedagio")
  create(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarPedagioInput)) body: CriarPedagioInput,
  ) {
    return this.service.create(user.id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.delete(user.id, id);
  }
}
