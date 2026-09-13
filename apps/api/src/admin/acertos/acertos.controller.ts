import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AdicionarItemAcertoInput,
  GerarAcertoInput,
  GerarAcertosEmLoteInput,
  MarcarAcertoPagoInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { AcertosService } from "./acertos.service";

const ListQuery = paginationQuerySchema.extend({
  motoristaId: z.string().uuid().optional(),
  status: z.enum(["ABERTO", "FECHADO", "PAGO"]).optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type ListQuery = z.infer<typeof ListQuery>;

/**
 * O acerto do período com o motorista.
 *
 * Todas as rotas declaram permissão, GETs inclusive: o `PermissaoGuard` é
 * fail-open, e quanto cada motorista recebe é o dado mais sensível do painel
 * depois do preço.
 *
 * `@EscopoPor("motorista")` porque o recorte é pela frota do motorista — o
 * gestor de uma transportadora terceira vê o acerto dos motoristas dele.
 */
@ApiTags("admin/acertos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/acertos")
export class AcertosController {
  constructor(private readonly service: AcertosService) {}

  @EscopoPor("motorista")
  @RequerPermissao("acertos.ver")
  @Get()
  list(
    @Query(new ZodValidationPipe(ListQuery)) query: ListQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.list(query, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("acertos.ver")
  @Get(":id")
  detalhe(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.detalhe(id, user.escopo);
  }

  @RequerPermissao("acertos.gerar")
  @Post("gerar")
  gerar(
    @Body(new ZodValidationPipe(GerarAcertoInput)) body: GerarAcertoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.gerar(body, user.id);
  }

  @RequerPermissao("acertos.gerar")
  @Post("gerar-lote")
  gerarLote(
    @Body(new ZodValidationPipe(GerarAcertosEmLoteInput)) body: GerarAcertosEmLoteInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.gerarEmLote(body, user.id);
  }

  @RequerPermissao("acertos.gerar")
  @Post(":id/itens")
  adicionarItem(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdicionarItemAcertoInput)) body: AdicionarItemAcertoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.adicionarItem(id, body, user.id);
  }

  @RequerPermissao("acertos.gerar")
  @Delete(":id/itens/:itemId")
  removerItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.removerItem(id, itemId, user.id);
  }

  // Fechar e pagar são chaves próprias, separadas de `gerar`: montar o acerto é
  // trabalho de escritório, dizer que está combinado e que o dinheiro saiu é
  // decisão de quem responde pelo caixa.
  @RequerPermissao("acertos.fechar")
  @Post(":id/fechar")
  fechar(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.fechar(id, user.id);
  }

  @RequerPermissao("acertos.fechar")
  @Post(":id/reabrir")
  reabrir(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.reabrir(id, user.id);
  }

  @RequerPermissao("acertos.pagar")
  @Post(":id/pagar")
  pagar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(MarcarAcertoPagoInput)) body: MarcarAcertoPagoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.marcarPago(id, body, user.id);
  }
}
