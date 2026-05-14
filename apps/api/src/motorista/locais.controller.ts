import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
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
  obraId: z.string().uuid().optional(),
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
