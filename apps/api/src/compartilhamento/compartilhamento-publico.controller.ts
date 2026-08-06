import { Controller, Get, Param, Req, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { CompartilhamentoService } from "./compartilhamento.service";

// Limites separados de propósito: uma página com 6 fotos gasta 1 hit no
// comprovante e 6 nas imagens; cota compartilhada bloquearia o uso normal.
const limiteComprovante = criarRateLimitIpGuard({ limitePorMinuto: 60, nome: "comprovante" });
const limiteFoto = criarRateLimitIpGuard({ limitePorMinuto: 240, nome: "comprovante-foto" });

/**
 * Superfície pública do comprovante de viagem — o cliente/embarcador abre pelo
 * link do WhatsApp, sem login.
 *
 * ATENÇÃO ao mexer aqui: o `PermissaoGuard` global NÃO olha `@Public()`, ele só
 * é fail-open quando o handler não tem `@RequerPermissao`. Um `@RequerPermissao`
 * nesta classe daria 403 pra todo mundo, inclusive pro cliente.
 *
 * O payload é o whitelist de `viagem-publica.ts`, nunca o detalhe admin.
 */
@ApiExcludeController()
@Public()
@Controller("publico/viagens")
export class CompartilhamentoPublicoController {
  constructor(private readonly service: CompartilhamentoService) {}

  @UseGuards(limiteComprovante)
  @Get(":token")
  async comprovante(
    @Param("token") token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const viagem = await this.service.viagemPorToken(token, ipDaRequisicao(req));
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Cache-Control", "no-store");
    res.json(viagem);
  }

  @UseGuards(limiteFoto)
  @Get(":token/fotos/:fotoId")
  async foto(
    @Param("token") token: string,
    @Param("fotoId") fotoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.fotoPorToken(token, fotoId);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.send(buffer);
  }
}
