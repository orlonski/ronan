import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { paginationQuerySchema } from "../common/pagination";
import { ExportFechamentoService } from "./export-fechamento.service";
import { FechamentosService } from "./fechamentos.service";

const ListFechamentosQuery = paginationQuerySchema.extend({
  empresaClienteId: z.string().uuid().optional(),
  status: z
    .enum([
      "RECEBIDO",
      "EM_PROCESSAMENTO",
      "AGUARDANDO_REVISAO",
      "CONFERIDO",
      "EXPORTADO",
      "SUBSTITUIDO",
    ])
    .optional(),
  incluirSubstituidos: z.enum(["true", "false"]).optional(),
});
type ListFechamentosQuery = z.infer<typeof ListFechamentosQuery>;

const ResolverLinhaInput = z.object({
  acao: z.enum(["aceitar_sugestao", "escolher_viagem", "erro_cliente", "criar_retroativa"]),
  viagemId: z.string().uuid().optional(),
  motivo: z.string().max(500).optional(),
});

const ExportarInput = z.object({
  layoutEnvioId: z.string().uuid().optional(),
});

const MarcarEnviadoInput = z.object({
  envioId: z.string().uuid(),
  canalEnvio: z.string().min(1).max(50),
  observacao: z.string().max(500).optional(),
});

const ALLOWED_MIMES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/pdf",
];

@ApiTags("admin/fechamentos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/fechamentos")
export class FechamentosController {
  constructor(
    private readonly service: FechamentosService,
    private readonly exporter: ExportFechamentoService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListFechamentosQuery)) query: ListFechamentosQuery) {
    return this.service.list(query);
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  @Get(":id/linhas")
  linhas(
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("tipo") tipo?: string,
  ) {
    return this.service.linhas(id, status, tipo);
  }

  @Post()
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: AuthAdminUser,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body("empresaClienteId") empresaClienteId: string,
    @Body("periodoInicio") periodoInicio: string,
    @Body("periodoFim") periodoFim: string,
    @Body("substituirFechamentoId") substituirFechamentoId?: string,
  ) {
    if (!arquivo) throw new BadRequestException("Arquivo obrigatório");
    if (!ALLOWED_MIMES.includes(arquivo.mimetype) && !/\.(xlsx|csv|pdf)$/i.test(arquivo.originalname)) {
      throw new BadRequestException(`Formato não suportado: ${arquivo.mimetype}`);
    }
    if (!empresaClienteId || !periodoInicio || !periodoFim) {
      throw new BadRequestException("empresaClienteId, periodoInicio, periodoFim são obrigatórios");
    }
    return this.service.upload({
      usuarioId: user.id,
      empresaClienteId,
      periodoInicio,
      periodoFim,
      substituirFechamentoId,
      arquivo: {
        buffer: arquivo.buffer,
        nome: arquivo.originalname,
        mimetype: arquivo.mimetype,
      },
    });
  }

  @Post(":id/reprocessar")
  reprocessar(
    @CurrentUser() user: AuthAdminUser,
    @Param("id") id: string,
    @Query("tipo") tipoStr?: string,
  ) {
    // Se ?tipo=VIAGEM|PEDAGIO|COMBUSTIVEL, reprocessa só esse tipo.
    const tipos = tipoStr && ["VIAGEM", "PEDAGIO", "COMBUSTIVEL"].includes(tipoStr)
      ? [tipoStr as "VIAGEM" | "PEDAGIO" | "COMBUSTIVEL"]
      : undefined;
    return this.service.reprocessar(id, user.id, tipos);
  }

  @Roles("ADMIN")
  @Delete(":id")
  @HttpCode(204)
  async excluir(@Param("id") id: string) {
    await this.service.excluir(id);
  }

  @Post(":id/linhas/:linhaId/resolver")
  resolverLinha(
    @CurrentUser() user: AuthAdminUser,
    @Param("id") id: string,
    @Param("linhaId") linhaId: string,
    @Body(new ZodValidationPipe(ResolverLinhaInput)) body: z.infer<typeof ResolverLinhaInput>,
  ) {
    return this.service.resolverLinha({
      usuarioId: user.id,
      fechamentoId: id,
      linhaId,
      acao: body.acao,
      viagemId: body.viagemId,
      motivo: body.motivo,
    });
  }

  @Post(":id/exportar")
  exportar(
    @CurrentUser() user: AuthAdminUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ExportarInput)) body: z.infer<typeof ExportarInput>,
  ) {
    return this.exporter.gerar({
      usuarioId: user.id,
      fechamentoId: id,
      layoutEnvioId: body.layoutEnvioId,
    });
  }

  @Get(":id/envios/:envioId/download")
  async download(
    @Param("id") id: string,
    @Param("envioId") envioId: string,
    @Res() res: Response,
  ) {
    const arquivo = await this.exporter.baixar(envioId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${arquivo.nome}"`);
    res.send(arquivo.buffer);
  }

  @Post(":id/envios/marcar-enviado")
  marcarEnviado(
    @CurrentUser() user: AuthAdminUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MarcarEnviadoInput)) body: z.infer<typeof MarcarEnviadoInput>,
  ) {
    return this.exporter.marcarEnviado({
      usuarioId: user.id,
      fechamentoId: id,
      envioId: body.envioId,
      canalEnvio: body.canalEnvio,
      observacao: body.observacao,
    });
  }
}
