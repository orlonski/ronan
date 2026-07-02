import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  FinalizarViagemInput,
  IniciarViagemInput,
  RegistrarEventoInput,
} from "@ronan/shared-types";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ViagensMotoristaService } from "./viagens.service";

// Payloads aceitam fotoKey (upload 2-step prévio via /m/uploads/ticket).
const RegistrarEventoPayload = RegistrarEventoInput;
const FinalizarViagemPayload = FinalizarViagemInput;

/**
 * Lifecycle guiado de viagem (Iniciar → eventos → Finalizar). Controller
 * dedicado em `m/viagem` (singular) pra não colidir com as rotas `:id` do
 * `m/viagens` (plural). Todas as rotas de escrita exigem podeViagemLifecycle.
 */
@ApiTags("motorista/viagem-lifecycle")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@Controller("m/viagem")
export class ViagemLifecycleController {
  constructor(private readonly service: ViagensMotoristaService) {}

  /** Catálogo dinâmico de tipos de evento (app renderiza os botões). */
  @Get("tipos-evento")
  tiposEvento() {
    return this.service.catalogoTiposEvento();
  }

  /** Viagem em andamento do motorista (0 ou 1) + eventos + catálogo. */
  @Get("andamento")
  andamento(@CurrentUser() user: AuthMotorista) {
    return this.service.viagemAndamento(user.id);
  }

  @Post("iniciar")
  @AcessoMotorista("podeViagemLifecycle")
  iniciar(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(IniciarViagemInput)) body: z.infer<typeof IniciarViagemInput>,
  ) {
    return this.service.iniciar(user.id, body);
  }

  @Post(":clientId/eventos")
  @AcessoMotorista("podeViagemLifecycle")
  registrarEvento(
    @CurrentUser() user: AuthMotorista,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(RegistrarEventoPayload))
    body: z.infer<typeof RegistrarEventoPayload>,
  ) {
    return this.service.registrarEvento(user.id, clientId, body);
  }

  @Post(":clientId/finalizar")
  @AcessoMotorista("podeViagemLifecycle")
  finalizar(
    @CurrentUser() user: AuthMotorista,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(FinalizarViagemPayload))
    body: z.infer<typeof FinalizarViagemPayload>,
  ) {
    return this.service.finalizar(user.id, clientId, body);
  }

  /** Descartar/cancelar a viagem em andamento (apaga a EM_ANDAMENTO). Idempotente. */
  @Post(":clientId/cancelar")
  @AcessoMotorista("podeViagemLifecycle")
  cancelar(@CurrentUser() user: AuthMotorista, @Param("clientId") clientId: string) {
    return this.service.cancelar(user.id, clientId);
  }
}
