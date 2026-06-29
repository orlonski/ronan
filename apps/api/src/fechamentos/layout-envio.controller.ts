import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LayoutEnvioService } from "./layout-envio.service";

const ColunaSchema = z.object({
  campo: z.string().min(1),
  header: z.string().min(1),
  ordem: z.number().int().min(0),
  formato: z.enum(["date_br", "date_iso", "decimal_br", "currency_br", "text"]).optional(),
});

const ConfigSchema = z
  .object({
    incluiCabecalhoEmpresa: z.boolean().optional(),
    formatoData: z.enum(["DD/MM/YYYY", "YYYY-MM-DD", "DD/MM/YY"]).optional(),
    separadorDecimal: z.enum(["vírgula", "ponto"]).optional(),
    agruparPor: z.enum(["data", "cliente", "placa", "nenhum"]).optional(),
    totaisRodape: z.boolean().optional(),
  })
  .optional();

const CriarSchema = z.object({
  nome: z.string().min(1).max(120),
  colunas: z.array(ColunaSchema).min(1),
  config: ConfigSchema,
  padrao: z.boolean().optional(),
});

const AtualizarSchema = CriarSchema.partial();

@ApiTags("admin/layouts-envio")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/empresas/:empresaId/layouts-envio")
export class LayoutEnvioController {
  constructor(private readonly service: LayoutEnvioService) {}

  @Get()
  list(@Param("empresaId") empresaId: string) {
    return this.service.list(empresaId);
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }

  @RequerPermissao("empresas.layouts")
  @Post()
  criar(
    @CurrentUser() user: AuthAdminUser,
    @Param("empresaId") empresaId: string,
    @Body(new ZodValidationPipe(CriarSchema)) body: z.infer<typeof CriarSchema>,
  ) {
    return this.service.criar({ ...body, empresaId, usuarioId: user.id });
  }

  @RequerPermissao("empresas.layouts")
  @Patch(":id")
  atualizar(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AtualizarSchema)) body: z.infer<typeof AtualizarSchema>,
  ) {
    return this.service.atualizar({ id, ...body });
  }

  @RequerPermissao("empresas.layouts")
  @Delete(":id")
  remover(@Param("id") id: string) {
    return this.service.remover(id);
  }
}
