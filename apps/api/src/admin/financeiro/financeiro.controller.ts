import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarFaturaInput,
  CancelarTituloPagarInput,
  CriarTituloPagarInput,
  DarBaixaInput,
  GerarFaturaInput,
  STATUS_FATURA,
  STATUS_TITULO,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { FinanceiroService } from "./financeiro.service";

const ListFaturas = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  status: z.enum(STATUS_FATURA).optional(),
});
const ListTitulos = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  status: z.enum(STATUS_TITULO).optional(),
  vencidos: z.enum(["true", "false"]).optional(),
});

/**
 * Contas a receber, a pagar e as faturas.
 *
 * Todos os handlers declaram permissão — o dado financeiro é o mais sensível do
 * painel, e o `PermissaoGuard` é fail-open. `baixar` é chave separada porque
 * dizer que o dinheiro entrou é decisão de quem responde pelo caixa.
 */
@ApiTags("admin/financeiro")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/financeiro")
export class FinanceiroController {
  constructor(private readonly service: FinanceiroService) {}

  @RequerPermissao("financeiro.ver")
  @Get("resumo")
  resumo() {
    return this.service.resumo();
  }

  @RequerPermissao("financeiro.ver")
  @Get("faturas")
  listFaturas(@Query(new ZodValidationPipe(ListFaturas)) q: z.infer<typeof ListFaturas>) {
    return this.service.listFaturas(q);
  }

  @RequerPermissao("financeiro.ver")
  @Get("faturas/:id")
  detalheFatura(@Param("id") id: string) {
    return this.service.detalheFatura(id);
  }

  @RequerPermissao("financeiro.faturar")
  @Post("faturas")
  gerarFatura(
    @Body(new ZodValidationPipe(GerarFaturaInput)) body: GerarFaturaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.gerarFatura(body, user.id);
  }

  @RequerPermissao("financeiro.faturar")
  @Patch("faturas/:id")
  atualizarFatura(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarFaturaInput)) body: AtualizarFaturaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizarFatura(id, body, user.id);
  }

  @RequerPermissao("financeiro.ver")
  @Get("receber")
  listReceber(@Query(new ZodValidationPipe(ListTitulos)) q: z.infer<typeof ListTitulos>) {
    return this.service.listReceber(q);
  }

  @RequerPermissao("financeiro.baixar")
  @Post("receber/:id/baixa")
  baixarReceber(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DarBaixaInput)) body: DarBaixaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.darBaixa("receber", id, body, user.id);
  }

  @RequerPermissao("financeiro.ver")
  @Get("pagar")
  listPagar(@Query(new ZodValidationPipe(ListTitulos)) q: z.infer<typeof ListTitulos>) {
    return this.service.listPagar(q);
  }

  @RequerPermissao("financeiro.faturar")
  @Post("pagar")
  criarPagar(
    @Body(new ZodValidationPipe(CriarTituloPagarInput)) body: CriarTituloPagarInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarTituloPagar(body, user.id);
  }

  @RequerPermissao("financeiro.faturar")
  @Post("pagar/:id/cancelar")
  cancelarPagar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CancelarTituloPagarInput)) body: CancelarTituloPagarInput,
  ) {
    return this.service.cancelarTituloPagar(id, body.motivo);
  }

  @RequerPermissao("financeiro.baixar")
  @Post("pagar/:id/baixa")
  baixarPagar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DarBaixaInput)) body: DarBaixaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.darBaixa("pagar", id, body, user.id);
  }

  @RequerPermissao("financeiro.baixar")
  @Delete("baixas/:id")
  estornar(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.estornarBaixa(id, user.id);
  }
}
