import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import {
  ConfirmarCodigoEncarregadoInput,
  PedirCaminhaoInput,
  SolicitarCodigoEncarregadoInput,
} from "@ronan/shared-types";
import { Public } from "../auth/decorators/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { EncarregadoAuthService } from "./encarregado-auth.service";
import { EncarregadoPortalService } from "./encarregado-portal.service";
import { EncarregadoAtual, EncarregadoGuard, type AuthEncarregado } from "./encarregado.guard";

// Limites separados: pedir código custa mensagem paga; conferir é onde se
// chuta; o portal em si é leitura normal (uma tela com 8 fotos gasta 9 hits).
const limiteSolicitar = criarRateLimitIpGuard({ limitePorMinuto: 5, nome: "obra-solicitar" });
const limiteConfirmar = criarRateLimitIpGuard({ limitePorMinuto: 15, nome: "obra-confirmar" });
const limitePortal = criarRateLimitIpGuard({ limitePorMinuto: 240, nome: "obra-portal" });

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");
const ProgramacaoQuery = z.object({ de: DIA.optional(), ate: DIA.optional() });
type ProgramacaoQuery = z.infer<typeof ProgramacaoQuery>;
const TicketsQuery = z.object({ dia: DIA.optional() });
type TicketsQuery = z.infer<typeof TicketsQuery>;

/**
 * O portal da obra (`/obra` no painel), pro encarregado do CLIENTE.
 *
 * `@Public()` porque não é JWT do painel nem do app: quem autentica é o
 * `EncarregadoGuard`, com a sessão opaca do portal. Nenhum handler aqui tem
 * `@RequerPermissao` — o `PermissaoGuard` global daria 403 pra todo mundo (ver
 * a mesma nota no comprovante público).
 */
@ApiExcludeController()
@Public()
@Controller("encarregado")
export class EncarregadoController {
  constructor(
    private readonly auth: EncarregadoAuthService,
    private readonly portal: EncarregadoPortalService,
  ) {}

  @UseGuards(limiteSolicitar)
  @HttpCode(200)
  @Post("auth/solicitar")
  solicitar(
    @Body(new ZodValidationPipe(SolicitarCodigoEncarregadoInput)) body: SolicitarCodigoEncarregadoInput,
  ) {
    return this.auth.solicitar(body.telefone);
  }

  @UseGuards(limiteConfirmar)
  @HttpCode(200)
  @Post("auth/confirmar")
  confirmar(
    @Body(new ZodValidationPipe(ConfirmarCodigoEncarregadoInput)) body: ConfirmarCodigoEncarregadoInput,
  ) {
    return this.auth.confirmar(body.telefone, body.codigo);
  }

  @UseGuards(limitePortal, EncarregadoGuard)
  @HttpCode(200)
  @Post("auth/sair")
  sair(@EncarregadoAtual() enc: AuthEncarregado) {
    return this.auth.sair(enc.sessaoId);
  }

  @UseGuards(limitePortal, EncarregadoGuard)
  @Get("obra")
  obra(@EncarregadoAtual() enc: AuthEncarregado) {
    return this.portal.resumo(enc);
  }

  @UseGuards(limitePortal, EncarregadoGuard)
  @Get("programacao")
  programacao(
    @EncarregadoAtual() enc: AuthEncarregado,
    @Query(new ZodValidationPipe(ProgramacaoQuery)) q: ProgramacaoQuery,
  ) {
    return this.portal.programacao(enc, q.de, q.ate);
  }

  @UseGuards(limitePortal, EncarregadoGuard)
  @HttpCode(200)
  @Post("programacao/:id/aprovar")
  aprovar(@EncarregadoAtual() enc: AuthEncarregado, @Param("id", ParseUUIDPipe) id: string) {
    return this.portal.aprovar(enc, id);
  }

  @UseGuards(limitePortal, EncarregadoGuard)
  @Get("tickets")
  tickets(
    @EncarregadoAtual() enc: AuthEncarregado,
    @Query(new ZodValidationPipe(TicketsQuery)) q: TicketsQuery,
  ) {
    return this.portal.tickets(enc, q.dia);
  }

  @UseGuards(limitePortal, EncarregadoGuard)
  @Get("tickets/:viagemId/fotos/:fotoId")
  async foto(
    @EncarregadoAtual() enc: AuthEncarregado,
    @Param("viagemId", ParseUUIDPipe) viagemId: string,
    @Param("fotoId", ParseUUIDPipe) fotoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.portal.foto(enc, viagemId, fotoId);
    res.set("Content-Type", contentType);
    // `private`: a foto só vale pra quem tem a sessão — proxy no meio não guarda.
    res.set("Cache-Control", "private, max-age=3600");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.send(buffer);
  }

  @UseGuards(limitePortal, EncarregadoGuard)
  @Post("pedidos-caminhao")
  pedirCaminhao(
    @EncarregadoAtual() enc: AuthEncarregado,
    @Body(new ZodValidationPipe(PedirCaminhaoInput)) body: PedirCaminhaoInput,
  ) {
    return this.portal.pedirCaminhao(enc, body);
  }
}
