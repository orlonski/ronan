import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { KmAtipicoService } from "../km-atipico/km-atipico.service";

const ParQuery = z.object({
  carga: z.string().uuid(),
  descarga: z.string().uuid(),
});

const MeusParesQuery = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(60),
});

/**
 * Referência de km por trajeto pro app nativo. Só leitura de estatística
 * agregada — mesma sensibilidade do /m/rotas, então mesmo guard (motorista
 * autenticado). A flag podeReferenciaKm gateia a UX no app, não o endpoint.
 */
@ApiTags("motorista/km-referencia")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/km-referencia")
export class KmReferenciaMotoristaController {
  constructor(private readonly kmAtipico: KmAtipicoService) {}

  /** Pares que o motorista roda + mediana de cada, pro pré-cache offline. */
  @Get("meus-pares")
  meusPares(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(MeusParesQuery)) query: z.infer<typeof MeusParesQuery>,
  ) {
    return this.kmAtipico.referenciasDoMotorista(user.id, query.dias);
  }

  /** Referência on-demand de um par (com OSRM), quando os dois locais são escolhidos. */
  @Get()
  doPar(@Query(new ZodValidationPipe(ParQuery)) query: z.infer<typeof ParQuery>) {
    return this.kmAtipico.referenciaParaApp(query.carga, query.descarga);
  }
}
