import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  AssinarDocumentoAppInput,
  AssinarDocumentoInput,
  CriarDocumentoExigidoInput,
} from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser, AuthMotorista } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdmissaoService } from "./admissao.service";

/** O escritório: o que se exige e pra quem se manda o link. */
@ApiTags("admin/admissao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/admissao")
export class AdmissaoAdminController {
  constructor(private readonly service: AdmissaoService) {}

  @RequerPermissao("documentos-exigidos.ver")
  @Get("documentos-exigidos")
  listarExigidos(@Query("empresaId") empresaId?: string) {
    return this.service.listarExigidos(empresaId);
  }

  @RequerPermissao("documentos-exigidos.editar")
  @Post("documentos-exigidos")
  criarExigido(
    @Body(new ZodValidationPipe(CriarDocumentoExigidoInput)) body: CriarDocumentoExigidoInput,
  ) {
    return this.service.criarExigido(body);
  }

  @RequerPermissao("documentos-exigidos.editar")
  @Delete("documentos-exigidos/:id")
  removerExigido(@Param("id") id: string) {
    return this.service.removerExigido(id);
  }

  @RequerPermissao("coletas.ver")
  @Get("coletas")
  listarConvites(@Query("motoristaId") motoristaId: string) {
    return this.service.listarConvites(motoristaId);
  }

  /** Gera o link. Serve ao dono do caminhão e ao próprio motorista. */
  @RequerPermissao("coletas.criar")
  @Post("coletas")
  criarConvite(
    @Body("motoristaId") motoristaId: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    if (!motoristaId) throw new BadRequestException("Diga de qual motorista é a coleta.");
    return this.service.criarConvite(motoristaId, user.id);
  }

  @RequerPermissao("coletas.criar")
  @Post("coletas/:id/revogar")
  revogar(@Param("id") id: string) {
    return this.service.revogarConvite(id);
  }
}

// Limites separados: abrir a página é barato, subir arquivo não. Cota
// compartilhada faria quem manda 6 documentos ser bloqueado no meio.
const limiteAbrir = criarRateLimitIpGuard({ limitePorMinuto: 60, nome: "coleta" });
const limiteEnviar = criarRateLimitIpGuard({ limitePorMinuto: 20, nome: "coleta-envio" });

/**
 * A porta pública da coleta. Abre sem login, e só serve pra ENVIAR.
 *
 * Prefixo próprio (`p/`), longe de `m/*` e de `admin/*`: não é área do
 * motorista logado nem do painel, e misturar faria um guard futuro de `m/*`
 * passar a valer aqui sem ninguém perceber.
 *
 * ⚠️ O `PermissaoGuard` global NÃO olha `@Public()` — um `@RequerPermissao`
 * nesta classe daria 403 em quem abre o link. A autorização aqui é o token,
 * e mais nada.
 *
 * Fora do Swagger de propósito: documentar publicamente uma porta que aceita
 * documento pessoal não ajuda ninguém além de quem procura.
 *
 * Rate limit por IP porque é escrita pública. O teto por link mora no service.
 */
@ApiExcludeController()
@Public()
@Controller("p/coleta")
export class ColetaPublicaController {
  constructor(private readonly service: AdmissaoService) {}

  @UseGuards(limiteAbrir)
  @Get(":token")
  async abrir(@Param("token") token: string, @Req() req: Request) {
    const r = await this.service.paginaPublica(token, ipDaRequisicao(req));
    // Sem indexação: um link com nome de pessoa não pode acabar no Google.
    req.res?.setHeader("X-Robots-Tag", "noindex, nofollow");
    return r;
  }

  @UseGuards(limiteEnviar)
  @Post(":token")
  @UseInterceptors(FileInterceptor("arquivo"))
  async enviar(
    @Param("token") token: string,
    // `exigenciaId` é o caminho normal: é ele que diz QUAL papel está sendo
    // mandado quando dois deles caem na mesma gaveta. O `tipo` continua aceito
    // pra não quebrar uma página aberta há dez minutos, e só vale enquanto for
    // inequívoco — ver `acharExigencia`.
    @Body("exigenciaId") exigenciaId: string | undefined,
    @Body("tipo") tipo: string | undefined,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    if (!arquivo) throw new BadRequestException("Escolha um arquivo.");
    if (!exigenciaId && !tipo) throw new BadRequestException("Diga qual documento é.");
    return this.service.receberArquivo(token, { exigenciaId, tipo }, {
      buffer: arquivo.buffer,
      mimetype: arquivo.mimetype,
      size: arquivo.size,
      originalname: arquivo.originalname,
    });
  }

  /**
   * O aceite eletrônico. Rate-limitado como o envio: é escrita pública.
   *
   * IP e user-agent vão pra trilha — é o que transforma um clique em prova.
   */
  @UseGuards(limiteEnviar)
  @Post(":token/assinar")
  async assinar(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(AssinarDocumentoInput)) body: AssinarDocumentoInput,
    @Req() req: Request,
  ) {
    return this.service.assinarDocumento(
      token,
      { exigenciaId: body.exigenciaId, tipo: body.tipo, nome: body.nome, cpf: body.cpf },
      ipDaRequisicao(req),
      req.headers["user-agent"],
    );
  }
}

/**
 * O que o MOTORISTA vê: o que ainda falta pra ficha dele fechar.
 *
 * SEM `@AcessoMotorista(...)`, pelo mesmo motivo do `m/obra`: isto não é
 * feature em rollout, é o que decide se ele entra na obra. Gatear por flag
 * deixaria alguém sem conseguir ver por que está parado. E como o guard de
 * acesso não roda sem decorator, a checagem de cadastro aprovado é feita aqui
 * na mão (ver CLAUDE.md).
 *
 * Não tem guard de módulo: `ModuloGuard` sai cedo pra quem não é ADMIN_USER.
 * Quem não contratou a admissão simplesmente não tem exigência cadastrada, a
 * lista volta vazia e o app não mostra tela nenhuma — que é o comportamento
 * certo, sem precisar de porteiro.
 */
@ApiTags("motorista/admissao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/admissao")
export class AdmissaoMotoristaController {
  constructor(
    private readonly service: AdmissaoService,
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  private async exigirAprovado(motoristaId: string) {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: { status: true },
    });
    if (m?.status !== "APROVADO") {
      throw new ForbiddenException("Seu cadastro ainda está em análise.");
    }
  }

  /** O que a obra pede, e o que já chegou. */
  @Get("documentos")
  async documentos(@CurrentUser() user: AuthMotorista) {
    await this.exigirAprovado(user.id);
    return this.service.paraOMotorista(user.id);
  }

  /**
   * O arquivo que ele já mandou (ou que o escritório subiu pra ele assinar).
   *
   * Servido inline: o app desenha a imagem na tela. O download carimba que ele
   * VIU o papel, e é isso que dá sentido a assinar depois.
   */
  @Get("documentos/:exigenciaId/arquivo")
  async arquivo(
    @CurrentUser() user: AuthMotorista,
    @Param("exigenciaId") exigenciaId: string,
    @Res() res: Response,
  ) {
    await this.exigirAprovado(user.id);
    const doc = await this.service.arquivoParaMotorista(user.id, exigenciaId);
    const stream = await this.uploads.getObjectStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimetype);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${doc.nomeArquivo.replace(/"/g, "")}"`,
    );
    stream.pipe(res);
  }

  /** Ele mandando a foto do documento. */
  @Post("documentos/:exigenciaId")
  @UseInterceptors(FileInterceptor("arquivo"))
  async enviarDoApp(
    @CurrentUser() user: AuthMotorista,
    @Param("exigenciaId") exigenciaId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    await this.exigirAprovado(user.id);
    if (!arquivo) throw new BadRequestException("Escolha um arquivo.");
    return this.service.receberDoMotorista(user.id, exigenciaId, {
      buffer: arquivo.buffer,
      mimetype: arquivo.mimetype,
      size: arquivo.size,
      originalname: arquivo.originalname,
    });
  }

  /**
   * O aceite, pelo app.
   *
   * IP e user-agent vão pra trilha igual ao link — o que muda é que aqui a
   * sessão já prova quem é, e isso fica registrado como `origem: APP`.
   */
  @Post("documentos/:exigenciaId/assinar")
  async assinarDoApp(
    @CurrentUser() user: AuthMotorista,
    @Param("exigenciaId") exigenciaId: string,
    @Body(new ZodValidationPipe(AssinarDocumentoAppInput)) body: AssinarDocumentoAppInput,
    @Req() req: Request,
  ) {
    await this.exigirAprovado(user.id);
    return this.service.assinarPeloMotorista(
      user.id,
      exigenciaId,
      { nome: body.nome, cpf: body.cpf },
      ipDaRequisicao(req),
      req.headers["user-agent"],
    );
  }
}
