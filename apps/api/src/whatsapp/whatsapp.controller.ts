import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { RequerPermissao } from "../auth/decorators/requer-permissao.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { AvisoGrupoService } from "./aviso-grupo.service";
import { ConviteService } from "./convite.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";
import { WhatsappService } from "./whatsapp.service";

/**
 * Cache em memória do último QR recebido pelo webhook QRCODE_UPDATED.
 * Workaround pro Evolution v2 às vezes retornar vazio em /instance/connect
 * mas mandar o QR por webhook. Não persiste em DB — efêmero por design
 * (QR vence em ~20s e é regenerado automaticamente pelo Baileys).
 */
let ultimoQrCode: { base64: string | null; capturadoEm: Date } | null = null;

@ApiTags("whatsapp")
@Controller()
export class WhatsappController {
  constructor(
    private readonly service: WhatsappService,
    private readonly sessao: SessaoService,
    private readonly convite: ConviteService,
    private readonly evolution: EvolutionClientService,
    private readonly avisoGrupo: AvisoGrupoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Webhook do Evolution. Sem auth de JWT — Evolution chama com header `apikey`,
   * que validamos contra `EVOLUTION_API_KEY`. Resposta 200 imediata pra não
   * bloquear o Evolution; processamento é fire-and-forget.
   */
  @Public()
  @Post("whatsapp/webhook")
  @HttpCode(200)
  async webhook(@Body() body: any) {
    const event = body?.event;
    // Loga TUDO que chega — útil pra debug enquanto a integração está sendo
    // pareada. Removível depois.
    console.log(`[whatsapp] webhook event=${event}`, JSON.stringify(body).slice(0, 500));

    if (event === "messages.upsert") {
      this.service.processarMensagemRecebida(body).catch((e) => {
        console.error("processarMensagemRecebida falhou:", e);
      });
    } else if (event === "qrcode.updated" || event === "QRCODE_UPDATED") {
      // Captura QR pra exibir no painel. Salva em memória global (simples) —
      // depois polled pelo endpoint /admin/whatsapp/qrcode-cache.
      const data = body?.data;
      const base64 = data?.qrcode?.base64 ?? data?.qrcode ?? null;
      if (base64) {
        ultimoQrCode = { base64: typeof base64 === "string" ? base64 : null, capturadoEm: new Date() };
        console.log("[whatsapp] QR capturado via webhook, tamanho:", String(base64).length);
      }
    } else if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      console.log("[whatsapp] connection state:", body?.data?.state);
    }
    return { ok: true };
  }

  /** Endpoint extra pra ler o último QR recebido por webhook (workaround quando
   *  /instance/connect retorna vazio mas o QR foi enviado por webhook). */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/qrcode-cache")
  qrcodeCache() {
    return ultimoQrCode ?? { base64: null, capturadoEm: null };
  }

  // ================== Endpoints admin ==================

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/status")
  async status() {
    if (!this.evolution.configurado) {
      return { configurado: false, state: "close", numero: null };
    }
    try {
      const s = await this.evolution.statusInstancia();
      return { configurado: true, ...s };
    } catch {
      return { configurado: true, state: "close", numero: null };
    }
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/qrcode")
  async qrcode() {
    return this.evolution.pegarQrCode();
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/sessoes")
  async listarSessoes() {
    return this.sessao.listar();
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @RequerPermissao("whatsapp.gerenciar")
  @Delete("admin/whatsapp/sessoes/:id")
  @HttpCode(204)
  async desvincular(@Param("id") id: string) {
    await this.sessao.desvincular(id);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/mensagens")
  async mensagens(
    @Query("sessaoId") sessaoId: string,
    @Query("limit") limit?: string,
  ) {
    if (!sessaoId) return [];
    return this.service.historicoRecente(sessaoId, Number(limit ?? 50));
  }

  // ===== Aviso automático no grupo quando motorista se cadastra =====

  /** Grupos do número conectado, pro admin escolher o destino dos avisos. */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/grupos")
  async grupos() {
    return this.avisoGrupo.listarGrupos();
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/aviso-grupo")
  async avisoGrupoConfig() {
    return this.avisoGrupo.pegarConfig();
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @RequerPermissao("whatsapp.gerenciar")
  @Put("admin/whatsapp/aviso-grupo")
  async salvarAvisoGrupo(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      ativo?: boolean;
      grupoJid?: string | null;
      grupoNome?: string | null;
      template?: string | null;
    },
  ) {
    return this.avisoGrupo.salvarConfig(
      {
        ativo: body.ativo,
        grupoJid: body.grupoJid,
        grupoNome: body.grupoNome,
        template: body.template,
      },
      user.id,
    );
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Post("admin/motoristas/:id/convite-whatsapp")
  async conviteMotorista(@Param("id") id: string) {
    return this.convite.gerarParaMotorista(id);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Post("admin/users/:id/convite-whatsapp")
  async conviteUser(@Param("id") id: string) {
    return this.convite.gerarParaUser(id);
  }
}
