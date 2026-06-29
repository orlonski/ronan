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
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { paginationQuerySchema } from "../common/pagination";
import { ExportFechamentoService } from "./export-fechamento.service";

const ListEnviosQuery = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  status: z.enum(["GERADO", "ENVIADO"]).optional(),
});
type ListEnviosQuery = z.infer<typeof ListEnviosQuery>;

const CriarEnvioInput = z.object({
  empresaId: z.string().uuid(),
  periodoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  layoutEnvioId: z.string().uuid().optional(),
  // Filtra clientes específicos dentro da empresa. Vazio/ausente = todos.
  clienteIds: z.array(z.string().uuid()).optional(),
});

const MarcarEnviadoInput = z.object({
  canalEnvio: z.string().min(1).max(50),
  observacao: z.string().max(500).optional(),
});

@ApiTags("admin/envios")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/envios")
export class EnviosController {
  constructor(private readonly exporter: ExportFechamentoService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListEnviosQuery)) query: ListEnviosQuery) {
    return this.exporter.listar(query);
  }

  @RequerPermissao("envios.criar")
  @Post()
  criar(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(CriarEnvioInput)) body: z.infer<typeof CriarEnvioInput>,
  ) {
    return this.exporter.gerarStandalone({
      usuarioId: user.id,
      empresaId: body.empresaId,
      periodoInicio: body.periodoInicio,
      periodoFim: body.periodoFim,
      layoutEnvioId: body.layoutEnvioId,
      clienteIds: body.clienteIds,
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

  @RequerPermissao("envios.criar")
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

  @Roles("ADMIN_USER")
  @RequerPermissao("envios.excluir")
  @Delete(":envioId")
  @HttpCode(204)
  async excluir(@Param("envioId") envioId: string) {
    await this.exporter.excluir(envioId);
  }
}
