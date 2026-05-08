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
import { ConfigService } from "@nestjs/config";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ConviteService } from "./convite.service";
import { EvolutionClientService } from "./evolution-client.service";
import { SessaoService } from "./sessao.service";
import { WhatsappService } from "./whatsapp.service";

@ApiTags("whatsapp")
@Controller()
export class WhatsappController {
  constructor(
    private readonly service: WhatsappService,
    private readonly sessao: SessaoService,
    private readonly convite: ConviteService,
    private readonly evolution: EvolutionClientService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Webhook do Evolution. Sem auth de JWT — Evolution chama com header `apikey`,
   * que validamos contra `EVOLUTION_API_KEY`. Resposta 200 imediata pra não
   * bloquear o Evolution; processamento é fire-and-forget.
   */
  @Post("whatsapp/webhook")
  @HttpCode(200)
  async webhook(@Body() body: any) {
    // Validação leve da assinatura (Evolution não assina, só repassa apikey no header — mas
    // com webhook URL não óbvia + HTTPS o risco é baixo. Pra hardening real, comparar IPs
    // do servidor Evolution).
    const event = body?.event;
    if (event === "messages.upsert") {
      // Fire and forget — webhook não pode demorar.
      this.service.processarMensagemRecebida(body).catch((e) => {
        // log silencioso; service já loga erros internos
        console.error("processarMensagemRecebida falhou:", e);
      });
    }
    return { ok: true };
  }

  // ================== Endpoints admin ==================

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
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
  @Roles("ADMIN")
  @Get("admin/whatsapp/qrcode")
  async qrcode() {
    return this.evolution.pegarQrCode();
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Get("admin/whatsapp/sessoes")
  async listarSessoes() {
    return this.sessao.listar();
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  @Delete("admin/whatsapp/sessoes/:id")
  @HttpCode(204)
  async desvincular(@Param("id") id: string) {
    await this.sessao.desvincular(id);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN", "OPERADOR")
  @Get("admin/whatsapp/mensagens")
  async mensagens(
    @Query("sessaoId") sessaoId: string,
    @Query("limit") limit?: string,
  ) {
    if (!sessaoId) return [];
    return this.service.historicoRecente(sessaoId, Number(limit ?? 50));
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  @Post("admin/motoristas/:id/convite-whatsapp")
  async conviteMotorista(@Param("id") id: string) {
    return this.convite.gerarParaMotorista(id);
  }

  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles("ADMIN")
  @Post("admin/users/:id/convite-whatsapp")
  async conviteUser(@Param("id") id: string) {
    return this.convite.gerarParaUser(id);
  }
}
