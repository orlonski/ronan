import { Controller, Get, NotFoundException, Param, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../../auth/decorators/public.decorator";
import { comConta } from "../../common/conta/conta-context";
import { criarRateLimitIpGuard } from "../../common/rate-limit/rate-limit-ip.guard";
import { OrcamentoPdfService } from "./orcamento-pdf.service";

const limite = criarRateLimitIpGuard({ limitePorMinuto: 30, nome: "orcamento-pdf" });

/**
 * O PDF da proposta pelo link ASSINADO (sem login): o cliente abre no celular.
 * O token carrega orçamento + conta e vence em 30 dias. A resposta é só o PDF —
 * nenhum JSON do orçamento sai por aqui, então não há campo pra vazar.
 * Sem @RequerPermissao de propósito (mesmo motivo do acerto-publico).
 */
@ApiExcludeController()
@Public()
@Controller("publico/orcamentos")
export class OrcamentoPublicoController {
  constructor(private readonly pdf: OrcamentoPdfService) {}

  @UseGuards(limite)
  @Get(":token")
  async baixar(@Param("token") token: string, @Res() res: Response) {
    const alvo = this.pdf.lerToken(token);
    if (!alvo) throw new NotFoundException({ code: "LINK_INVALIDO", message: "Link vencido ou inválido." });
    const { buffer, nome } = await comConta(alvo.contaId, () => this.pdf.gerar(alvo.id));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nome}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.send(buffer);
  }
}
