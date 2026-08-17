import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
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
import { comConta } from "../common/conta/conta-context";
import { segredoConfere } from "../common/seguranca/segredo";
import { contaAlvo } from "./conta-alvo";
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

/**
 * Headers em que o segredo do webhook pode chegar. O Evolution v2 manda a
 * `apikey` da instância; um proxy na frente pode preferir um header próprio.
 * Conferimos os dois pra não depender de um detalhe de config remota.
 */
const HEADERS_SEGREDO_WEBHOOK = ["apikey", "x-webhook-secret"] as const;

@ApiTags("whatsapp")
@Controller()
export class WhatsappController {
  private readonly log = new Logger("WhatsappWebhook");

  constructor(
    private readonly service: WhatsappService,
    private readonly sessao: SessaoService,
    private readonly convite: ConviteService,
    private readonly evolution: EvolutionClientService,
    private readonly avisoGrupo: AvisoGrupoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Webhook do Evolution. Sem auth de JWT (`@Public()` pula o guard global) —
   * a autenticação é o segredo compartilhado em `WHATSAPP_WEBHOOK_SECRET`,
   * mandado pelo Evolution num header.
   *
   * ⚠️ ETAPA 1 DE 2 — hoje a conferência só OBSERVA: quando o segredo não bate,
   * loga e deixa passar. É de propósito. O Evolution v2 não garante qual header
   * manda no webhook (depende da config da instância), e ligar a recusa no
   * escuro derrubaria todo o inbound em produção. Depois de 24h de log limpo
   * confirmando qual header chega, trocar o `warn` por `UnauthorizedException`.
   *
   * Resposta 200 imediata pra não bloquear o Evolution; processamento é
   * fire-and-forget.
   */
  @Public()
  @Post("whatsapp/webhook")
  @HttpCode(200)
  async webhook(@Body() body: any, @Headers() headers: Record<string, string | string[]>) {
    const event = body?.event;
    this.conferirSegredo(headers, event);
    // Só o tipo do evento. O corpo carrega mensagem de motorista (dado pessoal)
    // e não tem por que ficar no log de produção.
    this.log.log(`webhook event=${event}`);

    if (event === "messages.upsert") {
      this.service.processarMensagemRecebida(body).catch((e) => {
        this.log.error(`processarMensagemRecebida falhou: ${(e as Error).message}`);
      });
    } else if (event === "qrcode.updated" || event === "QRCODE_UPDATED") {
      // Captura QR pra exibir no painel. Salva em memória global (simples) —
      // depois polled pelo endpoint /admin/whatsapp/qrcode-cache.
      const data = body?.data;
      const base64 = data?.qrcode?.base64 ?? data?.qrcode ?? null;
      if (base64) {
        ultimoQrCode = { base64: typeof base64 === "string" ? base64 : null, capturadoEm: new Date() };
        this.log.log(`QR capturado via webhook, tamanho: ${String(base64).length}`);
      }
    } else if (event === "connection.update" || event === "CONNECTION_UPDATE") {
      this.log.log(`connection state: ${body?.data?.state}`);
    }
    return { ok: true };
  }

  /**
   * Confere o segredo compartilhado do webhook. Só observa e loga — ver o aviso
   * de ETAPA 1 DE 2 no handler.
   *
   * O valor recebido NUNCA é logado, nem em erro. O que vai pro log é só qual
   * header chegou, pra dar pra descobrir onde o Evolution põe o segredo antes
   * de ligar a recusa.
   */
  private conferirSegredo(headers: Record<string, string | string[]>, event: unknown): void {
    const esperado = this.config.get<string>("WHATSAPP_WEBHOOK_SECRET");
    if (!esperado) {
      // Sem segredo configurado não há o que conferir. Avisa uma vez por
      // evento pra não passar despercebido em produção.
      this.log.warn(`WHATSAPP_WEBHOOK_SECRET não configurado — webhook aberto (event=${event})`);
      return;
    }

    const presentes = HEADERS_SEGREDO_WEBHOOK.filter((h) => headers[h] !== undefined);
    const bateu = HEADERS_SEGREDO_WEBHOOK.find((h) => {
      const v = headers[h];
      return segredoConfere(Array.isArray(v) ? v[0] : v, esperado);
    });

    if (bateu) {
      this.log.debug(`segredo do webhook conferido no header "${bateu}"`);
      return;
    }
    this.log.warn(
      `segredo do webhook NÃO bateu (event=${event}) — headers de segredo presentes: ` +
        `${presentes.length ? presentes.join(", ") : "nenhum"}. Passando assim mesmo (etapa 1 de 2).`,
    );
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
  async avisoGrupoConfig(
    @CurrentUser() user: AuthUser,
    @Query("contaId") contaId?: string,
  ) {
    return comConta(contaAlvo(user, contaId), () => this.avisoGrupo.pegarConfig());
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @RequerPermissao("whatsapp.gerenciar")
  @Put("admin/whatsapp/aviso-grupo")
  async salvarAvisoGrupo(
    @CurrentUser() user: AuthUser,
    @Query("contaId") contaId: string | undefined,
    @Body()
    body: {
      ativo?: boolean;
      grupoJid?: string | null;
      grupoNome?: string | null;
      template?: string | null;
    },
  ) {
    return comConta(contaAlvo(user, contaId), () =>
      this.avisoGrupo.salvarConfig(
        {
          ativo: body.ativo,
          grupoJid: body.grupoJid,
          grupoNome: body.grupoNome,
          template: body.template,
        },
        user.id,
      ),
    );
  }

  /**
   * Diagnóstico: dado o CPF (ou id) de um motorista, mostra cada etapa da régua
   * do aviso e por que (não) dispara. `enviar=true` envia de verdade ignorando a
   * trava de envio único — pra re-testar o mesmo motorista.
   */
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN_USER")
  @Get("admin/whatsapp/aviso-grupo/diagnostico")
  async diagnosticarAvisoGrupo(
    @Query("motorista") motorista: string,
    @Query("enviar") enviar?: string,
  ) {
    if (!motorista) return { ok: false, motivo: "Informe o CPF do motorista." };
    return this.avisoGrupo.diagnosticar(motorista, { enviar: enviar === "true" });
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
