import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { AuthMotorista } from "../auth/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LocaisMotoristaService } from "./locais.service";

const CriarLocalInput = z.object({
  nome: z.string().min(3).max(120),
  logradouro: z.string().min(3),
  numero: z.string().max(20).optional(),
  bairro: z.string().max(80).optional(),
  cidade: z.string().min(2),
  uf: z.string().length(2),
  cep: z.string().max(15).optional(),
  pontoReferencia: z.string().max(200).optional(),
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]),
  clienteIds: z.array(z.string().uuid()).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  /**
   * App passa true quando motorista insistiu em criar mesmo havendo locais
   * próximos sugeridos (200m). Default false → backend faz pre-check e
   * pode devolver 409 com sugestões.
   */
  forcarCriacao: z.boolean().optional(),
});

const EventoPresencaInput = z.object({
  /** Duração entre ENTER e EXIT do geofence, em segundos. */
  duracaoSeg: z.number().int().nonnegative(),
  /** ISO; app pode enviar mesmo offline com o timestamp do dispositivo. */
  detectadoEm: z.string(),
});

const ProximosQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  tipoUso: z.enum(["carga", "descarga", "ambos"]).optional(),
  raioM: z.coerce.number().int().min(50).max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  clienteId: z.string().uuid().optional(),
});

const ProximosDescargaQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const CriarRapidoInput = z.object({
  /** UUID opcional gerado client-side. Quando presente, faz a chamada
   * idempotente — reenvio do mesmo id retorna o local existente sem criar
   * duplicata. Usado pelo outbox offline do app (motorista cria local sem
   * internet; sync envia esse id depois). */
  id: z.string().uuid().optional(),
  nome: z.string().min(2).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Precisão (accuracy em metros) do GPS no cadastro estando no local. */
  precisao: z.number().nonnegative().max(100000).optional(),
  /** Fonte do sinal na captura (PRECISA/BALANCED/CACHE). */
  fonte: z.enum(["PRECISA", "BALANCED", "CACHE"]).optional(),
  tipo: z.enum(["CARGA", "DESCARGA", "AMBOS"]),
  clienteIds: z.array(z.string().uuid()).optional(),
});

@ApiTags("motorista/locais")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("MOTORISTA")
@Controller("m/locais")
export class LocaisMotoristaController {
  constructor(private readonly service: LocaisMotoristaService) {}

  @Post()
  criar(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarLocalInput)) body: z.infer<typeof CriarLocalInput>,
  ) {
    return this.service.criar(user.id, body);
  }

  /**
   * Locais cadastrados pelo motorista que ainda estão em validação. Usado
   * pelo app pra registrar geofences passivos (limite iOS = 20).
   */
  @Get("em-validacao")
  emValidacao(@CurrentUser() user: AuthMotorista) {
    return this.service.emValidacao(user.id);
  }

  /**
   * Busca locais existentes perto do GPS dado. Usado pelo fluxo
   * "Estou no local de descarga" pra match automático.
   */
  @Get("proximos")
  proximos(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ProximosQuery)) query: z.infer<typeof ProximosQuery>,
  ) {
    return this.service.proximosPorGps({
      motoristaId: user.id,
      lat: query.lat,
      lng: query.lng,
      tipoUso: query.tipoUso,
      raioM: query.raioM,
      limit: query.limit,
      clienteId: query.clienteId,
    });
  }

  /**
   * Busca local de descarga por GPS em 2 etapas com raios configuráveis
   * (ConfiguracaoBuscaLocais). Usado pelo botão "Estou no local de descarga".
   * Retorna { locais, usouRaioAmpliado, raioInicialM, raioAmpliadoM }.
   */
  @Get("proximos-descarga")
  proximosDescarga(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ProximosDescargaQuery))
    query: z.infer<typeof ProximosDescargaQuery>,
  ) {
    return this.service.proximosDescargaDuasEtapas({
      motoristaId: user.id,
      lat: query.lat,
      lng: query.lng,
      limit: query.limit,
    });
  }

  /**
   * Cria local rápido: motorista digitou só o nome (após não achar match
   * no /proximos). Backend resolve endereço via reverse geocoding.
   */
  @Post("rapido")
  criarRapido(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarRapidoInput)) body: z.infer<typeof CriarRapidoInput>,
  ) {
    return this.service.criarRapido(user.id, body);
  }

  /**
   * App envia evento de presença detectado pelo geofence do OS. Se a
   * permanência foi suficiente (≥10min), promove o local a DWELL_CONFIRMADO.
   */
  @Post(":id/eventos-presenca")
  registrarEvento(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EventoPresencaInput)) body: z.infer<typeof EventoPresencaInput>,
  ) {
    return this.service.registrarEventoPresenca(user.id, id, body);
  }
}
