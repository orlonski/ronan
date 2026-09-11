import { Controller, Get, NotFoundException, Param, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { StatusPostInstagram } from "@prisma/client";
import { Public } from "../auth/decorators/public.decorator";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { comoSistema } from "../common/conta/conta-context";
import { UploadsService } from "../uploads/uploads.service";
import { InstagramFilaService } from "./instagram-fila.service";

const limiteArte = criarRateLimitIpGuard({ limitePorMinuto: 60, nome: "arte-instagram" });

/**
 * A arte do post, servida para a API da Meta buscar.
 *
 * Existe porque a Content Publishing API não aceita upload de arquivo para
 * foto: ela faz um GET numa URL pública e baixa a imagem. Como ninguém além da
 * Meta precisa abrir isto, a exposição é a mínima possível — token aleatório de
 * 192 bits, validade curta, sem listagem e sem indexação.
 *
 * **Não** se resolve isto dando domínio público ao MinIO. O bucket nasce com
 * leitura anônima (`mc anonymous set download` no compose de produção), e hoje
 * só está a salvo porque o serviço não tem domínio. Exposto, todo ticket e todo
 * documento de motorista de todas as contas viraria baixável por quem souber a
 * chave — que é previsível.
 *
 * ATENÇÃO: o `PermissaoGuard` global não olha `@Public()`. Um `@RequerPermissao`
 * nesta classe daria 403 pra própria Meta.
 */
@ApiExcludeController()
@Public()
@Controller("publico/marketing/artes")
export class ArtePublicaController {
  constructor(
    private readonly fila: InstagramFilaService,
    private readonly uploads: UploadsService,
  ) {}

  @UseGuards(limiteArte)
  @Get(":token")
  async arte(@Param("token") token: string, @Res() res: Response) {
    // Model global: a trava por conta não tem o que injetar aqui.
    const post = await comoSistema(() => this.fila.porToken(token));

    // 404 seco em tudo que não serve. Não distinguir "não existe" de "expirou"
    // nem de "já publicou": quem chama é um robô da Meta, não uma pessoa que
    // precisa entender o motivo — e a diferença só ajudaria quem sonda.
    const vivo =
      post !== null &&
      post.arteExpiraEm.getTime() > Date.now() &&
      post.status !== StatusPostInstagram.CANCELADO;
    if (!vivo) throw new NotFoundException();

    const buffer = await this.uploads.getObjectBuffer(post.storageKey);
    res.set("Content-Type", "image/jpeg");
    // Cache longo é seguro: a URL carrega um token único e de vida curta.
    res.set("Cache-Control", "public, max-age=3600");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.send(buffer);
  }
}
