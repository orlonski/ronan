import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AnexarEtapaInput,
  DispensarEtapaInput,
  ETAPA_ARQUIVO_MAX_BYTES,
  ReordenarModelosEtapaInput,
  SalvarModeloEtapaInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor, IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { EtapasAdminService } from "./etapas-admin.service";

/**
 * Os formulários de documentos (aba ⚙ "Documentos da viagem", recurso
 * `etapas-viagem`). Catálogo da empresa, sem dado de frota: `@IgnoraEscopo`.
 */
@ApiTags("admin/etapas-modelos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/etapas-modelos")
export class EtapasModelosController {
  constructor(private readonly service: EtapasAdminService) {}

  @RequerPermissao("etapas-viagem.ver")
  @Get()
  listar() {
    return this.service.listarModelos();
  }

  /** Cria já publicado (versão 1). Os modelos prontos chegam por aqui, depois de a pessoa escolher. */
  @RequerPermissao("etapas-viagem.criar")
  @Post()
  criar(
    @Body(new ZodValidationPipe(SalvarModeloEtapaInput)) body: SalvarModeloEtapaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarModelo(body, user.id);
  }

  @RequerPermissao("etapas-viagem.editar")
  @Post("reordenar")
  reordenar(@Body(new ZodValidationPipe(ReordenarModelosEtapaInput)) body: ReordenarModelosEtapaInput) {
    return this.service.reordenar(body.ids);
  }

  /** Mudou o formulário → publica a próxima versão. Desativar = `ativo: false` (nunca apaga). */
  @RequerPermissao("etapas-viagem.editar")
  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SalvarModeloEtapaInput)) body: SalvarModeloEtapaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizarModelo(id, body, user.id);
  }
}

/**
 * A seção "Documentos" da ficha da viagem (recurso `etapas-respostas`). O
 * recorte de frota vem da viagem.
 */
@ApiTags("admin/etapas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/etapas")
export class EtapasViagemAdminController {
  constructor(private readonly service: EtapasAdminService) {}

  @EscopoPor("viagem")
  @RequerPermissao("etapas-respostas.ver")
  @Get("viagem/:viagemId")
  documentos(@Param("viagemId") viagemId: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.documentosDaViagem(viagemId, user.escopo);
  }

  @EscopoPor("viagem")
  @RequerPermissao("etapas-respostas.editar")
  @Post("viagem/:viagemId/dispensar")
  dispensar(
    @Param("viagemId") viagemId: string,
    @Body(new ZodValidationPipe(DispensarEtapaInput)) body: DispensarEtapaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.dispensar(viagemId, body, { id: user.id, nome: user.nome }, user.escopo);
  }

  /** Multipart: `arquivo` + os campos de `AnexarEtapaInput`. */
  @EscopoPor("viagem")
  @RequerPermissao("etapas-respostas.editar")
  @Post("viagem/:viagemId/anexar")
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: ETAPA_ARQUIVO_MAX_BYTES, files: 1 } }))
  anexar(
    @Param("viagemId") viagemId: string,
    @Body(new ZodValidationPipe(AnexarEtapaInput)) body: AnexarEtapaInput,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.anexar(
      viagemId,
      body,
      arquivo && { buffer: arquivo.buffer, mimetype: arquivo.mimetype, size: arquivo.size, originalname: arquivo.originalname },
      { id: user.id, nome: user.nome },
      user.escopo,
    );
  }

  @EscopoPor("viagem")
  @RequerPermissao("etapas-respostas.editar")
  @Post("acoes/:id/desfazer")
  desfazer(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.desfazer(id, { id: user.id, nome: user.nome }, user.escopo);
  }

  /** O arquivo, pela API (o bucket nunca tem domínio público). O painel busca como blob. */
  @EscopoPor("viagem")
  @RequerPermissao("etapas-respostas.ver")
  @Get("arquivos/:id")
  async arquivo(@Param("id") id: string, @CurrentUser() user: AuthAdminUser, @Res() res: Response) {
    const { buffer, contentType, nome } = await this.service.arquivo(id, user.escopo);
    res.set("Content-Type", contentType);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, max-age=3600");
    if (nome) res.set("Content-Disposition", `inline; filename="${nome.replace(/[^\w.\- ]/g, "_")}"`);
    res.send(buffer);
  }
}
