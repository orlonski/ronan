import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import {
  CriarViagemBase,
  CompletarPesoInput,
  EncerrarDiariaInput,
  checarObrigatoriosDoModo,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AppInfo, type AppInfoHeaders } from "../auth/decorators/app-info.decorator";
import type { AuthMotorista } from "../auth/types";
import { ViagensMotoristaService } from "./viagens.service";

const CriarViagemPayload = CriarViagemBase.extend({
  fotoKey: z.string().optional(),
}).superRefine(checarObrigatoriosDoModo);

const AdicionarFotoInput = z.object({
  fotoKey: z.string().min(1),
});

const InformarPedagioInput = z.object({
  valor: z.number().positive().max(99999.99),
});

const ResponderKmDivergenteInput = z.object({
  // Km corrigido (opcional — o motorista pode só justificar mantendo o valor).
  km: z.number().nonnegative().max(99999).optional(),
  // Justificativa obrigatória; vira mensagem no chat da viagem.
  justificativa: z.string().min(5).max(500),
});

const EnviarMensagemInput = z.object({
  texto: z.string().min(1).max(1000),
});

const MesSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mes deve estar no formato YYYY-MM");

const ListarViagensQuery = z.object({
  mes: MesSchema.optional(),
  status: z.enum(["AGUARDANDO", "CONFERIDA", "DIVERGENTE"]).optional(),
  // Só viagens que tiveram pedágio (valorPedagioTotal > 0) — alimenta a aba
  // "Pedágios" do histórico. Fica como string ("true"/"false", convertida no
  // handler) por dois motivos: z.coerce.boolean() transformaria a string
  // "false" em true, e um .transform() aqui quebra o ZodValidationPipe, que
  // exige schema com entrada e saída do mesmo tipo (ZodSchema<T>).
  comPedagio: z.enum(["true", "false"]).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const ResumoMesQuery = z.object({
  mes: MesSchema.optional(),
});

function mesAtual(): string {
  const now = new Date();
  const ano = now.getUTCFullYear();
  const mes = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

@ApiTags("motorista/viagens")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@Controller("m/viagens")
export class ViagensMotoristaController {
  constructor(private readonly service: ViagensMotoristaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ListarViagensQuery))
    query: z.infer<typeof ListarViagensQuery>,
  ) {
    return this.service.list(user.id, {
      mes: query.mes,
      grupoStatus: query.status,
      comPedagio: query.comPedagio === "true",
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get("resumo")
  resumo(
    @CurrentUser() user: AuthMotorista,
    @Query(new ZodValidationPipe(ResumoMesQuery))
    query: z.infer<typeof ResumoMesQuery>,
  ) {
    return this.service.resumoMes(user.id, query.mes ?? mesAtual());
  }

  /**
   * Viagens lançadas sem peso (status AGUARDANDO_PESO) — alimenta o banner e a
   * lista "aguardando peso" do app. Precisa vir ANTES de @Get(":id") pra não
   * colidir com a rota dinâmica.
   */
  @Get("aguardando-peso")
  aguardandoPeso(@CurrentUser() user: AuthMotorista) {
    return this.service.listarAguardandoPeso(user.id);
  }

  /**
   * Diárias abertas (status AGUARDANDO_SAIDA) — alimenta o card "Diária aberta"
   * na home do app. Mesma regra de rota do aguardando-peso: antes do @Get(":id").
   */
  @Get("aguardando-saida")
  aguardandoSaida(@CurrentUser() user: AuthMotorista) {
    return this.service.listarAguardandoSaida(user.id);
  }

  @Post()
  @AcessoMotorista("podeLancarViagem")
  create(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(CriarViagemPayload)) body: z.infer<typeof CriarViagemPayload>,
    @AppInfo() appInfo: AppInfoHeaders,
  ) {
    return this.service.create(user.id, body, appInfo);
  }

  /**
   * Completa peso + ticket de uma viagem lançada em AGUARDANDO_PESO (romaneio
   * saiu no fim do dia). Transiciona pra ENVIADA e entra no fluxo normal.
   */
  @Post(":id/completar-peso")
  completarPeso(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CompletarPesoInput))
    body: z.infer<typeof CompletarPesoInput>,
  ) {
    return this.service.completarPeso(user.id, id, body);
  }

  /**
   * Encerra uma diária aberta (AGUARDANDO_SAIDA): grava a hora de saída,
   * calcula a duração e transiciona pra ENVIADA.
   */
  @Post(":id/encerrar-diaria")
  encerrarDiaria(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EncerrarDiariaInput))
    body: z.infer<typeof EncerrarDiariaInput>,
  ) {
    return this.service.encerrarDiaria(user.id, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.delete(user.id, id);
  }

  @Get(":id")
  detalhe(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.detalhe(user.id, id);
  }

  @Get(":id/fotos/:fotoId")
  async foto(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Param("fotoId") fotoId: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.fotoBuffer(
      user.id,
      id,
      fotoId,
    );
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  }

  /**
   * Anexa foto a uma viagem já criada. Motorista subiu a foto antes via
   * POST /m/uploads/ticket (obtém fotoKey) e chama aqui. Padrão 2-step,
   * compatível com o outbox offline.
   */
  @Post(":id/fotos")
  adicionarFoto(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdicionarFotoInput))
    body: z.infer<typeof AdicionarFotoInput>,
  ) {
    return this.service.adicionarFoto(user.id, id, body.fotoKey);
  }

  /**
   * Motorista responde a uma divergência tipo PEDAGIO_SEM_VALOR informando
   * o valor que tinha esquecido. Faz a viagem virar AJUSTADA pra admin
   * revisar antes de aprovar.
   */
  @Post(":id/informar-valor-pedagio")
  informarValorPedagio(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(InformarPedagioInput))
    body: z.infer<typeof InformarPedagioInput>,
  ) {
    return this.service.informarValorPedagio(user.id, id, body.valor);
  }

  /**
   * Motorista responde a uma divergência tipo FOTO_ILEGIVEL anexando uma
   * foto nova (foi feito upload prévio em /m/uploads/ticket → fotoKey).
   * Viagem vira AJUSTADA pra conferente revisar; fotos antigas continuam
   * no histórico.
   */
  @Post(":id/responder-foto-divergente")
  responderFotoDivergente(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdicionarFotoInput))
    body: z.infer<typeof AdicionarFotoInput>,
  ) {
    return this.service.responderFotoDivergente(user.id, id, body.fotoKey);
  }

  /**
   * Motorista responde a uma divergência tipo KM_DIVERGENTE: pode corrigir o km
   * e/ou justificar por que colocou aquele valor. A justificativa vai pra
   * observação da viagem; a viagem vira AJUSTADA pro admin revisar.
   */
  @Post(":id/responder-km-divergente")
  responderKmDivergente(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ResponderKmDivergenteInput))
    body: z.infer<typeof ResponderKmDivergenteInput>,
  ) {
    return this.service.responderKmDivergente(user.id, id, body);
  }

  /** Chat da viagem: histórico de mensagens. */
  @Get(":id/mensagens")
  listarMensagens(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.listarMensagens(user.id, id);
  }

  /** Motorista manda uma mensagem no chat da viagem. */
  @Post(":id/mensagens")
  enviarMensagem(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarMensagemInput))
    body: z.infer<typeof EnviarMensagemInput>,
  ) {
    return this.service.enviarMensagem(user.id, id, body.texto);
  }
}
