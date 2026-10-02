import { Controller, Get, NotFoundException, Param, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../../auth/decorators/public.decorator";
import { comConta } from "../../common/conta/conta-context";
import { criarRateLimitIpGuard } from "../../common/rate-limit/rate-limit-ip.guard";
import { AcertoPdfService } from "./acerto-pdf.service";

const limite = criarRateLimitIpGuard({ limitePorMinuto: 30, nome: "acerto-pdf" });

/**
 * O PDF do acerto pelo link ASSINADO (sem login): o parceiro abre no navegador
 * do celular. O token carrega o acerto e a conta, e expira em 30 dias.
 * Sem @RequerPermissao de propósito (daria 403 pra todo mundo — ver
 * compartilhamento-publico.controller).
 */
@ApiExcludeController()
@Public()
@Controller("publico/acertos")
export class AcertoPublicoController {
  constructor(private readonly pdf: AcertoPdfService) {}

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
