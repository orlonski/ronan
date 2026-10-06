import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AprovarDespesaInput,
  AprovarDespesasLoteInput,
  AtualizarTipoDespesaInput,
  CriarTipoDespesaInput,
  ListarDespesasAdminQuery,
  NaoReembolsarDespesaInput,
  ReordenarTiposDespesaInput,
  VincularDespesaAdminInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { DespesasAdminService } from "./despesas-admin.service";
import { TiposDespesaService } from "./tipos-despesa.service";

const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const EmConferenciaQuery = z.object({ motoristaId: z.string().uuid(), de: Dia, ate: Dia });
type EmConferenciaQuery = z.infer<typeof EmConferenciaQuery>;
const RotacaoInput = z.object({ rotacao: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) });
type RotacaoInput = z.infer<typeof RotacaoInput>;

/**
 * Tipos de gasto da empresa (aba "Tipos de gasto"). A lista também é lida
 * pelas outras abas (filtro por tipo), por isso o GET aceita qualquer uma das
 * chaves de gasto de viagem.
 */
@ApiTags("admin/tipos-despesa")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/tipos-despesa")
export class TiposDespesaController {
  constructor(private readonly service: TiposDespesaService) {}

  @RequerPermissao("tipos-despesa.ver", "despesas.ver", "despesas.conferir")
  @Get()
  list() {
    return this.service.list();
  }

  @RequerPermissao("tipos-despesa.criar")
  @Post()
  criar(
    @Body(new ZodValidationPipe(CriarTipoDespesaInput)) body: CriarTipoDespesaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criar(body, user.id);
  }

  @RequerPermissao("tipos-despesa.editar")
  @Post("reordenar")
  reordenar(@Body(new ZodValidationPipe(ReordenarTiposDespesaInput)) body: ReordenarTiposDespesaInput) {
    return this.service.reordenar(body.ids);
  }

  @RequerPermissao("tipos-despesa.editar")
  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarTipoDespesaInput)) body: AtualizarTipoDespesaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizar(id, body, user.id);
  }
}

/**
 * Gastos de viagem (módulo `despesas`). Uma chave por aba: `despesas.conferir`
 * (fila + decisões), `despesas.ver` (Todos, só leitura). `@EscopoPor
 * ("motorista")`: o recorte de frota vem do motorista, como no acerto.
 */
@ApiTags("admin/despesas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/despesas")
export class DespesasAdminController {
  constructor(private readonly service: DespesasAdminService) {}

  @EscopoPor("motorista")
  @RequerPermissao("despesas.conferir")
  @Get("conferir")
  fila(
    @Query(new ZodValidationPipe(ListarDespesasAdminQuery)) q: ListarDespesasAdminQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.fila(q, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.ver")
  @Get()
  todos(
    @Query(new ZodValidationPipe(ListarDespesasAdminQuery)) q: ListarDespesasAdminQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.todos(q, user.escopo);
  }

  /** Aviso no acerto: o que ainda está em conferência no período. */
  @RequerPermissao("acertos.ver")
  @Get("em-conferencia")
  emConferencia(@Query(new ZodValidationPipe(EmConferenciaQuery)) q: EmConferenciaQuery) {
    return this.service.emConferencia(q.motoristaId, q.de, q.ate);
  }

  /** Cartão "Gastos desta viagem" da ficha da viagem. */
  @EscopoPor("motorista")
  @RequerPermissao("despesas.ver", "despesas.conferir")
  @Get("viagem/:viagemId")
  daViagem(@Param("viagemId") viagemId: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.daViagem(viagemId, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.conferir")
  @Post("aprovar-lote")
  aprovarLote(
    @Body(new ZodValidationPipe(AprovarDespesasLoteInput)) body: AprovarDespesasLoteInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.aprovarLote(body.ids, user.id, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.ver", "despesas.conferir")
  @Get(":id")
  detalhe(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.detalhe(id, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.conferir")
  @Post(":id/aprovar")
  aprovar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AprovarDespesaInput)) body: AprovarDespesaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.aprovar(id, body, user.id, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.conferir")
  @Post(":id/nao-reembolsar")
  naoReembolsar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(NaoReembolsarDespesaInput)) body: NaoReembolsarDespesaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.naoReembolsar(id, body.motivo, user.id, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.conferir")
  @Post(":id/desfazer")
  desfazer(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.desfazer(id, user.id, user.escopo);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.conferir")
  @Patch(":id/viagem")
  vincular(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(VincularDespesaAdminInput)) body: VincularDespesaAdminInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.vincular(id, body.viagemId, user.id, user.escopo);
  }

  /** A foto, pela API (o bucket nunca tem domínio público). */
  @EscopoPor("motorista")
  @RequerPermissao("despesas.ver", "despesas.conferir")
  @Get(":id/fotos/:fotoId")
  async foto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Query("mini") mini: string | undefined,
    @CurrentUser() user: AuthAdminUser,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.foto(id, fotoId, user.escopo, !!mini);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }

  @EscopoPor("motorista")
  @RequerPermissao("despesas.conferir")
  @Patch(":id/fotos/:fotoId")
  girarFoto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Body(new ZodValidationPipe(RotacaoInput)) body: RotacaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.girarFoto(id, fotoId, body.rotacao, user.escopo);
  }
}
