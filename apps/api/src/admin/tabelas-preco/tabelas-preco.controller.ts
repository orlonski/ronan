import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarTabelaPrecoInput,
  BASES_PRECO,
  CriarTabelaPrecoInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { TabelasPrecoService } from "./tabelas-preco.service";
import { PrecificacaoService } from "./precificacao.service";

const ListQuery = paginationQuerySchema.extend({
  empresaId: z.string().uuid().optional(),
  base: z.enum(BASES_PRECO).optional(),
  ativo: z.enum(["true", "false"]).optional(),
  vigentes: z.enum(["true", "false"]).optional(),
});
type ListQuery = z.infer<typeof ListQuery>;

const SimularQuery = z.object({
  empresaId: z.string().uuid(),
  materialId: z.string().uuid().optional(),
  tipoServicoId: z.string().uuid().optional(),
  km: z.coerce.number().nonnegative(),
  toneladas: z.coerce.number().nonnegative().default(0),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type SimularQuery = z.infer<typeof SimularQuery>;

/**
 * Preço de frete por empresa.
 *
 * Todos os handlers declaram permissão, inclusive os GETs — o `PermissaoGuard`
 * é fail-open, então handler sem a chave fica aberto pra qualquer ADMIN_USER, e
 * preço de contrato é exatamente o dado que nem todo mundo do painel deve ver.
 */
@ApiTags("admin/tabelas-preco")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/tabelas-preco")
export class TabelasPrecoController {
  constructor(
    private readonly service: TabelasPrecoService,
    private readonly precificacao: PrecificacaoService,
  ) {}

  @RequerPermissao("tabelas-preco.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListQuery)) query: ListQuery) {
    return this.service.list(query);
  }

  // Antes de `:id`, senão "simular" seria lido como um id.
  @RequerPermissao("tabelas-preco.ver")
  @Get("simular")
  simular(@Query(new ZodValidationPipe(SimularQuery)) query: SimularQuery) {
    return this.service.simular(query);
  }

  @RequerPermissao("tabelas-preco.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("tabelas-preco.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarTabelaPrecoInput)) body: CriarTabelaPrecoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.create(body, user.id);
  }

  @RequerPermissao("tabelas-preco.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarTabelaPrecoInput)) body: AtualizarTabelaPrecoInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("tabelas-preco.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  /**
   * Reprecifica tudo de uma empresa. O cadastro e a edição de preço já fazem
   * isso sozinhos — este endpoint é a saída pra quando alguém quer forçar
   * (mudou o mínimo por faixa, corrigiu o km de um monte de viagem, ou é o
   * primeiro uso e existe histórico anterior à tabela).
   *
   * Sob `editar` e não `ver`: reescreve o valor de milhares de viagens.
   */
  @RequerPermissao("tabelas-preco.editar")
  @Post("recalcular/:empresaId")
  recalcular(@Param("empresaId") empresaId: string) {
    return this.precificacao.recalcularDaEmpresa(empresaId);
  }
}
