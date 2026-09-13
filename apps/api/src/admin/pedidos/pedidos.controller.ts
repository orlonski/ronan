import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarPedidoInput,
  AtualizarViagemPlanejadaInput,
  CriarPedidoInput,
  CriarViagemPlanejadaInput,
  PublicarProgramacaoInput,
  STATUS_PEDIDO,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { PedidosService } from "./pedidos.service";
import { ProgramacaoService } from "./programacao.service";

const ListPedidosQuery = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  status: z.enum(STATUS_PEDIDO).optional(),
  abertos: z.enum(["true", "false"]).optional(),
});
type ListPedidosQuery = z.infer<typeof ListPedidosQuery>;

const DiaQuery = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
type DiaQuery = z.infer<typeof DiaQuery>;

/** O que o cliente pediu. */
@ApiTags("admin/pedidos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/pedidos")
export class PedidosController {
  constructor(private readonly service: PedidosService) {}

  @RequerPermissao("pedidos.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListPedidosQuery)) query: ListPedidosQuery) {
    return this.service.list(query);
  }

  @RequerPermissao("pedidos.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("pedidos.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarPedidoInput)) body: CriarPedidoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("pedidos.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarPedidoInput)) body: AtualizarPedidoInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("pedidos.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}

/**
 * O quadro do dia: quem leva o quê.
 *
 * Chave própria (`programacao`) e não `pedidos`: quem monta a escala nem sempre
 * é quem negocia o pedido com o cliente.
 */
@ApiTags("admin/programacao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/programacao")
export class ProgramacaoController {
  constructor(private readonly service: ProgramacaoService) {}

  @EscopoPor("motorista")
  @RequerPermissao("programacao.ver")
  @Get()
  doDia(
    @Query(new ZodValidationPipe(DiaQuery)) query: DiaQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.doDia(query.data, user.escopo);
  }

  @RequerPermissao("programacao.editar")
  @Post()
  criar(
    @Body(new ZodValidationPipe(CriarViagemPlanejadaInput)) body: CriarViagemPlanejadaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criar(body, user.id);
  }

  @RequerPermissao("programacao.editar")
  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarViagemPlanejadaInput))
    body: AtualizarViagemPlanejadaInput,
  ) {
    return this.service.atualizar(id, body);
  }

  @RequerPermissao("programacao.editar")
  @Delete(":id")
  remover(@Param("id") id: string) {
    return this.service.remover(id);
  }

  // Publicar é chave separada: montar o quadro é rascunho, publicar avisa o
  // motorista e vira combinado.
  @RequerPermissao("programacao.publicar")
  @Post("publicar")
  publicar(
    @Body(new ZodValidationPipe(PublicarProgramacaoInput)) body: PublicarProgramacaoInput,
  ) {
    return this.service.publicar(body);
  }
}
