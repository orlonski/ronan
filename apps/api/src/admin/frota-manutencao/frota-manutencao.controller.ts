import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarManutencaoInput,
  AtualizarMultaInput,
  CriarManutencaoInput,
  CriarMultaInput,
  CriarPlanoManutencaoInput,
  SalvarDocumentoVeiculoInput,
  SalvarPneuInput,
  STATUS_MANUTENCAO,
  STATUS_MULTA,
  TIPOS_MANUTENCAO,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { FrotaManutencaoService } from "./frota-manutencao.service";

const ListManutencoes = paginationQuerySchema.extend({
  veiculoId: z.string().uuid().optional(),
  status: z.enum(STATUS_MANUTENCAO).optional(),
  tipo: z.enum(TIPOS_MANUTENCAO).optional(),
});
const ListPneus = paginationQuerySchema.extend({
  veiculoId: z.string().uuid().optional(),
  ativo: z.enum(["true", "false"]).optional(),
});
const ListMultas = paginationQuerySchema.extend({
  status: z.enum(STATUS_MULTA).optional(),
  veiculoId: z.string().uuid().optional(),
  motoristaId: z.string().uuid().optional(),
});

/** Manutenção, plano preventivo e o painel de alertas da frota. */
@ApiTags("admin/manutencao")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/manutencao")
export class ManutencaoController {
  constructor(private readonly service: FrotaManutencaoService) {}

  @EscopoPor("veiculo")
  @RequerPermissao("manutencao.ver")
  @Get("alertas")
  alertas(@CurrentUser() user: AuthAdminUser) {
    return this.service.alertas(user.escopo);
  }

  @EscopoPor("veiculo")
  @RequerPermissao("manutencao.ver")
  @Get()
  list(
    @Query(new ZodValidationPipe(ListManutencoes)) q: z.infer<typeof ListManutencoes>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.listManutencoes(q, user.escopo);
  }

  @RequerPermissao("manutencao.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarManutencaoInput)) body: CriarManutencaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarManutencao(body, user.id);
  }

  @RequerPermissao("manutencao.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarManutencaoInput)) body: AtualizarManutencaoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizarManutencao(id, body, user.id);
  }

  @RequerPermissao("manutencao.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerManutencao(id);
  }

  @RequerPermissao("manutencao.ver")
  @Get("planos")
  listarPlanos() {
    return this.service.listarPlanos();
  }

  @RequerPermissao("manutencao.criar")
  @Post("planos")
  criarPlano(
    @Body(new ZodValidationPipe(CriarPlanoManutencaoInput)) body: CriarPlanoManutencaoInput,
  ) {
    return this.service.criarPlano(body);
  }

  @RequerPermissao("manutencao.excluir")
  @Delete("planos/:id")
  removerPlano(@Param("id") id: string) {
    return this.service.removerPlano(id);
  }
}

@ApiTags("admin/pneus")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/pneus")
export class PneusController {
  constructor(private readonly service: FrotaManutencaoService) {}

  @RequerPermissao("pneus.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListPneus)) q: z.infer<typeof ListPneus>) {
    return this.service.listPneus(q);
  }

  @RequerPermissao("pneus.criar")
  @Post()
  create(@Body(new ZodValidationPipe(SalvarPneuInput)) body: SalvarPneuInput) {
    return this.service.salvarPneu(body);
  }

  @RequerPermissao("pneus.editar")
  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(SalvarPneuInput)) body: SalvarPneuInput) {
    return this.service.salvarPneu(body, id);
  }

  @RequerPermissao("pneus.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerPneu(id);
  }
}

@ApiTags("admin/multas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/multas")
export class MultasController {
  constructor(private readonly service: FrotaManutencaoService) {}

  @RequerPermissao("multas.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListMultas)) q: z.infer<typeof ListMultas>) {
    return this.service.listMultas(q);
  }

  @RequerPermissao("multas.criar")
  @Post()
  create(
    @Body(new ZodValidationPipe(CriarMultaInput)) body: CriarMultaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criarMulta(body, user.id);
  }

  @RequerPermissao("multas.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarMultaInput)) body: AtualizarMultaInput,
  ) {
    return this.service.atualizarMulta(id, body);
  }
}

@ApiTags("admin/documentos-veiculo")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/documentos-veiculo")
export class DocumentosVeiculoController {
  constructor(private readonly service: FrotaManutencaoService) {}

  @RequerPermissao("documentos-veiculo.ver")
  @Get()
  list(@Query("veiculoId") veiculoId?: string) {
    return this.service.listDocumentos(veiculoId);
  }

  @RequerPermissao("documentos-veiculo.editar")
  @Post()
  salvar(
    @Body(new ZodValidationPipe(SalvarDocumentoVeiculoInput)) body: SalvarDocumentoVeiculoInput,
  ) {
    return this.service.salvarDocumento(body);
  }

  @RequerPermissao("documentos-veiculo.editar")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerDocumento(id);
  }
}
