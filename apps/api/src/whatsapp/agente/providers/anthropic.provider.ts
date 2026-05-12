import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";
import type {
  AgentProcessarArgs,
  AgentProvider,
  AgentToolDefinition,
} from "./agent.provider";

const MAX_TOOL_LOOPS = 6;

export class AnthropicProvider implements AgentProvider {
  readonly nome = "anthropic";
  private readonly log = new Logger("AnthropicProvider");
  private readonly client?: Anthropic;

  constructor(apiKey: string | undefined) {
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.log.warn("ANTHROPIC_API_KEY ausente — provider desabilitado");
    }
  }

  get habilitado() {
    return !!this.client;
  }

  async processar({
    systemText,
    tools,
    historico,
    mensagemAtual,
    modelo,
    executarTool,
  }: AgentProcessarArgs): Promise<string> {
    if (!this.client) {
      throw new Error("AnthropicProvider sem API key configurada");
    }

    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
    ];

    const anthropicTools = converterTools(tools);

    const messages: Anthropic.MessageParam[] = historico
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    if (
      messages[messages.length - 1]?.role !== "user" ||
      messages[messages.length - 1]?.content !== mensagemAtual
    ) {
      messages.push({ role: "user", content: mensagemAtual });
    }

    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const resp = await this.client.messages.create({
        model: modelo,
        max_tokens: 1500,
        system,
        tools: anthropicTools,
        messages,
      });
      this.log.log(
        `[loop ${i}] stop_reason=${resp.stop_reason} ` +
          `tool_uses=${resp.content.filter((b) => b.type === "tool_use").length} ` +
          `cache_create=${resp.usage?.cache_creation_input_tokens ?? 0} ` +
          `cache_read=${resp.usage?.cache_read_input_tokens ?? 0}`,
      );

      if (resp.stop_reason !== "tool_use") {
        const textoFinal = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return textoFinal || "Não consegui formular uma resposta. Tenta de novo?";
      }

      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tu of toolUses) {
        try {
          const resultado = await executarTool(
            tu.name,
            (tu.input as Record<string, unknown>) ?? {},
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

function converterTools(tools: AgentToolDefinition[]): Anthropic.Tool[] {
  const lista: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"],
  }));
  if (lista.length > 0) {
    lista[lista.length - 1] = {
      ...lista[lista.length - 1],
      cache_control: { type: "ephemeral" },
    };
  }
  return lista;
}
