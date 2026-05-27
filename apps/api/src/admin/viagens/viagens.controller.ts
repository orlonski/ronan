import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { AtualizarViagemInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthAdminUser } from "../../auth/types";
import { ViagensAdminService } from "./viagens.service";

const ListViagensQuery = paginationQuerySchema.extend({
  motoristaId: z.string().uuid().optional(),
  veiculoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  status: z
    .enum(["RASCUNHO_OFFLINE", "ENVIADA", "EM_CONFERENCIA", "DIVERGENTE", "AJUSTADA", "OK"])
    .optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type ListViagensQuery = z.infer<typeof ListViagensQuery>;

@ApiTags("admin/viagens")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/viagens")
export class ViagensAdminController {
  constructor(private readonly service: ViagensAdminService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListViagensQuery)) query: ListViagensQuery) {
    return this.service.list(query);
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  @Get(":id/historico")
  historico(@Param("id") id: string) {
    return this.service.historico(id);
  }

  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarViagemInput))
    body: AtualizarViagemInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizar(id, body, user.id);
  }

  @Post(":id/recalcular-trajeto")
  recalcularTrajeto(
    @Param("id") id: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.recalcularTrajeto(id, user.id);
  }

  @Roles("ADMIN")
  @Delete(":id")
  @HttpCode(204)
  async excluir(@Param("id") id: string) {
    await this.service.excluir(id);
  }

  @Get(":id/fotos/:fotoId")
  async foto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.fotoBuffer(id, fotoId);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }
}
