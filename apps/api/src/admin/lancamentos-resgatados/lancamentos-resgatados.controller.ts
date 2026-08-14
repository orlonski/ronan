import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ResolverResgateInput } from "@ronan/shared-types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PermissaoGuard } from "../../auth/guards/permissao.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { AuthUser } from "../../auth/types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { LancamentosResgatadosService } from "../../lancamentos-resgatados/lancamentos-resgatados.service";

const ListarQuery = z.object({
  status: z.enum(["abertos", "resolvidos", "todos"]).default("abertos"),
  limit: z.coerce.number().int().min(1).max(300).default(100),
});

@ApiTags("admin/lancamentos-resgatados")
@ApiBearerAuth()
@UseGuards(RolesGuard, PermissaoGuard)
@Roles("ADMIN_USER")
@Controller("admin/lancamentos-resgatados")
export class LancamentosResgatadosAdminController {
  constructor(private readonly service: LancamentosResgatadosService) {}

  @Get()
  @RequerPermissao("lancamentos-resgatados.ver")
  listar(@Query(new ZodValidationPipe(ListarQuery)) query: z.infer<typeof ListarQuery>) {
    return this.service.listar(query);
  }

  @Post(":id/resolver")
  @RequerPermissao("lancamentos-resgatados.resolver")
  resolver(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ResolverResgateInput)) body: ResolverResgateInput,
  ) {
    return this.service.resolver(id, user.id, body);
  }
}
