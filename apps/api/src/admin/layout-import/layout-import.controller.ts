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
import { LayoutImportService } from "./layout-import.service";

const MAX_AMOSTRA_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES_AMOSTRA = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "text/csv",
  "application/pdf",
];

const LayoutColumnEnum = z.enum([
  "data",
  "ticket",
  "obra",
  "placa",
  "fornecedor",
  "material",
  "unidade",
  "toneladas",
  "km",
  "valor_unitario",
  "valor_total",
  "praca_pedagio",
  "eixos",
  "ignorar",
]);

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
        campo: LayoutColumnEnum,
      }),
    )
    .min(1, "Mapeie ao menos uma coluna."),
  observacoes: z.string().max(500).optional(),
});

@ApiTags("admin/layout-import")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN", "OPERADOR")
@Controller("admin/empresas/:empresaId/layout-import")
export class LayoutImportController {
  constructor(private readonly service: LayoutImportService) {}

  @Get()
  get(@Param("empresaId") empresaId: string) {
    return this.service.get(empresaId);
  }

  @Get("fechamentos-recentes")
  fechamentosRecentes(@Param("empresaId") empresaId: string) {
    return this.service.fechamentosRecentes(empresaId);
  }

  @Post("inferir")
  @UseInterceptors(FileInterceptor("arquivo"))
  async inferir(
    @Param("empresaId") empresaId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
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
    return this.service.inferir(empresaId, {
      buffer: arquivo.buffer,
      nomeOriginal: arquivo.originalname,
      mimetype: arquivo.mimetype,
    });
  }

  @Put()
  salvar(
    @Param("empresaId") empresaId: string,
    @Body(new ZodValidationPipe(SalvarLayoutSchema))
    body: z.infer<typeof SalvarLayoutSchema>,
  ) {
    return this.service.salvar(empresaId, body);
  }

  @Delete()
  @HttpCode(204)
  async limpar(@Param("empresaId") empresaId: string) {
    await this.service.limpar(empresaId);
  }
}
