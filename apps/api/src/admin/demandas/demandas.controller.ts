import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { paginationQuerySchema } from "../../common/pagination";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequerPermissao } from "../../auth/decorators/requer-permissao.decorator";
import type { AuthAdminUser } from "../../auth/types";
import { DemandasService } from "./demandas.service";

const CriarDemandaInput = z.object({
  titulo: z.string().trim().min(5, "Escreva um título com pelo menos 5 letras").max(200),
  descricao: z
    .string()
    .trim()
    .min(20, "Descreva melhor: com menos de 20 letras o agente vai ter que adivinhar")
    .max(20_000),
});
type CriarDemandaInput = z.infer<typeof CriarDemandaInput>;

const ListDemandasQuery = paginationQuerySchema.extend({
  status: z.enum(["PENDENTE", "EXECUTANDO", "CONCLUIDA", "FALHOU", "EXCEDEU_LIMITE"]).optional(),
});
type ListDemandasQuery = z.infer<typeof ListDemandasQuery>;

@ApiTags("admin/demandas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/demandas")
export class DemandasController {
  constructor(private readonly service: DemandasService) {}

  @RequerPermissao("demandas.ver")
  @Get()
  list(@Query(new ZodValidationPipe(ListDemandasQuery)) query: ListDemandasQuery) {
    return this.service.list(query);
  }

  // Antes de :id pra não ser capturado como um id.
  @RequerPermissao("demandas.ver")
  @Get("resumo")
  resumo() {
    return this.service.resumo();
  }

  @RequerPermissao("demandas.ver")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @RequerPermissao("demandas.criar")
  @Post()
  criar(
    @Body(new ZodValidationPipe(CriarDemandaInput)) body: CriarDemandaInput,
    @CurrentUser() user: AuthAdminUser,
  ) {
    return this.service.criar({ ...body, usuario: { id: user.id, nome: user.nome } });
  }

  @RequerPermissao("demandas.criar")
  @Post(":id/repetir")
  repetir(@Param("id") id: string, @CurrentUser() user: AuthAdminUser) {
    return this.service.repetir(id, { id: user.id, nome: user.nome });
  }
}
