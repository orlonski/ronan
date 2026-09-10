import { Body, Controller, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import {
  ConfirmarCadastroContaInput,
  IniciarCadastroContaInput,
  ReenviarCodigoContaInput,
} from "@ronan/shared-types";
import { Public } from "../auth/decorators/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { criarRateLimitIpGuard } from "../common/rate-limit/rate-limit-ip.guard";
import { ipDaRequisicao } from "../common/rate-limit/ip";
import { CadastroContaService } from "./cadastro-conta.service";

// Cada `iniciar` que passa manda uma mensagem de autenticação, que é a mais
// cara do catálogo. O teto por IP é o primeiro freio; o cooldown por telefone,
// no serviço, é o que segura quem troca de IP.
const limiteIniciar = criarRateLimitIpGuard({ limitePorMinuto: 3, nome: "cadastro-conta-iniciar" });
const limiteConfirmar = criarRateLimitIpGuard({
  limitePorMinuto: 10,
  nome: "cadastro-conta-confirmar",
});

/**
 * Auto-cadastro de empresa pelo site.
 *
 * Fora de `admin/*` e `m/*` de propósito — o prefixo `publico/` é a convenção
 * do repo pra rota sem token. E **nenhum `@RequerPermissao` nesta classe**: o
 * `PermissaoGuard` é global e roda mesmo em rota pública, então um decorator de
 * permissão aqui daria 403 pra todo visitante.
 */
@ApiExcludeController()
@Public()
@Controller("publico/cadastro")
export class CadastroContaController {
  constructor(private readonly service: CadastroContaService) {}

  @UseGuards(limiteIniciar)
  @HttpCode(200)
  @Post("iniciar")
  iniciar(
    @Body(new ZodValidationPipe(IniciarCadastroContaInput)) body: IniciarCadastroContaInput,
    @Req() req: Request,
  ) {
    return this.service.iniciar(body, ipDaRequisicao(req));
  }

  @UseGuards(limiteIniciar)
  @HttpCode(200)
  @Post("reenviar")
  reenviar(
    @Body(new ZodValidationPipe(ReenviarCodigoContaInput)) body: ReenviarCodigoContaInput,
  ) {
    return this.service.reenviar(body.telefone);
  }

  @UseGuards(limiteConfirmar)
  @HttpCode(200)
  @Post("confirmar")
  confirmar(
    @Body(new ZodValidationPipe(ConfirmarCadastroContaInput)) body: ConfirmarCadastroContaInput,
  ) {
    return this.service.confirmar(body);
  }
}
