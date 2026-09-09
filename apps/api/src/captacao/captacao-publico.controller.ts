import { Body, Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { CriarLeadInput, RegistrarEventoSiteInput } from "@ronan/shared-types";
import { Public } from "../auth/decorators/public.decorator";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CaptacaoService } from "./captacao.service";

// O formulário é apertado (gente preenche uma vez, robô tenta mil); o evento é
// folgado porque uma visita normal já dispara pageview + algumas seções vistas.
const limiteLead = criarRateLimitIpGuard({ limitePorMinuto: 5, nome: "captacao-lead" });
const limiteEvento = criarRateLimitIpGuard({ limitePorMinuto: 120, nome: "captacao-evento" });

/**
 * Superfície pública do site institucional (www.movatruck.com.br).
 *
 * ATENÇÃO — as duas armadilhas conhecidas destas rotas:
 *
 *  1. `@Public()` tira o JwtAuthGuard, mas o `PermissaoGuard` global continua
 *     rodando. Ele só é fail-open porque não há `@RequerPermissao` aqui. Um
 *     decorator de permissão nesta classe daria 403 pra todo visitante.
 *  2. Não há conta no contexto: requisição sem token nenhum. Toda escrita passa
 *     por `comoSistema` no service, senão a trava derruba com ContaAusenteError.
 */
@ApiExcludeController()
@Public()
@Controller("publico/captacao")
export class CaptacaoPublicoController {
  constructor(private readonly service: CaptacaoService) {}

  /**
   * Pedido de contato do site.
   *
   * Responde 200 mesmo quando o honeypot pega um robô: o corpo é sempre o
   * mesmo, pra não dar ao robô o sinal de qual campo o denunciou.
   */
  @UseGuards(limiteLead)
  @HttpCode(200)
  @Post("lead")
  async lead(
    @Body(new ZodValidationPipe(CriarLeadInput)) body: CriarLeadInput,
    @Req() req: Request,
  ) {
    await this.service.registrarLead(body, ipDaRequisicao(req));
    return { ok: true };
  }

  /**
   * Contagem anônima de navegação. Responde 204 e nunca falha — analytics não
   * derruba página de visitante.
   */
  @UseGuards(limiteEvento)
  @HttpCode(204)
  @Post("evento")
  async evento(
    @Body(new ZodValidationPipe(RegistrarEventoSiteInput)) body: RegistrarEventoSiteInput,
  ) {
    await this.service.registrarEvento(body);
  }
}
