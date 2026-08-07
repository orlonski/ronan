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
  AbrirConversaInput,
  BloquearMotoristaInput,
  DenunciarMensagemInput,
  EnviarAudioChatInput,
  EnviarMensagemChatInput,
} from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AcessoMotorista } from "../auth/decorators/acesso-motorista.decorator";
import { AcessoMotoristaGuard } from "../auth/guards/acesso-motorista.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthMotorista } from "../auth/types";
import { ChatService } from "./chat.service";

const SilenciarInput = z.object({ silenciado: z.boolean() });

/**
 * Chat do app do motorista. Tudo aqui está atrás de `podeChat` — o guard
 * também barra cadastro não aprovado, então não existe caminho pra alguém em
 * análise cair na lista de contatos dos outros.
 */
@ApiTags("motorista/chat")
@ApiBearerAuth()
@UseGuards(RolesGuard, AcessoMotoristaGuard)
@Roles("MOTORISTA")
@AcessoMotorista("podeChat")
@Controller("m/chat")
export class ChatMotoristaController {
  constructor(private readonly service: ChatService) {}

  @Get("contatos")
  contatos(@CurrentUser() user: AuthMotorista, @Query("busca") busca?: string) {
    return this.service.contatos(user.id, busca);
  }

  @Get("conversas")
  conversas(@CurrentUser() user: AuthMotorista) {
    return this.service.listarConversas(user.id);
  }

  @Post("conversas")
  abrir(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(AbrirConversaInput)) body: AbrirConversaInput,
  ) {
    return this.service.abrirConversa(user.id, body.motoristaId);
  }

  @Get("conversas/:id/mensagens")
  mensagens(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.service.mensagens(user.id, id, cursor);
  }

  @Post("conversas/:id/mensagens")
  enviar(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarMensagemChatInput)) body: EnviarMensagemChatInput,
  ) {
    return this.service.enviar(user.id, id, body);
  }

  /**
   * Mensagem de áudio. O arquivo já subiu em `/m/uploads/chat-audio`; aqui só
   * entra a mensagem. A transcrição roda em background e chega depois pelo poll.
   */
  @Post("conversas/:id/audio")
  enviarAudio(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(EnviarAudioChatInput)) body: EnviarAudioChatInput,
  ) {
    return this.service.enviarAudio(user.id, id, body);
  }

  @Get("mensagens/:id/audio")
  async audio(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { buffer, contentType } = await this.service.audioBuffer(user.id, id);
    res.set("Content-Type", contentType);
    // `private` porque o áudio é de conversa fechada — não pode encostar em
    // cache compartilhado no caminho.
    res.set("Cache-Control", "private, max-age=86400");
    res.set("Accept-Ranges", "none");
    res.send(buffer);
  }

  @Post("conversas/:id/lida")
  @HttpCode(204)
  lida(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.marcarLida(user.id, id);
  }

  @Post("conversas/:id/silenciar")
  @HttpCode(204)
  silenciar(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SilenciarInput)) body: z.infer<typeof SilenciarInput>,
  ) {
    return this.service.silenciar(user.id, id, body.silenciado);
  }

  /**
   * Poll do app enquanto a conversa está aberta. Sem `desde` devolve só o
   * contador (é o que a aba usa pro badge).
   */
  @Get("novidades")
  novidades(
    @CurrentUser() user: AuthMotorista,
    @Query("desde") desde?: string,
    @Query("conversaId") conversaId?: string,
  ) {
    return this.service.novidades(user.id, desde, conversaId);
  }

  @Delete("mensagens/:id")
  @HttpCode(204)
  apagar(@CurrentUser() user: AuthMotorista, @Param("id") id: string) {
    return this.service.apagarMensagem(user.id, id);
  }

  @Post("mensagens/:id/denuncia")
  @HttpCode(204)
  denunciar(
    @CurrentUser() user: AuthMotorista,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(DenunciarMensagemInput)) body: DenunciarMensagemInput,
  ) {
    return this.service.denunciar(user.id, id, body);
  }

  @Get("bloqueios")
  bloqueios(@CurrentUser() user: AuthMotorista) {
    return this.service.listarBloqueios(user.id);
  }

  @Post("bloqueios")
  @HttpCode(204)
  bloquear(
    @CurrentUser() user: AuthMotorista,
    @Body(new ZodValidationPipe(BloquearMotoristaInput)) body: BloquearMotoristaInput,
  ) {
    return this.service.bloquear(user.id, body.motoristaId);
  }

  @Delete("bloqueios/:motoristaId")
  @HttpCode(204)
  desbloquear(
    @CurrentUser() user: AuthMotorista,
    @Param("motoristaId") motoristaId: string,
  ) {
    return this.service.desbloquear(user.id, motoristaId);
  }
}
