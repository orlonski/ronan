import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { NavegacaoService } from "../roteamento/navegacao.service";

const CalcularQuery = z.object({
  origem: z.string().uuid(),
  destino: z.string().uuid(),
});

// Navegação ao vivo: origem = posição ATUAL do motorista (lat/lng), destino = Local.
const NavegarInput = z.object({
  origemLat: z.number().min(-90).max(90),
  origemLng: z.number().min(-180).max(180),
  destinoId: z.string().uuid(),
});

@ApiTags("motorista/rotas")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/rotas")
export class RotasMotoristaController {
  constructor(
    private readonly roteamento: RoteamentoService,
    private readonly navegacao: NavegacaoService,
  ) {}

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

  /**
   * Variantes COM retorno (curb) vs SEM retorno (direto) do mesmo par, pro app
   * deixar o motorista confirmar se voltou no retorno. Devolve 1 opção quando não
   * há retorno real (dedup) — aí o app não mostra escolha.
   */
  @Get("opcoes")
  opcoes(
    @Query(new ZodValidationPipe(CalcularQuery))
    query: z.infer<typeof CalcularQuery>,
  ) {
    return this.roteamento.calcularComSemRetorno(query.origem, query.destino);
  }

  /**
   * Guia de navegação ao vivo (Valhalla): rota + manobras faladas em pt-BR da
   * posição atual do motorista até o Local de descarga. Só o app com "Iniciar
   * viagem com GPS" usa. É recalculado quando o motorista sai da rota (nova chamada).
   */
  @Post("navegar")
  navegar(
    @Body(new ZodValidationPipe(NavegarInput))
    body: z.infer<typeof NavegarInput>,
  ) {
    return this.navegacao.navegarParaLocal(body.origemLat, body.origemLng, body.destinoId);
  }
}
