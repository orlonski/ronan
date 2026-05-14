/**
 * Interface comum entre providers de IA (Anthropic, Gemini, etc).
 * O AgenteService usa essa interface — cada provider implementa o loop de
 * tool use no formato do seu SDK.
 */

export type AgentToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, AgentSchemaProperty>;
    required?: string[];
  };
};

export type AgentSchemaProperty = {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: AgentSchemaProperty;
  properties?: Record<string, AgentSchemaProperty>;
  required?: string[];
  minItems?: number;
  maxItems?: number;
};

export type AgentMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentToolExecutor = (
  nome: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

export type AgentProcessarArgs = {
  systemText: string;
  tools: AgentToolDefinition[];
  historico: AgentMessage[];
  mensagemAtual: string;
  modelo: string;
  executarTool: AgentToolExecutor;
};

export interface AgentProvider {
  readonly nome: string;
  readonly habilitado: boolean;
  processar(args: AgentProcessarArgs): Promise<string>;
}
