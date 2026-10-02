import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ConectarAsaasInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../auth/types";
import { CobrancaClienteService } from "./cobranca-cliente.service";

/**
 * Cobrança do cliente pelo Asaas da transportadora.
 *
 * Duas chaves, dois poderes: conectar a conta Asaas (`cobranca-asaas.editar`)
 * é dar ao sistema o poder de cobrar no nome da empresa — conversa de dono.
 * Emitir/cancelar o boleto de um título é rotina de escritório e fica com quem
 * fatura (`financeiro.faturar`), como o resto da fatura.
 */
@ApiTags("admin/cobranca-asaas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/cobranca-asaas")
export class CobrancaClienteController {
  constructor(private readonly service: CobrancaClienteService) {}

  @RequerPermissao("cobranca-asaas.ver")
  @Get("conexao")
  conexao() {
    return this.service.resumo();
  }

  /** Só "está conectada?" — o que a lista de títulos precisa pra mostrar o botão. */
  @RequerPermissao("financeiro.ver")
  @Get("situacao")
  situacao() {
    return this.service.situacao();
  }

  @RequerPermissao("cobranca-asaas.editar")
  @Post("conexao")
  conectar(
    @Body(new ZodValidationPipe(ConectarAsaasInput)) body: ConectarAsaasInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.conectar(body, user);
  }

  @RequerPermissao("cobranca-asaas.editar")
  @Post("conexao/webhook")
  reregistrarWebhook(@CurrentUser() user: AuthAdminUser) {
    return this.service.reregistrarWebhook(user);
  }

  @RequerPermissao("cobranca-asaas.editar")
  @Delete("conexao")
  desconectar(@CurrentUser() user: AuthAdminUser) {
    return this.service.desconectar(user.id);
  }

  @RequerPermissao("financeiro.faturar")
  @Post("titulos/:id/cobranca")
  emitir(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.emitir(id, user.id);
  }

  @RequerPermissao("financeiro.faturar")
  @Post("faturas/:id/cobrancas")
  emitirFatura(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.emitirFatura(id, user.id);
  }

  @RequerPermissao("financeiro.faturar")
  @Post("cobrancas/:id/cancelar")
  cancelar(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.cancelar(id, user.id);
  }

  @RequerPermissao("financeiro.faturar")
  @Post("cobrancas/:id/sincronizar")
  sincronizar(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.sincronizar(id);
  }
}
