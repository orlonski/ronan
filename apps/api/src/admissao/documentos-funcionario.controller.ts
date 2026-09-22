import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { UploadsService } from "../uploads/uploads.service";
import { AdmissaoService } from "./admissao.service";

/**
 * OS DOCUMENTOS DE QUEM É REGISTRADO, do lado do escritório.
 *
 * O registrado sem cadastro de motorista (mecânico, escritório) não tem ficha
 * de motorista, e é lá que moram os documentos de todo mundo. Aqui é a mesma
 * coisa pelo cadastro de funcionário: ver o que chegou, baixar, conferir,
 * devolver com motivo e subir o papel que a empresa emitiu pra ele assinar.
 *
 * Mesma regra de gravação e de conferência das outras portas: o serviço é o
 * mesmo (`AdmissaoService`), só o dono do arquivo muda.
 */
@ApiTags("admin/ponto")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/ponto/funcionarios/:funcionarioId/documentos")
export class DocumentosFuncionarioController {
  constructor(
    private readonly service: AdmissaoService,
    private readonly uploads: UploadsService,
  ) {}

  @RequerPermissao("funcionarios.ver")
  @Get()
  listar(@Param("funcionarioId") funcionarioId: string) {
    return this.service.documentosDoFuncionario(funcionarioId);
  }

  @RequerPermissao("funcionarios.ver")
  @Get(":exigenciaId/download")
  async baixar(
    @Param("funcionarioId") funcionarioId: string,
    @Param("exigenciaId") exigenciaId: string,
    @Res() res: Response,
  ) {
    const doc = await this.service.arquivoDoFuncionario(funcionarioId, exigenciaId);
    const stream = await this.uploads.getObjectStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimetype);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.nomeArquivo.replace(/"/g, "")}"`);
    stream.pipe(res);
  }

  @RequerPermissao("funcionarios.editar")
  @Post(":exigenciaId")
  @UseInterceptors(FileInterceptor("arquivo"))
  subir(
    @Param("funcionarioId") funcionarioId: string,
    @Param("exigenciaId") exigenciaId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    if (!arquivo) throw new BadRequestException("Escolha um arquivo.");
    return this.service.receberDoPainelFuncionario(funcionarioId, exigenciaId, {
      buffer: arquivo.buffer,
      mimetype: arquivo.mimetype,
      size: arquivo.size,
      originalname: arquivo.originalname,
    });
  }

  @RequerPermissao("funcionarios.editar")
  @Post(":exigenciaId/conferir")
  conferir(
    @Param("funcionarioId") funcionarioId: string,
    @Param("exigenciaId") exigenciaId: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.conferirDoDono({ funcionarioId }, exigenciaId, user.id);
  }

  @RequerPermissao("funcionarios.editar")
  @Post(":exigenciaId/recusar")
  recusar(
    @Param("funcionarioId") funcionarioId: string,
    @Param("exigenciaId") exigenciaId: string,
    @Body("motivo") motivo: string | undefined,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.recusarDoDono({ funcionarioId }, exigenciaId, motivo ?? "", user.id);
  }
}
