import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PedagiosRodoviaConsultaService } from "./pedagios-rodovia-consulta.service";

const NaRotaQuery = z.object({
  origem: z.string().uuid(),
  destino: z.string().uuid(),
});

/**
 * Endpoint só pra alertar o motorista quando ele vai salvar uma viagem
 * sem valor de pedágio mas a rota passa por pedágio cadastrado. Não
 * sugere valor — só lista os pedágios pra mostrar na confirmação.
 */
@ApiTags("motorista/pedagios-rodovia")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/pedagios-rodovia")
export class PedagiosRodoviaMotoristaController {
  constructor(private readonly service: PedagiosRodoviaConsultaService) {}

  @Get("na-rota")
  naRota(@Query(new ZodValidationPipe(NaRotaQuery)) q: z.infer<typeof NaRotaQuery>) {
    return this.service.pedagiosNaRota(q.origem, q.destino);
  }
}
