import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../../auth/decorators/roles.decorator";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ChamadasExternasService } from "./chamadas-externas.service";

const Filtro = z.object({
  servico: z.string().max(120).optional(),
  contaId: z.string().uuid().optional(),
  soErros: z.enum(["true", "false"]).optional(),
  busca: z.string().trim().max(200).optional(),
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).optional(),
});
type Filtro = z.infer<typeof Filtro>;

/**
 * Chamadas externas — só a equipe da plataforma (PlataformaGuard, fora do
 * catálogo de permissões de propósito: nenhuma empresa cliente vê as chamadas
 * das outras, e a chave não pode ser concedida a ninguém).
 */
@ApiTags("admin/chamadas-externas")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@Controller("admin/chamadas-externas")
export class ChamadasExternasController {
  constructor(private readonly service: ChamadasExternasService) {}

  @Get()
  listar(@Query(new ZodValidationPipe(Filtro)) q: Filtro) {
    return this.service.listar({ ...q, soErros: q.soErros === "true" });
  }

  @Get("resumo")
  resumo(@Query(new ZodValidationPipe(Filtro)) q: Filtro) {
    return this.service.resumo({ ...q, soErros: undefined });
  }

  @Get(":id")
  detalhe(@Param("id") id: string) {
    return this.service.detalhe(id);
  }
}
