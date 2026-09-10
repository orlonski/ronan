import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { IgnoraEscopo } from "../../common/escopo/escopo.decorator";
import { PrecosService } from "./precos.service";

const TabelaPrecoBody = z.object({
  faixas: z
    .array(
      z.object({
        deVeiculos: z.number().int().min(1),
        ateVeiculos: z.number().int().min(1).nullable(),
        valorCentavos: z.number().int().min(0),
        rotulo: z.string().max(60).nullable().optional(),
      }),
    )
    .min(1),
});

/**
 * Tabela de preço do produto. Atrás do `PlataformaGuard`: é quanto a Movatruck
 * cobra, não configuração de empresa cliente nenhuma.
 */
@ApiTags("admin/precos")
@ApiBearerAuth()
@UseGuards(RolesGuard, PlataformaGuard)
@Roles("ADMIN_USER")
@IgnoraEscopo()
@Controller("admin/precos")
export class PrecosController {
  constructor(private readonly service: PrecosService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Put()
  substituir(@Body(new ZodValidationPipe(TabelaPrecoBody)) body: z.infer<typeof TabelaPrecoBody>) {
    return this.service.substituir(body.faixas);
  }
}
