import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { AbastecimentosAdminService } from "./abastecimentos.service";

const RotacaoFotoInput = z.object({
  rotacao: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
type RotacaoFotoInput = z.infer<typeof RotacaoFotoInput>;

const ListAbastecimentosQuery = paginationQuerySchema.extend({
  motoristaId: z.string().uuid().optional(),
  veiculoId: z.string().uuid().optional(),
  empresaId: z.string().uuid().optional(),
  semEmpresa: z.enum(["true", "false"]).optional(),
  tipo: z.enum(["DIESEL_S10", "DIESEL_S500", "ARLA_32", "GASOLINA", "ETANOL"]).optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type ListAbastecimentosQuery = z.infer<typeof ListAbastecimentosQuery>;

@ApiTags("admin/abastecimentos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/abastecimentos")
export class AbastecimentosAdminController {
  constructor(private readonly service: AbastecimentosAdminService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListAbastecimentosQuery)) query: ListAbastecimentosQuery) {
    return this.service.list(query);
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
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

  @Patch(":id/fotos/:fotoId")
  rotacionarFoto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Body(new ZodValidationPipe(RotacaoFotoInput)) body: RotacaoFotoInput,
  ) {
    return this.service.rotacionarFoto(id, fotoId, body.rotacao);
  }
}
