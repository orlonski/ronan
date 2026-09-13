import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AtualizarFornecedorInput,
  CriarCustoFixoInput,
  CriarFornecedorInput,
  TIPOS_FORNECEDOR,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { FornecedoresService } from "./fornecedores.service";

const ListQuery = paginationQuerySchema.extend({
  tipo: z.enum(TIPOS_FORNECEDOR).optional(),
  ativo: z.enum(["true", "false"]).optional(),
});

/** Posto, oficina, borracharia, seguradora — a contraparte do que sai. */
@ApiTags("admin/fornecedores")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/fornecedores")
export class FornecedoresController {
  constructor(private readonly service: FornecedoresService) {}

  @RequerPermissao("fornecedores.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.service.list(q);
  }

  @RequerPermissao("fornecedores.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("fornecedores.criar")
  @Post()
  create(@Body(new ZodValidationPipe(CriarFornecedorInput)) body: CriarFornecedorInput) {
    return this.service.create(body);
  }

  @RequerPermissao("fornecedores.editar")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarFornecedorInput)) body: AtualizarFornecedorInput,
  ) {
    return this.service.update(id, body);
  }

  @RequerPermissao("fornecedores.excluir")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}

/** Custo fixo recorrente do veículo: IPVA, seguro, parcela, depreciação. */
@ApiTags("admin/custos-veiculo")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/custos-veiculo")
export class CustosVeiculoController {
  constructor(private readonly service: FornecedoresService) {}

  @RequerPermissao("custos-veiculo.ver")
  @Get()
  list(@Query("veiculoId") veiculoId?: string) {
    return this.service.listCustos(veiculoId);
  }

  @RequerPermissao("custos-veiculo.editar")
  @Post()
  create(@Body(new ZodValidationPipe(CriarCustoFixoInput)) body: CriarCustoFixoInput) {
    return this.service.criarCusto(body);
  }

  @RequerPermissao("custos-veiculo.editar")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.removerCusto(id);
  }
}
