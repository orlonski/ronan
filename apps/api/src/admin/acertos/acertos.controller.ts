import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AdicionarItemAcertoInput,
  DecidirPedagioDobroInput,
  DescartarAcertoInput,
  GerarAcertoInput,
  GerarAcertosEmLoteInput,
  IncluirDeForaAcertoInput,
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
import { AcertoPdfService } from "./acerto-pdf.service";

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
  constructor(
    private readonly service: AcertosService,
    private readonly pdfService: AcertoPdfService,
  ) {}

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

  /**
   * O que conferir antes de fechar: possível pedágio em dobro, diesel que
   * passou no cartão da empresa e o que ficou de fora de acertos anteriores.
   */
  @EscopoPor("motorista")
  @RequerPermissao("acertos.ver")
  @Get(":id/conferencia")
  async conferencia(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    await this.service.detalhe(id, user.escopo);
    return this.service.conferencia(id);
  }

  /** O extrato em PDF (o detalhe antes garante o escopo de frota). */
  @EscopoPor("motorista")
  @RequerPermissao("acertos.ver")
  @Get(":id/pdf")
  async pdf(@Param("id") id: string, @CurrentUser() user: AuthAdminUser, @Res() res: Response) {
    await this.service.detalhe(id, user.escopo);
    const { buffer, nome } = await this.pdfService.gerar(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  }

  /** Link assinado (30 dias) pra mandar ao parceiro, e o telefone dele pro WhatsApp. */
  @EscopoPor("motorista")
  @RequerPermissao("acertos.ver")
  @Get(":id/link")
  async link(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    const a = (await this.service.detalhe(id, user.escopo)) as { contaId: string };
    const telefone = await this.service.telefoneDoMotoristaDoAcerto(id);
    return { url: this.pdfService.link(id, a.contaId), telefone };
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

  /** Descarta um acerto ABERTO gerado errado. Motivo obrigatório; FECHADO/PAGO não. */
  @EscopoPor("motorista")
  @RequerPermissao("acertos.gerar")
  @Post(":id/descartar")
  async descartar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DescartarAcertoInput)) body: DescartarAcertoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    await this.service.detalhe(id, user.escopo);
    return this.service.descartar(id, body, user.id);
  }

  /** Inclui o que a empresa marcou na lista "Ficou de fora de acertos anteriores". */
  @EscopoPor("motorista")
  @RequerPermissao("acertos.gerar")
  @Post(":id/incluir-de-fora")
  async incluirDeFora(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(IncluirDeForaAcertoInput)) body: IncluirDeForaAcertoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    await this.service.detalhe(id, user.escopo);
    return this.service.incluirDeFora(id, body, user.id);
  }

  /** "É o mesmo pedágio" / "São pedágios diferentes" — decisão com autor. */
  @EscopoPor("motorista")
  @RequerPermissao("acertos.gerar")
  @Post(":id/pedagio-dobro")
  async decidirPedagioDobro(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DecidirPedagioDobroInput)) body: DecidirPedagioDobroInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    await this.service.detalhe(id, user.escopo);
    return this.service.decidirPedagioDobro(id, body, user.id);
  }

  @EscopoPor("motorista")
  @RequerPermissao("acertos.gerar")
  @Delete(":id/pedagio-dobro/:pedagioId")
  async desfazerDecisaoPedagio(
    @Param("id") id: string,
    @Param("pedagioId") pedagioId: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    await this.service.detalhe(id, user.escopo);
    return this.service.desfazerDecisaoPedagio(id, pedagioId, user.id);
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
