import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { MotoristaService } from "../../motorista/motorista.service";
import { ViagensMotoristaService } from "../../motorista/viagens.service";
import { DashboardService } from "../../admin/dashboard/dashboard.service";
import { ErrorsService } from "../../errors/errors.service";
import { UploadsService } from "../../uploads/uploads.service";
import { EvolutionClientService } from "../evolution-client.service";
import type { SessaoResolvida } from "../sessao.service";
import { construirTools, executarTool } from "./tools";
import { systemPromptMotorista, systemPromptAdmin } from "./prompts";
import type { AgentMessage, AgentProvider } from "./providers/agent.provider";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { GeminiProvider } from "./providers/gemini.provider";

const MAX_HISTORICO_MENSAGENS = 12;
const CONFIG_ID = "default";

type Identidade = Exclude<SessaoResolvida, { tipo: "DESCONHECIDO" }>;

type ProviderId = "anthropic" | "gemini";

/**
 * Fachada do agente IA do WhatsApp. Mantém instâncias dos providers
 * disponíveis (Anthropic, Gemini) e, a cada mensagem, lê a config do banco
 * (ConfiguracaoAgente) pra decidir provider/modelo. Trocar via UI vale na
 * próxima mensagem — sem restart.
 */
@Injectable()
export class AgenteService {
  private readonly log = new Logger("AgenteService");
  private readonly providers: Record<ProviderId, AgentProvider>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly motorista: MotoristaService,
    private readonly viagens: ViagensMotoristaService,
    private readonly dashboard: DashboardService,
    private readonly errors: ErrorsService,
    private readonly uploads: UploadsService,
    private readonly evolution: EvolutionClientService,
  ) {
    this.providers = {
      anthropic: new AnthropicProvider(this.config.get<string>("ANTHROPIC_API_KEY")),
      gemini: new GeminiProvider(this.config.get<string>("GEMINI_API_KEY")),
    };
    this.log.log(
      `Providers prontos: anthropic=${this.providers.anthropic.habilitado} ` +
        `gemini=${this.providers.gemini.habilitado}`,
    );
  }

  /** Algum provider está disponível? Usado pra placeholder quando ambos falham. */
  get habilitado() {
    return this.providers.anthropic.habilitado || this.providers.gemini.habilitado;
  }

  async processar(
    identidade: Identidade,
    mensagemUsuario: string,
    metadata?: {
      evolutionMessageId?: string;
      tipoMidia?: "imagem" | "audio";
      evolutionPayload?: { key: unknown; message: unknown };
    },
  ): Promise<string> {
    if (!this.habilitado) {
      return "Desculpa, a IA está fora do ar agora. Manda 'ajuda' pra ver os comandos manuais.";
    }

    const cfg = await this.prisma.configuracaoAgente.upsert({
      where: { id: CONFIG_ID },
      update: {},
      create: { id: CONFIG_ID },
    });

    const providerId: ProviderId = cfg.provider === "gemini" ? "gemini" : "anthropic";
    const provider = this.providers[providerId];

    if (!provider.habilitado) {
      this.log.warn(
        `Provider '${providerId}' selecionado na config mas sem API key — caindo no placeholder`,
      );
      const sugestao =
        providerId === "gemini"
          ? "Configure GEMINI_API_KEY no servidor ou troque o provider em Configurações → Agente WhatsApp."
          : "Configure ANTHROPIC_API_KEY no servidor ou troque o provider em Configurações → Agente WhatsApp.";
      return `Desculpa, a IA está fora do ar agora. ${sugestao}`;
    }

    const modelo = providerId === "gemini" ? cfg.modeloGemini : cfg.modeloAnthropic;

    const systemText =
      identidade.tipo === "MOTORISTA"
        ? systemPromptMotorista(identidade)
        : systemPromptAdmin(identidade);
    const tools = construirTools(identidade.tipo);

    const historicoRaw = await this.prisma.whatsappMensagem.findMany({
      where: { sessaoId: identidade.sessaoId },
      orderBy: { criadoEm: "desc" },
      take: MAX_HISTORICO_MENSAGENS,
    });

    const historico: AgentMessage[] = historicoRaw
      .reverse()
      .filter((m) => m.conteudo)
      .map((m) => ({
        role: m.direcao === "ENTRADA" ? ("user" as const) : ("assistant" as const),
        content: m.conteudo,
      }));

    const mensagemAtual = mensagemUsuario || (metadata?.tipoMidia ? `[${metadata.tipoMidia}]` : "");

    return provider.processar({
      systemText,
      tools,
      historico,
      mensagemAtual,
      modelo,
      executarTool: (nome, input) =>
        executarTool(nome, input, {
          identidade,
          prisma: this.prisma,
          motorista: this.motorista,
          viagens: this.viagens,
          dashboard: this.dashboard,
          errors: this.errors,
          uploads: this.uploads,
          evolution: this.evolution,
          metadata,
        }),
    });
  }
}
