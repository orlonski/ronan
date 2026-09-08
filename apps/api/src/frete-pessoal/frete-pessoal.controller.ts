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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CriarComprovantePessoalInput,
  EstimarFreteInput,
  NavegarPessoalInput,
  SalvarDocumentoPessoalInput,
} from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthIdentidade } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { FretePessoalService } from "./frete-pessoal.service";
import { DocumentosPessoaisService } from "./documentos-pessoais.service";
import { NavegacaoService } from "../roteamento/navegacao.service";

/** 8 MB: foto de documento tirada pelo celular cabe com folga. */
const TAMANHO_MAX = 8 * 1024 * 1024;

/**
 * "Vale a pena esse frete?" e o comprovante do que ele rodou.
 *
 * Sob `m/eu` porque é da PESSOA — vale com ou sem empresa. Ver
 * docs/motorista-sem-empresa.md.
 */
@ApiTags("motorista")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("IDENTIDADE")
@Controller("m/eu/frete")
export class FretePessoalController {
  constructor(
    private readonly service: FretePessoalService,
    private readonly documentos: DocumentosPessoaisService,
    private readonly navegacao: NavegacaoService,
  ) {}

  @HttpCode(200)
  @Post("estimar")
  estimar(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(EstimarFreteInput)) body: EstimarFreteInput,
  ) {
    return this.service.estimar(
      user.id,
      { lat: body.origemLat, lng: body.origemLng },
      { lat: body.destinoLat, lng: body.destinoLng },
    );
  }

  /**
   * Navegação guiada até um ponto — o "tipo Waze" pro frete dele.
   *
   * O caminho da empresa (`m/rotas/navegar`) recebe id de `Local`; aqui o
   * destino é coordenada, que é o que o geocoding devolve. O serviço por baixo
   * é o MESMO (`NavegacaoService.navegar` sempre foi por coordenada — o wrapper
   * por `Local` é que era o atalho).
   */
  @HttpCode(200)
  @Post("navegar")
  navegar(
    @Body(new ZodValidationPipe(NavegarPessoalInput)) body: NavegarPessoalInput,
  ) {
    return this.navegacao.navegar(
      body.origemLat,
      body.origemLng,
      body.destinoLat,
      body.destinoLng,
    );
  }

  @HttpCode(200)
  @Post("comprovante")
  criarComprovante(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(CriarComprovantePessoalInput))
    body: CriarComprovantePessoalInput,
  ) {
    return this.service.criarComprovante(
      user.id,
      body.inicio,
      body.fim,
      body.destinatario,
      body.tipo,
    );
  }

  @Delete("comprovante/:token")
  revogarComprovante(@CurrentUser() user: AuthIdentidade, @Param("token") token: string) {
    return this.service.revogarComprovante(user.id, token);
  }

  // ---- A carteira dele ----

  @Get("documentos")
  documentosDele(@CurrentUser() user: AuthIdentidade) {
    return this.documentos.listar(user.id);
  }

  @HttpCode(200)
  @Post("documentos")
  salvarDocumento(
    @CurrentUser() user: AuthIdentidade,
    @Body(new ZodValidationPipe(SalvarDocumentoPessoalInput)) body: SalvarDocumentoPessoalInput,
  ) {
    return this.documentos.salvar(user.id, body);
  }

  @Put("documentos/:id")
  atualizarDocumento(
    @CurrentUser() user: AuthIdentidade,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SalvarDocumentoPessoalInput)) body: SalvarDocumentoPessoalInput,
  ) {
    return this.documentos.salvar(user.id, body, id);
  }

  @Delete("documentos/:id")
  apagarDocumento(@CurrentUser() user: AuthIdentidade, @Param("id") id: string) {
    return this.documentos.apagar(user.id, id);
  }

  /** A foto/PDF do documento. Fica privada — nunca sai pelo link público. */
  @HttpCode(200)
  @Post("documentos/:id/arquivo")
  @UseInterceptors(FileInterceptor("arquivo", { limits: { fileSize: TAMANHO_MAX } }))
  anexarArquivo(
    @CurrentUser() user: AuthIdentidade,
    @Param("id") id: string,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    if (!arquivo) throw new BadRequestException("Nenhum arquivo enviado.");
    return this.documentos.anexarArquivo(user.id, id, arquivo);
  }

  @Get("documentos/:id/arquivo")
  async baixarArquivo(
    @CurrentUser() user: AuthIdentidade,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { stream, mime, nome } = await this.documentos.arquivo(user.id, id);
    res.setHeader("content-type", mime);
    res.setHeader("content-disposition", `inline; filename="${nome}"`);
    stream.pipe(res);
  }
}

/**
 * A página que o contratante abre — sem cadastro, sem login.
 *
 * `@Public` + prefixo próprio, longe de `m/*`: rota pública que lesse dado de
 * empresa quebraria por falta de conta no contexto (já aconteceu aqui com o
 * comprovante de viagem e a recuperação de senha). Tudo o que esta rota lê é da
 * pessoa, e sai campo a campo.
 */
@ApiTags("publico")
@Controller("publico/comprovante")
export class ComprovantePessoalPublicoController {
  constructor(private readonly service: FretePessoalService) {}

  @Public()
  @Get(":token")
  ver(@Param("token") token: string) {
    return this.service.comprovantePublico(token);
  }
}
