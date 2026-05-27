import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ExtrairTicketResult } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";

// Default usado caso ConfiguracaoIa.modelo não esteja setada (raro).
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Slug do campo é resolvido dinamicamente pela tabela CampoLayout (ver
// CamposLayoutService). Se um slug aqui não existe na tabela, é tratado como
// "ignorar" no processor. Validação na entrada é feita no controller.
export type LayoutColumn = string;

export type LayoutInferenceResult = {
  tipoBloco: "viagens" | "pedagios" | "outro";
  abaPreferida?: string;
  linhaCabecalho?: number;
  linhaInicioDados?: number;
  colunas: { letra: string; cabecalho: string; campo: LayoutColumn }[];
  observacoes?: string;
};

export type CandidatoMatch = {
  viagemId: string;
  data: string;
  placa: string;
  ticket: string;
  km: number;
  toneladas: number;
};

export type SugestaoMatchResult = {
  viagemId: string | null;
  confidence: number; // 0..1
  motivo: string;
};

@Injectable()
export class IaService {
  private readonly log = new Logger(IaService.name);
  private client?: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    }
  }

  /** Lê modelo da config singleton; cache simples por 30s pra evitar query a cada call. */
  private modeloCache: { value: string; until: number } | null = null;
  private async modeloAtual(): Promise<string> {
    if (this.modeloCache && this.modeloCache.until > Date.now()) {
      return this.modeloCache.value;
    }
    try {
      const cfg = await this.prisma.configuracaoIa.upsert({
        where: { id: "default" },
        update: {},
        create: { id: "default" },
      });
      const value = cfg.modelo || DEFAULT_MODEL;
      this.modeloCache = { value, until: Date.now() + 30_000 };
      return value;
    } catch {
      return DEFAULT_MODEL;
    }
  }

  get habilitada() {
    return !!this.client;
  }

  /**
   * Pede pra IA identificar quais colunas (e em qual aba) representam um bloco
   * de fechamento de uma transportadora. Recebe amostra das primeiras N linhas.
   * `tipoBloco` direciona a busca: VIAGEM (default), PEDAGIO, COMBUSTIVEL.
   */
  async inferirLayout(
    amostra: {
      nomeArquivo: string;
      abas: { nome: string; primeirasLinhas: (string | number | null)[][] }[];
    },
    tipoBloco?: "VIAGEM" | "PEDAGIO" | "COMBUSTIVEL",
  ): Promise<LayoutInferenceResult | null> {
    if (!this.client) {
      this.log.warn("Anthropic API key não configurada — pulando inferência de layout");
      return null;
    }

    // Lista de campos vem do banco (CampoLayout). Admin pode adicionar campos
    // novos sem mudar código — IA é instruída dinamicamente.
    let camposAtivos: { slug: string; label: string; descricao: string | null }[] = [];
    try {
      camposAtivos = await this.prisma.campoLayout.findMany({
        where: { ativo: true },
        orderBy: { ordem: "asc" },
        select: { slug: true, label: true, descricao: true },
      });
    } catch (err) {
      this.log.warn(`Falha ao ler campos_layout: ${(err as Error).message}`);
    }

    // Fallback de segurança: se a tabela estiver vazia (seed não rodou ou
    // banco zerado), usa a lista clássica pra IA não retornar tudo como
    // "ignorar". Este fallback existe pra evitar regressão em ambiente novo.
    if (camposAtivos.length < 5) {
      this.log.warn(
        `Tabela campos_layout vazia ou incompleta (${camposAtivos.length}). Usando fallback hardcoded.`,
      );
      camposAtivos = [
        { slug: "data", label: "Data", descricao: "Data da viagem" },
        { slug: "placa", label: "Placa", descricao: "Placa do veículo" },
        { slug: "ticket", label: "Ticket", descricao: "Número do ticket" },
        { slug: "cliente", label: "Cliente", descricao: "Nome do cliente" },
        { slug: "material", label: "Material", descricao: "Material transportado" },
        { slug: "fornecedor", label: "Fornecedor", descricao: null },
        { slug: "unidade", label: "Unidade", descricao: "TON, M3, etc" },
        { slug: "toneladas", label: "Toneladas", descricao: "Quantidade transportada" },
        { slug: "km", label: "Km", descricao: "Quilômetros rodados" },
        { slug: "valor_unitario", label: "Valor unitário", descricao: null },
        { slug: "valor_total", label: "Valor total", descricao: "R$ total da linha" },
        { slug: "praca_pedagio", label: "Praça de pedágio", descricao: null },
        { slug: "eixos", label: "Eixos", descricao: null },
        { slug: "ignorar", label: "Ignorar", descricao: "Coluna que não interessa" },
      ];
    }

    const listaCampos = camposAtivos
      .map(
        (c) =>
          `- ${c.slug}${c.descricao ? ` (${c.descricao})` : c.label ? ` — ${c.label}` : ""}`,
      )
      .join("\n");

    const tipoDescricao = (() => {
      if (tipoBloco === "PEDAGIO")
        return "pedágios (data, placa, praça/posto de pedágio, eixos, valor pago)";
      if (tipoBloco === "COMBUSTIVEL")
        return "abastecimentos de combustível (data, placa, posto, litros, valor, odômetro)";
      return "viagens detalhadas de carga (data, ticket, obra, placa, material, toneladas, km, valor)";
    })();
    const tipoNome = (() => {
      if (tipoBloco === "PEDAGIO") return "pedágios";
      if (tipoBloco === "COMBUSTIVEL") return "abastecimentos";
      return "viagens";
    })();

    const sysPrompt = `Você ajuda a interpretar planilhas de boletim de medição de transportadoras (fretes de caminhão).
Empresas-cliente mandam essas planilhas pra conferência. Cada planilha pode ter múltiplas abas com:
  - viagens (data, ticket, obra, placa, material, toneladas, km, valor)
  - pedágios (data, placa, praça, eixos, valor)
  - abastecimentos de combustível (data, placa, posto, litros, valor)
  - sumários, descontos, créditos

NESTA INFERÊNCIA, foque em encontrar a aba de **${tipoNome}** especificamente: ${tipoDescricao}. Ignore as outras abas (vão ser configuradas separadamente em outro momento).

Sua tarefa: analisar a amostra e devolver QUAL aba contém a relação detalhada de **${tipoNome}** (não o sumário),
QUAL linha tem os cabeçalhos, QUAL linha começa os dados, e MAPEAR cada coluna pra um campo padrão.

Campos padrão possíveis (use EXATAMENTE o slug, à esquerda do "—"):
${listaCampos}

Use "ignorar" pra colunas que não correspondem a nenhum campo da lista (subtotal, contrato, etc).

Responda APENAS um JSON válido sem cercas markdown, no formato:
{
  "tipoBloco": "viagens" | "pedagios" | "outro",
  "abaPreferida": "nome da aba que tem viagens detalhadas",
  "linhaCabecalho": número 1-based,
  "linhaInicioDados": número 1-based,
  "colunas": [{"letra": "A", "cabecalho": "DATA", "campo": "data"}, ...],
  "observacoes": "texto opcional"
}`;

    const userMsg = JSON.stringify(amostra, null, 2);
    const modelo = await this.modeloAtual();

    try {
      const res = await this.client.messages.create({
        model: modelo,
        max_tokens: 2000,
        system: sysPrompt,
        messages: [{ role: "user", content: userMsg }],
      });
      const text = res.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      const parsed = extractJson<LayoutInferenceResult>(text);
      return parsed;
    } catch (err) {
      this.log.error(`Falha na inferência de layout: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Recebe uma linha "órfã" (sem match determinístico) + viagens candidatas
   * (mesma placa, datas próximas) e pede pra IA propor um match com confidence.
   */
  async sugerirMatch(input: {
    linhaCliente: {
      data: string;
      placa: string;
      ticket: string;
      km?: number;
      toneladas?: number;
      valor?: number;
    };
    candidatas: CandidatoMatch[];
  }): Promise<SugestaoMatchResult | null> {
    if (!this.client) return null;
    if (input.candidatas.length === 0) {
      return { viagemId: null, confidence: 0, motivo: "sem candidatas no banco" };
    }

    const sysPrompt = `Você decide se uma linha de fechamento (planilha do cliente) corresponde a alguma viagem
do banco de dados da transportadora. Os dados raramente batem 100%: motorista pode esquecer detalhes,
empresa pode digitar errado, km pode considerar ou não a volta.

Analise:
- A linha do cliente
- As viagens candidatas (mesma placa, datas próximas)

Decida qual viagem é a mais provável correspondência, com confidence 0–1:
- 0.9+: bate placa+data+ticket exato ou quase exato
- 0.85–0.9: data e placa batem, ticket parecido (talvez digitação)
- 0.7–0.85: data/placa batem mas km diferente (provavelmente ida/volta não somada)
- 0.5–0.7: só placa bate, datas próximas
- <0.5: incerto, é melhor humano decidir

Se NENHUMA candidata fizer sentido, devolva viagemId=null e confidence baixa.

Responda APENAS um JSON válido:
{"viagemId": "uuid ou null", "confidence": 0.85, "motivo": "explicação curta em PT-BR"}`;

    const modelo = await this.modeloAtual();

    try {
      const res = await this.client.messages.create({
        model: modelo,
        max_tokens: 500,
        system: sysPrompt,
        messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
      });
      const text = res.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      return extractJson<SugestaoMatchResult>(text);
    } catch (err) {
      this.log.error(`Falha na sugestão de match: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * OCR de ticket de pesagem: envia foto + catálogos pra Claude vision,
   * recebe campos extraídos com IDs já mapeados quando reconhecíveis no
   * catálogo. Best-effort — chamadas que falham retornam confidence 0 +
   * campos vazios, sem trasher exception (motorista preenche manual).
   */
  async extrairTicket(args: {
    fotoBase64: string;
    mime: string;
    catalogos: {
      clientes: { id: string; nome: string }[];
      materiais: { id: string; nome: string }[];
      veiculos: { id: string; placa: string; modelo: string | null }[];
    };
  }): Promise<ExtrairTicketResult> {
    if (!this.client) {
      throw new Error("Anthropic API key não configurada");
    }

    const catalogoStr = JSON.stringify(
      {
        clientes: args.catalogos.clientes.map((c) => ({ id: c.id, nome: c.nome })),
        materiais: args.catalogos.materiais.map((m) => ({ id: m.id, nome: m.nome })),
        veiculos: args.catalogos.veiculos.map((v) => ({
          id: v.id,
          placa: v.placa,
          modelo: v.modelo,
        })),
      },
      null,
      0,
    );

    const sysPrompt = `Você lê tickets de pesagem (balança) de transporte de carga e extrai dados estruturados.
Tickets têm tipicamente: número do ticket, data, placa do veículo, peso (toneladas), cliente, material/produto, origem/destino, eventualmente km.

Catálogos do sistema (use os IDs daqui quando reconhecer):
${catalogoStr}

Retorne UM objeto JSON puro (sem markdown, sem texto antes/depois) com este schema:
{
  "ticket": "string ou null",            // número do ticket
  "toneladas": number ou null,           // em toneladas (converta de kg dividindo por 1000)
  "data": "YYYY-MM-DD ou null",
  "km": number ou null,                  // km rodados se aparecer
  "clienteId": "string ou null",         // ID do catálogo se reconhecer; senão null
  "clienteSugerido": "string ou null",   // nome bruto do cliente no ticket quando não casar com catálogo
  "materialId": "string ou null",
  "materialSugerido": "string ou null",
  "veiculoId": "string ou null",         // ID quando placa casar com catálogo
  "placaSugerida": "string ou null",     // placa bruta lida
  "observacoes": "string ou null",       // notas curtas (ex: "ticket borrado em parte")
  "confidence": number                    // 0..1 confiança geral da extração
}

Regras:
- Só preencha campos que conseguir ler com confiança. Em dúvida, deixe null.
- Se reconhecer nome do cliente/material/placa mas não casar 100% com catálogo, deixe Id null e preencha *Sugerido.
- Toneladas geralmente vem como peso líquido (líquido = bruto - tara).
- Confidence baixo (<0.5) quando foto está ruim/incompleta.`;

    const modelo = await this.modeloAtual();
    try {
      const resp = await this.client.messages.create({
        model: modelo,
        max_tokens: 1024,
        system: sysPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: args.mime as "image/jpeg" | "image/png" | "image/webp",
                  data: args.fotoBase64,
                },
              },
              { type: "text", text: "Extraia os campos deste ticket." },
            ],
          },
        ],
      });
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
      const parsed = extractJson<Record<string, unknown>>(text);
      if (!parsed) {
        this.log.warn("OCR ticket: resposta sem JSON válido");
        return { confidence: 0 };
      }

      // Defesa contra alucinação de IDs: valida que cada ID existe no catálogo enviado.
      const clienteIds = new Set(args.catalogos.clientes.map((c) => c.id));
      const materialIds = new Set(args.catalogos.materiais.map((m) => m.id));
      const veiculoIds = new Set(args.catalogos.veiculos.map((v) => v.id));

      const safeId = (
        raw: unknown,
        valido: Set<string>,
      ): string | undefined => {
        if (typeof raw !== "string" || !raw) return undefined;
        return valido.has(raw) ? raw : undefined;
      };
      const safeStr = (raw: unknown): string | undefined => {
        if (typeof raw !== "string" || !raw.trim()) return undefined;
        return raw.trim();
      };
      const safeNum = (raw: unknown): number | undefined => {
        if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
        return raw;
      };

      const confidence =
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0;

      return {
        ticket: safeStr(parsed.ticket),
        toneladas: safeNum(parsed.toneladas),
        data: safeStr(parsed.data),
        km: safeNum(parsed.km),
        clienteId: safeId(parsed.clienteId, clienteIds),
        clienteSugerido: safeStr(parsed.clienteSugerido),
        materialId: safeId(parsed.materialId, materialIds),
        materialSugerido: safeStr(parsed.materialSugerido),
        veiculoId: safeId(parsed.veiculoId, veiculoIds),
        placaSugerida: safeStr(parsed.placaSugerida),
        observacoes: safeStr(parsed.observacoes),
        confidence,
      };
    } catch (err) {
      this.log.warn(`OCR ticket falhou: ${(err as Error).message}`);
      throw err;
    }
  }
}

function extractJson<T>(text: string): T | null {
  // remove cercas markdown se vierem
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  // pega o primeiro { ... } ou [ ... ] equilibrado
  const start = cleaned.search(/[{[]/);
  if (start < 0) return null;
  const json = cleaned.slice(start);
  try {
    return JSON.parse(json) as T;
  } catch {
    // tenta extrair só até o primeiro fechamento balanceado
    let depth = 0;
    for (let i = 0; i < json.length; i++) {
      const c = json[i];
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(json.slice(0, i + 1)) as T;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
