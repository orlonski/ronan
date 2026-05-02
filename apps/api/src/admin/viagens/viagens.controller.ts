import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ViagensAdminService } from "./viagens.service";

@ApiTags("admin/viagens")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/viagens")
export class ViagensAdminController {
  constructor(private readonly service: ViagensAdminService) {}

  @Get()
  list(
    @Query("motoristaId") motoristaId?: string,
    @Query("veiculoId") veiculoId?: string,
    @Query("obraId") obraId?: string,
    @Query("status") status?: string,
    @Query("de") de?: string,
    @Query("ate") ate?: string,
  ) {
    return this.service.list({
      motoristaId,
      veiculoId,
      obraId,
      status: status as never,
      de,
      ate,
    });
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  @Get(":id/historico")
  historico(@Param("id") id: string) {
    return this.service.historico(id);
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
