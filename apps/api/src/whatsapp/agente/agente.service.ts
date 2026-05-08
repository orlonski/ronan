import Anthropic from "@anthropic-ai/sdk";
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
import type { ToolContext } from "./tools";
import { systemPromptMotorista, systemPromptAdmin } from "./prompts";

// Sonnet hardcoded — Haiku alucinava tool calls (dizia "viagem criada" sem
// chamar a tool). Sonnet 4.6 é confiável em seguir o fluxo de tools. Vale o
// custo extra (~R$0,10/conversa vs R$0,02 do Haiku).
const MODELO_AGENTE = "claude-sonnet-4-6";
const MAX_HISTORICO_MENSAGENS = 12;
const MAX_TOOL_LOOPS = 6;

type Identidade = Exclude<SessaoResolvida, { tipo: "DESCONHECIDO" }>;

/**
 * Orquestrador do agente IA do WhatsApp. Recebe a mensagem do motorista/admin,
 * monta o histórico (últimas N mensagens), passa pro Claude com as tools do
 * perfil correspondente, executa o loop de tool use até o Claude responder
 * com texto final. Retorna o texto pra mandar pro WhatsApp.
 */
@Injectable()
export class AgenteService {
  private readonly log = new Logger("AgenteService");
  private client?: Anthropic;

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
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.log.warn("ANTHROPIC_API_KEY não configurada — agente vai responder placeholder");
    }
  }

  get habilitado() {
    return !!this.client;
  }

  /**
   * Processa uma mensagem do usuário vinculado.
   * `mensagemUsuario` pode estar vazia se for foto/áudio puro — nesse caso passa
   * o tipo via `metadata` pra IA decidir.
   */
  async processar(
    identidade: Identidade,
    mensagemUsuario: string,
    metadata?: { evolutionMessageId?: string; tipoMidia?: "imagem" | "audio" },
  ): Promise<string> {
    if (!this.client) {
      return "Desculpa, a IA está fora do ar agora. Manda 'ajuda' pra ver os comandos manuais.";
    }

    const system = identidade.tipo === "MOTORISTA" ? systemPromptMotorista(identidade) : systemPromptAdmin(identidade);
    const tools = construirTools(identidade.tipo);
    const modelo = MODELO_AGENTE;

    // Carrega histórico recente da sessão
    const historico = await this.prisma.whatsappMensagem.findMany({
      where: { sessaoId: identidade.sessaoId },
      orderBy: { criadoEm: "desc" },
      take: MAX_HISTORICO_MENSAGENS,
    });

    const messages: Anthropic.MessageParam[] = historico
      .reverse()
      .filter((m) => m.conteudo)
      .map((m) => ({
        role: m.direcao === "ENTRADA" ? ("user" as const) : ("assistant" as const),
        content: m.conteudo,
      }));

    // Mensagem atual (caso ainda não tenha sido salva no histórico)
    const conteudoAtual = mensagemUsuario || (metadata?.tipoMidia ? `[${metadata.tipoMidia}]` : "");
    if (messages[messages.length - 1]?.role !== "user" || messages[messages.length - 1]?.content !== conteudoAtual) {
      messages.push({ role: "user", content: conteudoAtual });
    }

    // Loop de tool use — máximo MAX_TOOL_LOOPS rodadas
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const resp = await this.client.messages.create({
        model: modelo,
        max_tokens: 1500,
        system,
        tools,
        messages,
      });
      this.log.log(`[loop ${i}] stop_reason=${resp.stop_reason} tool_uses=${resp.content.filter((b) => b.type === "tool_use").length}`);

      // Se IA terminou (não pediu tool), retorna texto
      if (resp.stop_reason !== "tool_use") {
        const textoFinal = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return textoFinal || "Não consegui formular uma resposta. Tenta de novo?";
      }

      // Processa cada tool_use bloco
      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        try {
          const resultado = await executarTool(
            tu.name,
            (tu.input as Record<string, unknown>) ?? {},
            {
              identidade,
              prisma: this.prisma,
              motorista: this.motorista,
              viagens: this.viagens,
              dashboard: this.dashboard,
              errors: this.errors,
              uploads: this.uploads,
              evolution: this.evolution,
              metadata,
            },
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(resultado),
          });
        } catch (e) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: (e as Error).message ?? "Erro desconhecido",
          });
        }
      }

      messages.push({ role: "assistant", content: resp.content });
      messages.push({ role: "user", content: toolResults });
    }

    return "Processei várias coisas mas não consegui chegar numa resposta final. Tenta perguntar de outro jeito.";
  }
}
