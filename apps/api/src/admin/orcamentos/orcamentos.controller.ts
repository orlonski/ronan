import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import {
  AprovarOrcamentoInput,
  AtualizarOrcamentoInput,
  CriarOrcamentoInput,
  RecusarOrcamentoInput,
  STATUS_ORCAMENTO,
  SugestaoItemOrcamentoQuery,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { OrcamentosService } from "./orcamentos.service";
import { OrcamentoPdfService } from "./orcamento-pdf.service";

const ListQuery = paginationQuerySchema.extend({
  status: z.enum(STATUS_ORCAMENTO).optional(),
  empresaId: z.string().uuid().optional(),
});
type ListQuery = z.infer<typeof ListQuery>;

/** Propostas comerciais que, aprovadas, viram pedido. */
@ApiTags("admin/orcamentos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/orcamentos")
export class OrcamentosController {
  constructor(
    private readonly service: OrcamentosService,
    private readonly pdf: OrcamentoPdfService,
  ) {}

  @RequerPermissao("orcamentos.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListQuery)) query: ListQuery) {
    return this.service.list(query);
  }

  /**
   * Km da rota e preço da tabela do cliente pra um item em montagem. Declarado
   * antes de `:id` pra não ser engolido por ele.
   */
  @RequerPermissao("orcamentos.criar", "orcamentos.editar")
  @Get("sugestao")
  sugestao(@Query(new ZodValidationPipe(SugestaoItemOrcamentoQuery)) q: SugestaoItemOrcamentoQuery) {
    return this.service.sugestao(q);
  }

  @RequerPermissao("orcamentos.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("orcamentos.ver")
  @Get(":id/pdf")
  async baixarPdf(@Param("id") id: string, @Res() res: Response) {
    const { buffer, nome } = await this.pdf.gerar(id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  }

  /**
   * Gera o link público (30 dias) e marca a proposta como ENVIADA: tirar o
   * link pra mandar é o ato de enviar. Por isso é `editar`, não `ver` — e
   * porque link público expõe preço a quem tiver a URL.
   */
  @RequerPermissao("orcamentos.editar")
  @HttpCode(200)
  @Post(":id/link")
  async link(@Param("id") id: string) {
    const o = await this.service.marcarEnviado(id);
    const completo = await this.service.findOne(id);
    return {
      url: this.pdf.link(id, o.contaId),
      telefone: completo.prospectContato ?? completo.empresa?.contato ?? null,
      orcamento: completo,
    };
  }

  @RequerPermissao("orcamentos.criar")
  @Post()
  create(@Body(new ZodValidationPipe(CriarOrcamentoInput)) body: CriarOrcamentoInput, @CurrentUser() user: AuthAdminUser) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("orcamentos.editar")
  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(AtualizarOrcamentoInput)) body: AtualizarOrcamentoInput) {
    return this.service.update(id, body);
  }

  @RequerPermissao("orcamentos.editar")
  @HttpCode(200)
  @Post(":id/aprovar")
  aprovar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AprovarOrcamentoInput)) body: AprovarOrcamentoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.aprovar(id, body, user);
  }

  @RequerPermissao("orcamentos.editar")
  @HttpCode(200)
  @Post(":id/recusar")
  recusar(@Param("id") id: string, @Body(new ZodValidationPipe(RecusarOrcamentoInput)) body: RecusarOrcamentoInput) {
    return this.service.recusar(id, body.motivo);
  }

  /** Só rascunho. Sem chave "excluir" própria: apagar rascunho é editar a própria proposta. */
  @RequerPermissao("orcamentos.editar")
  @HttpCode(204)
  @Delete(":id")
  async remove(@Param("id") id: string) {
    await this.service.remove(id);
  }
}
