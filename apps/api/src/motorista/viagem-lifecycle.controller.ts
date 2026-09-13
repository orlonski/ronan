import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  EncerrarOcorrenciaInput,
  FinalizarViagemBase,
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
import { AppInfo, type AppInfoHeaders } from "../auth/decorators/app-info.decorator";
import type { AuthMotorista } from "../auth/types";
import { ViagensMotoristaService } from "./viagens.service";

// Payloads aceitam fotoKey (upload 2-step prévio via /m/uploads/ticket).
const RegistrarEventoPayload = RegistrarEventoInput;
// Base (sem o refine de obrigatórios): o servidor não recusa mais um
// lançamento por campo faltando — aceita e carimba. Ver o comentário do
// FinalizarViagemBase e common/divergencias.ts.
const FinalizarViagemPayload = FinalizarViagemBase;
const EncerrarOcorrenciaPayload = EncerrarOcorrenciaInput;

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

  /** Catálogo dinâmico da espinha da viagem (app renderiza os botões). */
  @Get("tipos-evento")
  tiposEvento() {
    return this.service.catalogoTiposEvento();
  }

  /**
   * O que deu errado: fila, quebra, carga recusada.
   *
   * Rota própria, e não um campo a mais na de cima, porque o app já instalado
   * consome aquela lista como a espinha — ocorrência entrando ali viraria botão
   * de "Carreguei" ao lado de "Acidente" em todo celular que ainda não pegou o
   * OTA.
   */
  @Get("tipos-ocorrencia")
  tiposOcorrencia() {
    return this.service.catalogoOcorrencias();
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
    @AppInfo() appInfo: AppInfoHeaders,
  ) {
    return this.service.iniciar(user.id, body, appInfo);
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

  /**
   * Encerra uma ocorrência com duração. Rota com prefixo fixo (`ocorrencias/`)
   * pra não ser confundida com `:clientId/...`.
   */
  @Post("ocorrencias/:id/encerrar")
  @AcessoMotorista("podeViagemLifecycle")
  encerrarOcorrencia(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EncerrarOcorrenciaPayload))
    body: z.infer<typeof EncerrarOcorrenciaPayload>,
  ) {
    return this.service.encerrarEvento(user.id, id, body.terminouEm);
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
