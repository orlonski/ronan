import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { AtualizarAbastecimentoInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { EscopoPor } from "../../common/escopo/escopo.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { AbastecimentosAdminService } from "./abastecimentos.service";

const RotacaoFotoInput = z.object({
  rotacao: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
type RotacaoFotoInput = z.infer<typeof RotacaoFotoInput>;

const ListAbastecimentosQuery = paginationQuerySchema.extend({
  motoristaId: z.string().uuid().optional(),
  veiculoId: z.string().uuid().optional(),
  empresaId: z.string().uuid().optional(),
  semEmpresa: z.enum(["true", "false"]).optional(),
  transportadoraId: z.string().uuid().optional(),
  tipo: z.enum(["DIESEL_S10", "DIESEL_S500", "ARLA_32", "GASOLINA", "ETANOL"]).optional(),
  // Nome exato do posto (sem diferenciar caixa) — o drill-down do relatório
  // agrupa por posto e precisa reabrir a lista exatamente daquele grupo.
  posto: z.string().min(1).max(120).optional(),
  semPosto: z.enum(["true", "false"]).optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type ListAbastecimentosQuery = z.infer<typeof ListAbastecimentosQuery>;

@ApiTags("admin/abastecimentos")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/abastecimentos")
export class AbastecimentosAdminController {
  constructor(private readonly service: AbastecimentosAdminService) {}

  @EscopoPor("abastecimento")
  @RequerPermissao("abastecimentos.ver")
  @Get()
  list(
    @Query(new ZodValidationPipe(ListAbastecimentosQuery)) query: ListAbastecimentosQuery,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.list(query, user.escopo);
  }

  // Os três GETs de item abaixo ficaram sem @RequerPermissao desde que a
  // controller nasceu. Como o PermissaoGuard é fail-open (handler sem a chave
  // passa), qualquer ADMIN_USER lia abastecimento — inclusive a foto do cupom
  // — de QUALQUER frota, bastando o UUID. A trava de conta segurava o
  // vazamento entre empresas; entre transportadoras da mesma conta, não.
  @EscopoPor("abastecimento")
  @RequerPermissao("abastecimentos.ver")
  @Get(":id")
  detalhe(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.detalhe(id, user.escopo);
  }

  @EscopoPor("abastecimento")
  @RequerPermissao("abastecimentos.ver")
  @Get(":id/historico")
  historico(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.historico(id, user.escopo);
  }

  @EscopoPor("abastecimento")
  @RequerPermissao("abastecimentos.editar")
  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarAbastecimentoInput))
    body: z.infer<typeof AtualizarAbastecimentoInput>,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.atualizar(id, body, user.id, user.escopo);
  }

  @Roles("ADMIN_USER")
  @EscopoPor("abastecimento")
  @RequerPermissao("abastecimentos.excluir")
  @Delete(":id")
  @HttpCode(204)
  async excluir(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    await this.service.excluir(id, user.escopo);
  }

  @EscopoPor("abastecimento")
  @RequerPermissao("abastecimentos.ver")
  @Get(":id/fotos/:fotoId")
  async foto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @CurrentUser() user: AuthAdminUser,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.fotoBuffer(id, fotoId, user.escopo);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }

  @EscopoPor("abastecimento")
  @RequerPermissao("abastecimentos.editar")
  @Patch(":id/fotos/:fotoId")
  rotacionarFoto(
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Body(new ZodValidationPipe(RotacaoFotoInput)) body: RotacaoFotoInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.rotacionarFoto(id, fotoId, body.rotacao, user.escopo);
  }
}
