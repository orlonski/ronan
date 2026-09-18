import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AceitarTermoInput, TipoTermoSchema } from "@ronan/shared-types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthAdminUser } from "../auth/types";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TermosService } from "./termos.service";

/**
 * Aceite de termos.
 *
 * POR QUE NÃO FICA EM `admin/*`:
 *
 * O boot-check cobra `@RequerPermissao` em todo endpoint de `admin/*`, e com
 * razão. Mas aceitar um contrato **não pode** ser gateado por permissão: quem
 * não tivesse a chave nunca conseguiria aceitar, e ficaria preso no modal para
 * sempre. Também não é "ação sobre um recurso" — é ato do titular da conta.
 *
 * Por isso mora em `termos/*`, fora do alcance do boot-check por desenho e não
 * por esquecimento. A publicação de versão nova, essa sim, fica em
 * `admin/termos` atrás do `PlataformaGuard` — ver `termos-admin.controller.ts`.
 */
@ApiTags("termos")
@Controller("termos")
export class TermosController {
  constructor(private readonly service: TermosService) {}

  /**
   * A leitura é PÚBLICA, e isso é decisão, não descuido.
   *
   * Contrato que só quem já é cliente consegue ler é contrato que ninguém lê
   * antes de assinar. A tela de cadastro precisa mostrar o texto ANTES do
   * login existir.
   */
  @Public()
  @Get()
  listar(@Query("tipo") tipo?: string) {
    const t = TipoTermoSchema.safeParse(tipo);
    return this.service.listarPublicados(t.success ? t.data : undefined);
  }

  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("status")
  status(@CurrentUser() user: AuthAdminUser) {
    return this.service.status(user.contaId);
  }

  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("recibos")
  recibos(@CurrentUser() user: AuthAdminUser) {
    return this.service.recibos(user.contaId);
  }

  /**
   * Grava o aceite.
   *
   * Repare no que o corpo NÃO traz: nome, e-mail, IP e user agent. Eles vêm do
   * token e da conexão, porque prova que a parte interessada preenche não é
   * prova.
   */
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Post("aceitar")
  aceitar(
    @Body(new ZodValidationPipe(AceitarTermoInput)) body: AceitarTermoInput,
    @CurrentUser() user: AuthAdminUser,
    @Req() req: Request,
  ) {
    return this.service.aceitar({
      contaId: user.contaId,
      termoVersaoId: body.termoVersaoId,
      sha256: body.sha256,
      userId: user.id,
      nome: user.nome,
      email: user.email,
      ip: ipDaRequisicao(req),
      userAgent: req.headers["user-agent"] ?? null,
      origem: "PAINEL",
    });
  }
}
