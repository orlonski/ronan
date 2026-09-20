import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { PagamentoLinkService } from "./pagamento-link.service";

const limite = criarRateLimitIpGuard({ limitePorMinuto: 60, nome: "pagamento-publico" });

/**
 * A página de pagamento da mensalidade, aberta pelo link do WhatsApp — sem
 * login, porque quem paga é o financeiro do cliente e ele não tem conta aqui.
 *
 * ATENÇÃO, igual ao comprovante: o `PermissaoGuard` global não olha `@Public()`.
 * Um `@RequerPermissao` nesta classe daria 403 pra todo mundo, inclusive pro
 * cliente que só quer pagar.
 *
 * O payload é o whitelist de `PagamentoPublico`, nunca a assinatura do painel —
 * ela carrega documento, e-mail, telefone e ids de gateway.
 */
@ApiExcludeController()
@Public()
@Controller("publico/pagar")
export class PagamentoPublicoController {
  constructor(private readonly service: PagamentoLinkService) {}

  @UseGuards(limite)
  @Get(":token")
  async pagamento(@Param("token") token: string, @Res() res: Response) {
    const dados = await this.service.porToken(token);
    res.set("X-Robots-Tag", "noindex, nofollow");
    // Nunca cachear: o código do Pix some quando a autorização é paga, e uma
    // página guardada mostrando "pague aqui" faria o cliente pagar duas vezes.
    res.set("Cache-Control", "no-store");
    res.json(dados);
  }
}
