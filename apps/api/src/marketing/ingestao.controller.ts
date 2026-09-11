import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiExcludeController } from "@nestjs/swagger";
import { z } from "zod";
import { Public } from "../auth/decorators/public.decorator";
import { comoSistema } from "../common/conta/conta-context";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { UploadsService } from "../uploads/uploads.service";
import { IngestaoTokenGuard } from "./ingestao-token.guard";
import { InstagramConfig } from "./instagram.config";
import { InstagramFilaService } from "./instagram-fila.service";

const IngestaoInput = z.object({
  peca: z.string().trim().min(1).max(120),
  legenda: z.string().trim().min(1).max(2200),
  publicarEm: z.coerce.date().optional(),
});
type IngestaoInput = z.infer<typeof IngestaoInput>;

/**
 * Por onde o `ronan_agente` entrega um post pronto.
 *
 * O agente roda no mesmo servidor e fala com a API pela rede interna do Docker
 * (`ronan-api:3000`), então não há sessão nem usuário: a autenticação é segredo
 * compartilhado, como no webhook do ClickUp.
 *
 * **O que entra aqui ainda não vai pro ar.** Cai na mesma fila do painel, e
 * continua valendo tudo que já vale: o teto diário, o modo sombra, e o
 * interruptor `instagramAtivo`. Um agente que enlouquecer enche a fila — não o
 * feed. E qualquer post pode ser cancelado na tela antes da hora.
 *
 * Fora do Swagger de propósito: documentar publicamente um endpoint que aceita
 * conteúdo pro feed da marca não ajuda ninguém além de quem procura.
 *
 * ATENÇÃO: o `PermissaoGuard` global não olha `@Public()`. Um `@RequerPermissao`
 * nesta classe daria 403 no agente.
 */
@ApiExcludeController()
@Public()
@UseGuards(IngestaoTokenGuard)
@Controller("marketing/instagram/ingestao")
export class IngestaoController {
  constructor(
    private readonly fila: InstagramFilaService,
    private readonly uploads: UploadsService,
    private readonly config: InstagramConfig,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("arte"))
  async receber(
    @UploadedFile() arte: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(IngestaoInput)) body: IngestaoInput,
  ) {
    if (!arte) throw new BadRequestException("Mande a arte no campo `arte`");
    if (!arte.mimetype.includes("jpeg") && !arte.mimetype.includes("jpg")) {
      throw new BadRequestException("A arte precisa ser JPEG — a API do Instagram não aceita PNG");
    }
    if (arte.size > 8 * 1024 * 1024) {
      throw new BadRequestException("A arte passa de 8 MB, que é o teto do Instagram");
    }

    return comoSistema(async () => {
      const storageKey = await this.uploads.putArteInstagram(arte.buffer);
      const post = await this.fila.enfileirar({
        peca: body.peca,
        legenda: body.legenda,
        publicarEm: body.publicarEm ?? null,
        storageKey,
        // Null = veio de automação, não de gente. É o que a tela usa pra
        // mostrar quem agendou.
        criadoPorId: null,
        validadeHoras: this.config.arteValidadeHoras,
      });
      // Devolve o mínimo: o agente não precisa do token da arte nem da chave do
      // storage pra saber que deu certo.
      return { id: post.id, peca: post.peca, status: post.status, publicarEm: post.publicarEm };
    });
  }
}
