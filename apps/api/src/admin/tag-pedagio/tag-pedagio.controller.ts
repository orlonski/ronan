import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AceitarSugestoesTagInput,
  ConfigTagInput,
  ConfirmarPracaTagInput,
  DecidirAchadoTagInput,
  DecidirLigacaoTagInput,
  EixosVeiculoInput,
  ImportarFaturaTagInput,
  ResponderCargaTagInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { TagPedagioService } from "./tag-pedagio.service";

const UPLOAD = FileInterceptor("arquivo", { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const CasamentoQuery = z.object({
  placa: z.string().min(5).max(10),
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Conferência da tag de pedágio (módulo `tag-pedagio`). Três chaves:
 * `tag.ver` (olhar), `tag.decidir` (ligar, responder, confirmar praça) e
 * `tag.importar` (subir, desfazer e baixar o PDF — que traz dado bancário).
 */
@ApiTags("admin/tag-pedagio")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/tag-pedagio")
export class TagPedagioController {
  constructor(private readonly service: TagPedagioService) {}

  @RequerPermissao("tag.ver")
  @Get("extratos")
  extratos() {
    return this.service.listarExtratos();
  }

  /** Multipart: `arquivo` (o PDF) + `confirmarCnpj`. Um arquivo por chamada; o painel manda vários em fila. */
  @RequerPermissao("tag.importar")
  @Post("importar")
  @UseInterceptors(UPLOAD)
  importar(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(ImportarFaturaTagInput)) body: ImportarFaturaTagInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.importar(arquivo, body.confirmarCnpj, user);
  }

  @RequerPermissao("tag.importar")
  @Delete("extratos/:id")
  excluir(@Param("id") id: string) {
    return this.service.excluirExtrato(id);
  }

  /** O PDF original, pela API (o bucket nunca tem domínio público). */
  @RequerPermissao("tag.importar")
  @Get("extratos/:id/arquivo")
  async arquivo(@Param("id") id: string, @Res() res: Response) {
    const { buffer, nome } = await this.service.arquivo(id);
    res.set("Content-Type", "application/pdf");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", `inline; filename="${nome.replace(/[^\w.\- ]/g, "_")}"`);
    res.send(buffer);
  }

  @RequerPermissao("tag.ver")
  @Get("extratos/:id/raio-x")
  raioX(@Param("id") id: string) {
    return this.service.raioX(id);
  }

  @RequerPermissao("tag.ver")
  @Get("extratos/:id/contestacao")
  contestacao(@Param("id") id: string) {
    return this.service.contestacao(id);
  }

  @RequerPermissao("tag.ver")
  @Get("contratantes")
  contratantes() {
    return this.service.relatorioContratantes();
  }

  @RequerPermissao("tag.decidir")
  @Post("recalcular")
  recalcular() {
    return this.service.recalcular();
  }

  @RequerPermissao("tag.ver")
  @Get("casamento")
  casamento(@Query(new ZodValidationPipe(CasamentoQuery)) q: z.infer<typeof CasamentoQuery>) {
    return this.service.casamento(q.placa, q.dia);
  }

  @RequerPermissao("tag.decidir")
  @Post("ligacoes")
  decidirLigacao(
    @Body(new ZodValidationPipe(DecidirLigacaoTagInput)) body: DecidirLigacaoTagInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.decidirLigacao(body, user);
  }

  @RequerPermissao("tag.decidir")
  @Post("ligacoes/aceitar")
  aceitar(
    @Body(new ZodValidationPipe(AceitarSugestoesTagInput)) body: AceitarSugestoesTagInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.aceitarSugestoes(body, user);
  }

  @RequerPermissao("tag.decidir")
  @Post("respostas-carga")
  responder(
    @Body(new ZodValidationPipe(ResponderCargaTagInput)) body: ResponderCargaTagInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.responderCarga(body, user);
  }

  @RequerPermissao("tag.decidir")
  @Patch("achados/:id")
  decidirAchado(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DecidirAchadoTagInput)) body: DecidirAchadoTagInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.decidirAchado(id, body, user);
  }

  @RequerPermissao("tag.ver")
  @Get("pracas/fila")
  fila() {
    return this.service.filaPracas();
  }

  @RequerPermissao("tag.decidir")
  @Post("pracas/confirmar")
  confirmarPraca(
    @Body(new ZodValidationPipe(ConfirmarPracaTagInput)) body: ConfirmarPracaTagInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.confirmarPraca(body, user);
  }

  @RequerPermissao("tag.ver")
  @Get("caminhoes")
  caminhoes() {
    return this.service.caminhoes();
  }

  @RequerPermissao("tag.decidir")
  @Patch("caminhoes/:veiculoId/eixos")
  eixos(
    @Param("veiculoId") veiculoId: string,
    @Body(new ZodValidationPipe(EixosVeiculoInput)) body: EixosVeiculoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarEixos(veiculoId, body, user);
  }

  @RequerPermissao("tag.ver")
  @Get("configuracao")
  configuracao() {
    return this.service.configuracao();
  }

  /** Ligar a ligação automática: só a plataforma (checado no serviço, fail-closed). */
  @RequerPermissao("tag.importar")
  @Patch("configuracao")
  salvarConfiguracao(
    @Body(new ZodValidationPipe(ConfigTagInput)) body: ConfigTagInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.salvarConfiguracao(body.ligacaoAutomaticaTag, user);
  }
}
