import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { TipoCombustivel } from "@prisma/client";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { AbastecimentosAdminService } from "./abastecimentos.service";

@ApiTags("admin/abastecimentos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/abastecimentos")
export class AbastecimentosAdminController {
  constructor(private readonly service: AbastecimentosAdminService) {}

  @Get()
  list(
    @Query("motoristaId") motoristaId?: string,
    @Query("veiculoId") veiculoId?: string,
    @Query("tipo") tipo?: string,
    @Query("de") de?: string,
    @Query("ate") ate?: string,
  ) {
    return this.service.list({
      motoristaId,
      veiculoId,
      tipo: tipo as TipoCombustivel | undefined,
      de,
      ate,
    });
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
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
