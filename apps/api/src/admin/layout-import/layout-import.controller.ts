import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { LayoutImportService } from "./layout-import.service";

const MAX_AMOSTRA_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES_AMOSTRA = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "text/csv",
  "application/pdf",
];

const TIPO_VALUES = ["VIAGEM", "PEDAGIO", "COMBUSTIVEL"] as const;
const TipoSchema = z.enum(TIPO_VALUES);

const SalvarLayoutSchema = z.object({
  tipoBloco: z.enum(["viagens", "pedagios", "outro"]).default("viagens"),
  abaPreferida: z.string().optional(),
  linhaCabecalho: z.number().int().min(1).optional(),
  linhaInicioDados: z.number().int().min(1).optional(),
  colunas: z
    .array(
      z.object({
        letra: z.string().min(1).max(4),
        cabecalho: z.string().max(120),
        campo: z.string().min(1).max(40),
      }),
    )
    .min(1, "Mapeie ao menos uma coluna."),
  observacoes: z.string().max(500).optional(),
});

@ApiTags("admin/layout-import")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/empresas/:empresaId/layout-import")
export class LayoutImportController {
  constructor(private readonly service: LayoutImportService) {}

  /** Lista TODOS os blocos cadastrados pra empresa (até 3: VIAGEM/PEDAGIO/COMBUSTIVEL). */
  @Get()
  list(@Param("empresaId") empresaId: string) {
    return this.service.listarBlocos(empresaId);
  }

  @Get("fechamentos-recentes")
  fechamentosRecentes(@Param("empresaId") empresaId: string) {
    return this.service.fechamentosRecentes(empresaId);
  }

  /**
   * Sobe planilha amostral e roda IA pra sugerir mapeamento.
   * Aceita ?tipo= pra direcionar a IA pro bloco específico.
   */
  @RequerPermissao("empresas.layouts")
  @Post("inferir")
  @UseInterceptors(FileInterceptor("arquivo"))
  async inferir(
    @Param("empresaId") empresaId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Query("tipo") tipoQuery?: string,
  ) {
    if (!arquivo) throw new BadRequestException("Arquivo amostral não enviado");
    const ok =
      ALLOWED_MIMES_AMOSTRA.includes(arquivo.mimetype) ||
      /\.(xlsx|csv|pdf)$/i.test(arquivo.originalname);
    if (!ok) {
      throw new BadRequestException(
        `Tipo não permitido: ${arquivo.mimetype} (${arquivo.originalname}). Use XLSX, CSV ou PDF.`,
      );
    }
    if (arquivo.size > MAX_AMOSTRA_BYTES) {
      throw new BadRequestException("Arquivo maior que 10 MB.");
    }
    const tipo = tipoQuery && (TIPO_VALUES as readonly string[]).includes(tipoQuery)
      ? (tipoQuery as (typeof TIPO_VALUES)[number])
      : undefined;
    return this.service.inferir(
      empresaId,
      {
        buffer: arquivo.buffer,
        nomeOriginal: arquivo.originalname,
        mimetype: arquivo.mimetype,
      },
      tipo,
    );
  }

  /** Salva 1 bloco específico. */
  @RequerPermissao("empresas.layouts")
  @Put(":tipo")
  salvar(
    @Param("empresaId") empresaId: string,
    @Param("tipo") tipoStr: string,
    @Body(new ZodValidationPipe(SalvarLayoutSchema))
    body: z.infer<typeof SalvarLayoutSchema>,
  ) {
    const tipo = TipoSchema.parse(tipoStr);
    return this.service.salvarBloco(empresaId, tipo, body);
  }

  /** Apaga 1 bloco específico. */
  @RequerPermissao("empresas.layouts")
  @Delete(":tipo")
  @HttpCode(204)
  async limpar(
    @Param("empresaId") empresaId: string,
    @Param("tipo") tipoStr: string,
  ) {
    const tipo = TipoSchema.parse(tipoStr);
    await this.service.limparBloco(empresaId, tipo);
  }
}
