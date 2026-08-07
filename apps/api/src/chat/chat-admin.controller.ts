import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PublicarAvisoInput, ResolverDenunciaInput } from "@ronan/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthAdminUser } from "../auth/types";
import { ChatAdminService } from "./chat-admin.service";

const StatusQuery = z.object({
  status: z.enum(["ABERTA", "ARQUIVADA", "REMOVIDA"]).optional(),
});

/**
 * Lado da operação no chat: canal de Avisos + moderação de denúncias.
 * Não existe endpoint aqui pra ler conversa entre motoristas — é decisão de
 * privacidade, não omissão.
 */
@ApiTags("admin/chat")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles("ADMIN_USER")
@Controller("admin/chat")
export class ChatAdminController {
  constructor(private readonly service: ChatAdminService) {}

  @RequerPermissao("chat.ver")
  @Get("avisos")
  avisos() {
    return this.service.listarAvisos();
  }

  @RequerPermissao("chat.avisar")
  @Post("avisos")
  publicar(
    @CurrentUser() user: AuthAdminUser,
    @Body(new ZodValidationPipe(PublicarAvisoInput)) body: PublicarAvisoInput,
  ) {
    return this.service.publicarAviso(user.id, body);
  }

  @RequerPermissao("chat.avisar")
  @Delete("avisos/:id")
  @HttpCode(204)
  removerAviso(@CurrentUser() user: AuthAdminUser, @Param("id") id: string) {
    return this.service.removerAviso(user.id, id);
  }

  @RequerPermissao("chat.ver")
  @Get("denuncias")
  denuncias(@Query(new ZodValidationPipe(StatusQuery)) q: z.infer<typeof StatusQuery>) {
    return this.service.listarDenuncias(q.status);
  }

  @RequerPermissao("chat.ver")
  @Get("denuncias/contar")
  contar() {
    return this.service.contarAbertas();
  }

  @RequerPermissao("chat.moderar")
  @Post("denuncias/:id/resolver")
  @HttpCode(204)
  resolver(
    @CurrentUser() user: AuthAdminUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ResolverDenunciaInput)) body: ResolverDenunciaInput,
  ) {
    return this.service.resolverDenuncia(user.id, id, body);
  }
}
