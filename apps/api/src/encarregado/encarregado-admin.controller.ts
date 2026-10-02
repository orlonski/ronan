import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarEncarregadoInput,
  ConfirmarSolicitacaoObraInput,
  ConvidarEncarregadoInput,
  RecusarSolicitacaoObraInput,
  STATUS_SOLICITACAO_OBRA,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../auth/types";
import { EncarregadosAdminService } from "./encarregados-admin.service";
import { SolicitacoesObraService } from "./solicitacoes-obra.service";

/**
 * Quem da obra entra no portal. Mora na ficha da obra, por isso a rota é
 * aninhada nela. Chave própria (`encarregados`): dar acesso a gente de fora da
 * empresa não é a mesma decisão que editar o cadastro da obra.
 */
@ApiTags("admin/encarregados")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/clientes/:clienteId/encarregados")
export class EncarregadosAdminController {
  constructor(private readonly service: EncarregadosAdminService) {}

  @RequerPermissao("encarregados.ver")
  @Get()
  listar(@Param("clienteId", ParseUUIDPipe) clienteId: string) {
    return this.service.listar(clienteId);
  }

  @RequerPermissao("encarregados.editar")
  @Post()
  convidar(
    @Param("clienteId", ParseUUIDPipe) clienteId: string,
    @Body(new ZodValidationPipe(ConvidarEncarregadoInput)) body: ConvidarEncarregadoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.convidar(clienteId, body, user.id);
  }

  @RequerPermissao("encarregados.editar")
  @Patch(":id")
  atualizar(
    @Param("clienteId", ParseUUIDPipe) clienteId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AtualizarEncarregadoInput)) body: AtualizarEncarregadoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizar(clienteId, id, body, user.id);
  }

  @RequerPermissao("encarregados.editar")
  @Post(":id/convite")
  reenviarConvite(
    @Param("clienteId", ParseUUIDPipe) clienteId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.reenviarConvite(clienteId, id);
  }

  @RequerPermissao("encarregados.editar")
  @Post(":id/encerrar-sessoes")
  encerrarSessoes(
    @Param("clienteId", ParseUUIDPipe) clienteId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.encerrarSessoes(clienteId, id, user.id);
  }
}

const ListarSolicitacoesQuery = z.object({ status: z.enum(STATUS_SOLICITACAO_OBRA).optional() });
type ListarSolicitacoesQuery = z.infer<typeof ListarSolicitacoesQuery>;

/**
 * Os pedidos de caminhão vindos das obras. Respondem na programação, então
 * usam as chaves dela: ver é `programacao.ver`, decidir é `programacao.editar`.
 */
@ApiTags("admin/solicitacoes-obra")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/solicitacoes-obra")
export class SolicitacoesObraController {
  constructor(private readonly service: SolicitacoesObraService) {}

  @RequerPermissao("programacao.ver")
  @Get()
  listar(@Query(new ZodValidationPipe(ListarSolicitacoesQuery)) q: ListarSolicitacoesQuery) {
    return this.service.listar(q.status);
  }

  @RequerPermissao("programacao.ver")
  @Get("contar")
  contar() {
    return this.service.contarPendentes();
  }

  @RequerPermissao("programacao.editar")
  @Post(":id/confirmar")
  confirmar(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmarSolicitacaoObraInput)) body: ConfirmarSolicitacaoObraInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.confirmar(id, body, user.id);
  }

  @RequerPermissao("programacao.editar")
  @Post(":id/recusar")
  recusar(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RecusarSolicitacaoObraInput)) body: RecusarSolicitacaoObraInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.recusar(id, body, user.id);
  }
}
