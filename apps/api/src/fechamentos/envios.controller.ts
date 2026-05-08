import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ExportFechamentoService } from "./export-fechamento.service";

const CriarEnvioInput = z.object({
  empresaClienteId: z.string().uuid(),
  periodoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  layoutEnvioId: z.string().uuid().optional(),
  // Filtra obras específicas dentro da empresa. Vazio/ausente = todas as obras.
  obraIds: z.array(z.string().uuid()).optional(),
});

const MarcarEnviadoInput = z.object({
  canalEnvio: z.string().min(1).max(50),
  observacao: z.string().max(500).optional(),
});

@ApiTags("admin/envios")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/envios")
export class EnviosController {
  constructor(private readonly exporter: ExportFechamentoService) {}

  @Get()
  list(
    @Query("empresaClienteId") empresaClienteId?: string,
    @Query("status") status?: string,
  ) {
    return this.exporter.listar({
      empresaClienteId,
      status: status as never,
    });
  }

  @Post()
  criar(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(CriarEnvioInput)) body: z.infer<typeof CriarEnvioInput>,
  ) {
    return this.exporter.gerarStandalone({
      usuarioId: user.id,
      empresaClienteId: body.empresaClienteId,
      periodoInicio: body.periodoInicio,
      periodoFim: body.periodoFim,
      layoutEnvioId: body.layoutEnvioId,
      obraIds: body.obraIds,
    });
  }

  @Get(":envioId/download")
  async download(@Param("envioId") envioId: string, @Res() res: Response) {
    const arquivo = await this.exporter.baixar(envioId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${arquivo.nome}"`);
    res.send(arquivo.buffer);
  }

  @Post(":envioId/marcar-enviado")
  marcarEnviado(
    @CurrentUser() user: AuthAdminUser,
    @Param("envioId") envioId: string,
    @Body(new ZodValidationPipe(MarcarEnviadoInput)) body: z.infer<typeof MarcarEnviadoInput>,
  ) {
    return this.exporter.marcarEnviado({
      usuarioId: user.id,
      envioId,
      canalEnvio: body.canalEnvio,
      observacao: body.observacao,
    });
  }

  @Roles("ADMIN")
  @Delete(":envioId")
  @HttpCode(204)
  async excluir(@Param("envioId") envioId: string) {
    await this.exporter.excluir(envioId);
  }
}
