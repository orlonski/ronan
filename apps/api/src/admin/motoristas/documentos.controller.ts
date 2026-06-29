import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import archiver from "archiver";
import type { Response } from "express";
import {
  AtualizarValidadeDocumentoInput,
  TIPOS_DOCUMENTO_MOTORISTA,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../../uploads/uploads.service";
import { MotoristasDocumentosService } from "./documentos.service";

const MIMES_PERMITIDOS = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 25 * 1024 * 1024;

function assertTipo(tipo: string): TipoDocumentoMotorista {
  if (!(TIPOS_DOCUMENTO_MOTORISTA as readonly string[]).includes(tipo)) {
    throw new BadRequestException(`Tipo de documento inválido: ${tipo}`);
  }
  return tipo as TipoDocumentoMotorista;
}

function publicShape(doc: {
  id: string;
  tipo: TipoDocumentoMotorista;
  nomeArquivo: string;
  mimetype: string;
  tamanho: number;
  validade: Date | null;
  criadoEm: Date;
  alteradoEm: Date;
}) {
  // storageKey nunca sai da API — só o controller precisa dele pra servir o arquivo.
  return {
    id: doc.id,
    tipo: doc.tipo,
    nomeArquivo: doc.nomeArquivo,
    mimetype: doc.mimetype,
    tamanho: doc.tamanho,
    validade: doc.validade ? doc.validade.toISOString().slice(0, 10) : null,
    criadoEm: doc.criadoEm.toISOString(),
    alteradoEm: doc.alteradoEm.toISOString(),
  };
}

@ApiTags("admin/motoristas/documentos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/motoristas/:motoristaId/documentos")
export class MotoristasDocumentosController {
  constructor(
    private readonly service: MotoristasDocumentosService,
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  @Get()
  async list(@Param("motoristaId") motoristaId: string) {
    const docs = await this.service.list(motoristaId);
    return docs.map(publicShape);
  }

  @Get("zip")
  async downloadZip(@Param("motoristaId") motoristaId: string, @Res() res: Response) {
    const motorista = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { id: true, nome: true },
    });
    if (!motorista) throw new NotFoundException("Motorista não encontrado");

    const docs = await this.prisma.motoristaDocumento.findMany({
      where: { motoristaId },
      orderBy: { tipo: "asc" },
    });
    if (docs.length === 0) {
      throw new BadRequestException("Nenhum documento anexado pra esse motorista");
    }

    const nomeArquivo = `documentos-${slug(motorista.nome)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => {
      // Encerra a response com erro — o cliente vai ver um download corrompido,
      // mas é melhor do que travar a conexão.
      res.status(500).end(err.message);
    });
    archive.pipe(res);

    for (const doc of docs) {
      try {
        const stream = await this.uploads.getObjectStream(doc.storageKey);
        const nomeNoZip = `${doc.tipo}-${doc.nomeArquivo}`;
        archive.append(stream, { name: nomeNoZip });
      } catch {
        // Arquivo faltando no MinIO — pula em vez de matar o zip todo.
      }
    }

    await archive.finalize();
  }

  @Get(":tipo/download")
  async download(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @Res() res: Response,
  ) {
    const tipo = assertTipo(tipoRaw);
    const doc = await this.service.findOne(motoristaId, tipo);
    const stream = await this.uploads.getObjectStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimetype);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${doc.nomeArquivo.replace(/"/g, "")}"`,
    );
    stream.pipe(res);
  }

  @RequerPermissao("motoristas.documentos")
  @Post(":tipo")
  @UseInterceptors(FileInterceptor("arquivo"))
  async upload(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("validade") validade: string | undefined,
  ) {
    const tipo = assertTipo(tipoRaw);
    if (!file) throw new BadRequestException("Arquivo não enviado");
    if (!MIMES_PERMITIDOS.has(file.mimetype)) {
      throw new BadRequestException(
        `Tipo não permitido: ${file.mimetype}. Use PDF, JPG, PNG ou WebP.`,
      );
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException("Arquivo maior que 25MB");
    }
    const doc = await this.service.upload(motoristaId, tipo, file, validade ?? null);
    return publicShape(doc);
  }

  @RequerPermissao("motoristas.documentos")
  @Patch(":tipo/validade")
  async patchValidade(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
    @Body(new ZodValidationPipe(AtualizarValidadeDocumentoInput))
    body: AtualizarValidadeDocumentoInput,
  ) {
    const tipo = assertTipo(tipoRaw);
    const doc = await this.service.atualizarValidade(motoristaId, tipo, body.validade);
    return publicShape(doc);
  }

  @RequerPermissao("motoristas.documentos")
  @Delete(":tipo")
  async remove(
    @Param("motoristaId") motoristaId: string,
    @Param("tipo") tipoRaw: string,
  ) {
    const tipo = assertTipo(tipoRaw);
    await this.service.remove(motoristaId, tipo);
    return { ok: true };
  }
}

function slug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "motorista";
}
