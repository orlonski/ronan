import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { NavegacaoService } from "../roteamento/navegacao.service";
import { CapacidadeLivre, RequerCapacidade } from "../common/acesso-app/capacidade.decorator";

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

// Distância pela estrada da posição atual até os locais da lista de escolha.
// Teto de 200: a lista vem ordenada por linha reta e só os mais próximos importam.
const DistanciasInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  localIds: z.array(z.string().uuid()).max(200),
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
  @CapacidadeLivre("Cálculo de rota pro lançamento: quem lança já passou pela capacidade de lançar.")
  calcular(
    @Query(new ZodValidationPipe(CalcularQuery))
    query: z.infer<typeof CalcularQuery>,
  ) {
    return this.roteamento.calcularKm(query.origem, query.destino);
  }

  @Get("alternativas")
  @CapacidadeLivre("Cálculo de rota pro lançamento: quem lança já passou pela capacidade de lançar.")
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
  @CapacidadeLivre("Cálculo de rota pro lançamento: quem lança já passou pela capacidade de lançar.")
  opcoes(
    @Query(new ZodValidationPipe(CalcularQuery))
    query: z.infer<typeof CalcularQuery>,
  ) {
    return this.roteamento.calcularComSemRetorno(query.origem, query.destino);
  }

  /**
   * Km pela estrada de onde o motorista está até cada local — o número ao lado
   * do local na lista de escolha. `null` = sem número (fora do mapa, sem
   * coordenada): o app mostra a linha reta pra esse.
   */
  @Post("distancias")
  @CapacidadeLivre("Cálculo de rota pro lançamento: quem lança já passou pela capacidade de lançar.")
  async distancias(
    @Body(new ZodValidationPipe(DistanciasInput))
    body: z.infer<typeof DistanciasInput>,
  ) {
    return {
      metros: await this.roteamento.distanciasAteLocais(
        { lat: body.lat, lng: body.lng },
        body.localIds,
      ),
    };
  }

  /**
   * Guia de navegação ao vivo (Valhalla): rota + manobras faladas em pt-BR da
   * posição atual do motorista até o Local de descarga. Só o app com "Iniciar
   * viagem com GPS" usa. É recalculado quando o motorista sai da rota (nova chamada).
   */
  @Post("navegar")
  @RequerCapacidade("app.viagem.gpsClassico")
  navegar(
    @Body(new ZodValidationPipe(NavegarInput))
    body: z.infer<typeof NavegarInput>,
  ) {
    return this.navegacao.navegarParaLocal(body.origemLat, body.origemLng, body.destinoId);
  }
}
