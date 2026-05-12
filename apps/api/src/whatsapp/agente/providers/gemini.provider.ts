import { Logger } from "@nestjs/common";
import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import type { AgentProcessarArgs, AgentProvider } from "./agent.provider";

const MAX_TOOL_LOOPS = 6;

export class GeminiProvider implements AgentProvider {
  readonly nome = "gemini";
  private readonly log = new Logger("GeminiProvider");
  private readonly client?: GoogleGenAI;

  constructor(apiKey: string | undefined) {
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    } else {
      this.log.warn("GEMINI_API_KEY ausente — provider desabilitado");
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
      throw new Error("GeminiProvider sem API key configurada");
    }

    const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.input_schema,
    }));

    const contents: Content[] = historico
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const ultimo = contents[contents.length - 1];
    const jaTemMensagem =
      ultimo?.role === "user" &&
      ultimo.parts?.length === 1 &&
      ultimo.parts[0].text === mensagemAtual;
    if (!jaTemMensagem) {
      contents.push({ role: "user", parts: [{ text: mensagemAtual }] });
    }

    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const resp = await this.client.models.generateContent({
        model: modelo,
        contents,
        config: {
          systemInstruction: systemText,
          tools: [{ functionDeclarations }],
          maxOutputTokens: 1500,
        },
      });

      const usage = resp.usageMetadata;
      this.log.log(
        `[loop ${i}] candidates=${resp.candidates?.length ?? 0} ` +
          `tokens_in=${usage?.promptTokenCount ?? 0} ` +
          `tokens_out=${usage?.candidatesTokenCount ?? 0} ` +
          `cached=${usage?.cachedContentTokenCount ?? 0}`,
      );

      const calls = resp.functionCalls ?? [];

      if (calls.length === 0) {
        const texto = (resp.text ?? "").trim();
        return texto || "Não consegui formular uma resposta. Tenta de novo?";
      }

      const modelParts: Part[] = calls.map((c) => ({
        functionCall: { id: c.id, name: c.name, args: c.args },
      }));
      contents.push({ role: "model", parts: modelParts });

      const responseParts: Part[] = [];
      for (const call of calls) {
        try {
          const resultado = await executarTool(
            call.name ?? "",
            (call.args as Record<string, unknown>) ?? {},
          );
          responseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: { result: resultado },
            },
          });
        } catch (e) {
          responseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: { error: (e as Error).message ?? "Erro desconhecido" },
            },
          });
        }
      }
      contents.push({ role: "user", parts: responseParts });
    }

    return "Processei várias coisas mas não consegui chegar numa resposta final. Tenta perguntar de outro jeito.";
  }
}
