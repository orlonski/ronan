import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
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
  EditarDocumentoExigidoInput,
} from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser, AuthFuncionario, AuthMotorista } from "../auth/types";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdmissaoService, type QuemNoApp } from "./admissao.service";
import { RequerCapacidade } from "../common/acesso-app/capacidade.decorator";

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
  @Put("documentos-exigidos/:id")
  editarExigido(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EditarDocumentoExigidoInput)) body: EditarDocumentoExigidoInput,
  ) {
    return this.service.editarExigido(id, body);
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
 * SEM `@AcessoMotorista(...)`: isto não é feature em rollout, é o que decide
 * se ele começa a rodar. Gatear por flag
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
// Registrado em carteira sem cadastro de motorista também manda documento:
// o token dele é o da pessoa, promovido a FUNCIONARIO.
@Roles("MOTORISTA", "FUNCIONARIO")
@Controller("m/admissao")
@RequerCapacidade("app.documentos.enviar")
export class AdmissaoMotoristaController {
  constructor(
    private readonly service: AdmissaoService,
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Quem está pedindo, e de que cadastros. O motorista CLT traz os dois; o
   * registrado sem cadastro de motorista, só o de funcionário.
   *
   * Aprovação é coisa do cadastro de MOTORISTA; o funcionário foi contratado
   * pelo escritório, e é o próprio vínculo ativo que o token já conferiu.
   */
  private async quem(user: AuthMotorista | AuthFuncionario): Promise<QuemNoApp> {
    if (user.kind === "FUNCIONARIO") return { funcionarioId: user.funcionarioId };
    await this.exigirAprovado(user.id);
    return { motoristaId: user.id, funcionarioId: user.funcionarioId ?? null };
  }

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
  async documentos(@CurrentUser() user: AuthMotorista | AuthFuncionario) {
    return this.service.paraOApp(await this.quem(user));
  }

  /**
   * O arquivo que ele já mandou (ou que o escritório subiu pra ele assinar).
   *
   * Servido inline: o app desenha a imagem na tela. O download carimba que ele
   * VIU o papel, e é isso que dá sentido a assinar depois.
   */
  @Get("documentos/:exigenciaId/arquivo")
  async arquivo(
    @CurrentUser() user: AuthMotorista | AuthFuncionario,
    @Param("exigenciaId") exigenciaId: string,
    @Query("mini") mini: string | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.service.arquivoParaApp(await this.quem(user), exigenciaId);

    /**
     * ⚠️ `?mini=1` NÃO é otimização, é o pacote de dados do motorista.
     *
     * A lista desenha 64 pixels por documento. Servir o arquivo inteiro pra
     * isso torrava 15–25 MB do 4G dele só pra abrir uma tela — e quem ganha
     * por viagem paga esse pacote do próprio bolso. A miniatura tem ~15 KB.
     *
     * O cache é agressivo de propósito, e é seguro porque o app manda `?v=` com
     * o hash do arquivo: trocar a foto muda a URL, então nunca se serve a
     * miniatura de um arquivo que não existe mais.
     */
    if (mini) {
      const thumb = await this.uploads.miniatura(
        doc.storageKey,
        doc.mimetype,
        doc.hashArquivo?.slice(0, 12) ?? null,
      );
      if (thumb) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
        res.end(thumb);
        return;
      }
      // Sem miniatura (PDF, ou `sharp` fora do build): cai no original, que
      // continua funcionando. Miniatura que falta gasta dados; erro aqui
      // deixaria a tela sem nada.
    }

    const stream = await this.uploads.getObjectStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimetype);
    res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
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
    @CurrentUser() user: AuthMotorista | AuthFuncionario,
    @Param("exigenciaId") exigenciaId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
  ) {
    const quem = await this.quem(user);
    if (!arquivo) throw new BadRequestException("Escolha um arquivo.");
    return this.service.receberDoApp(quem, exigenciaId, {
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
    @CurrentUser() user: AuthMotorista | AuthFuncionario,
    @Param("exigenciaId") exigenciaId: string,
    @Body(new ZodValidationPipe(AssinarDocumentoAppInput)) body: AssinarDocumentoAppInput,
    @Req() req: Request,
  ) {
    return this.service.assinarPeloApp(
      await this.quem(user),
      exigenciaId,
      { nome: body.nome, cpf: body.cpf },
      ipDaRequisicao(req),
      req.headers["user-agent"],
    );
  }
}
