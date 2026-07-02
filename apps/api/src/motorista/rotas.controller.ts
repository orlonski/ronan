import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RoteamentoService } from "../roteamento/roteamento.service";

const CalcularQuery = z.object({
  origem: z.string().uuid(),
  destino: z.string().uuid(),
});

@ApiTags("motorista/rotas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/rotas")
export class RotasMotoristaController {
  constructor(private readonly roteamento: RoteamentoService) {}

  @Get("calcular")
  calcular(
    @Query(new ZodValidationPipe(CalcularQuery))
    query: z.infer<typeof CalcularQuery>,
  ) {
    return this.roteamento.calcularKm(query.origem, query.destino);
  }

  @Get("alternativas")
  alternativas(
    @Query(new ZodValidationPipe(CalcularQuery))
    query: z.infer<typeof CalcularQuery>,
  ) {
    return this.roteamento.calcularAlternativas(query.origem, query.destino);
  }
}
