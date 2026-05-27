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
      clientes: { id: string; nome: string; apelidos?: string[] }[];
      materiais: { id: string; nome: string; apelidos?: string[] }[];
      veiculos: { id: string; placa: string; modelo: string | null }[];
    };
  }): Promise<ExtrairTicketResult> {
    if (!this.client) {
      throw new Error("Anthropic API key não configurada");
    }

    const catalogoStr = JSON.stringify(
      {
        clientes: args.catalogos.clientes.map((c) => ({
          id: c.id,
          nome: c.nome,
          apelidos: c.apelidos ?? [],
        })),
        materiais: args.catalogos.materiais.map((m) => ({
          id: m.id,
          nome: m.nome,
          apelidos: m.apelidos ?? [],
        })),
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
  "toneladas": number ou null,           // PESO LÍQUIDO em toneladas (ver regras abaixo)
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

REGRAS DE PESO (importante — erro recorrente):
- O ticket geralmente mostra TRÊS valores: PESO BRUTO, TARA e PESO LÍQUIDO. Use SEMPRE o PESO LÍQUIDO em "toneladas". NUNCA o bruto, NUNCA a tara.
- Se só aparecerem dois valores (bruto e tara) sem líquido explícito, calcule: líquido = bruto − tara.
- Se aparecer um valor único de peso sem rótulo, assuma que é líquido.
- Converta de kg pra toneladas dividindo por 1000 (ex: 32.000 kg → 32 toneladas; 32500 kg → 32.5).
- Se o valor já vier em toneladas/t, use direto.

REGRAS DE MATCHING DE NOMES (cliente / material / placa):
- Cada item do catálogo tem "nome" e "apelidos" (array de variações conhecidas). SEMPRE compare contra nome+apelidos antes de desistir.
- Normalize antes de comparar: ignore caixa (lowercase), pontos, espaços, hífens, acentos. Ex: "C.B.U.Q" e "cbuq" são iguais; "São José" e "SAO JOSE" são iguais.
- Ignore sufixos descritivos como "FAIXA A/B/C", "TIPO 1/2", "GRUPO X", "GRADUAÇÃO Y" — esses qualificam o material mas não mudam a identidade. Ex: "C.B.U.Q FAIXA C" deve casar com catálogo "CBUQ".
- Se bater por qualquer forma (nome ou apelido, mesmo com sufixo extra), preencha o Id correspondente. Só use *Sugerido quando o ticket trouxer um nome que claramente não tem equivalente nenhum no catálogo.
- Para placa, normalize removendo hífen/espaço (ABC-1234 = ABC1234 = abc 1234).

OUTRAS REGRAS:
- Só preencha campos que conseguir ler com confiança. Em dúvida, deixe null.
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

      let clienteId = safeId(parsed.clienteId, clienteIds);
      let clienteSugerido = safeStr(parsed.clienteSugerido);
      let materialId = safeId(parsed.materialId, materialIds);
      let materialSugerido = safeStr(parsed.materialSugerido);
      let veiculoId = safeId(parsed.veiculoId, veiculoIds);
      let placaSugerida = safeStr(parsed.placaSugerida);

      // Fallback server-side: quando a IA admitiu não saber mas leu o texto bruto
      // (campo *Sugerido), tentamos fazer um match normalizado contra nome+apelidos
      // do catálogo. Cobre casos tipo "C.B.U.Q FAIXA C" vs "CBUQ" sem precisar
      // cadastrar apelidos.
      if (!clienteId && clienteSugerido) {
        const matched = matchPorNomeOuApelido(
          clienteSugerido,
          args.catalogos.clientes,
        );
        if (matched) {
          clienteId = matched;
          clienteSugerido = undefined;
        }
      }
      if (!materialId && materialSugerido) {
        const matched = matchPorNomeOuApelido(
          materialSugerido,
          args.catalogos.materiais,
        );
        if (matched) {
          materialId = matched;
          materialSugerido = undefined;
        }
      }
      if (!veiculoId && placaSugerida) {
        const placasCatalogo = args.catalogos.veiculos.map((v) => ({
          id: v.id,
          nome: v.placa,
        }));
        const matched = matchPorNomeOuApelido(placaSugerida, placasCatalogo);
        if (matched) {
          veiculoId = matched;
          placaSugerida = undefined;
        }
      }

      return {
        ticket: safeStr(parsed.ticket),
        toneladas: safeNum(parsed.toneladas),
        data: safeStr(parsed.data),
        km: safeNum(parsed.km),
        clienteId,
        clienteSugerido,
        materialId,
        materialSugerido,
        veiculoId,
        placaSugerida,
        observacoes: safeStr(parsed.observacoes),
        confidence,
      };
    } catch (err) {
      this.log.warn(`OCR ticket falhou: ${(err as Error).message}`);
      throw err;
    }
  }
}

/**
 * Normaliza string pra comparação fuzzy: lowercase + remove acentos +
 * remove tudo que não for letra/dígito. "C.B.U.Q FAIXA C" → "cbuqfaixac".
 */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Tenta achar um item do catálogo (por id+nome+apelidos) que case com o texto
 * bruto via normalização. Match exato após normalizar tem prioridade; fallback
 * é prefix (em qualquer direção) quando o alvo tem 4+ chars — conservador pra
 * evitar falsos positivos de strings muito curtas.
 */
function matchPorNomeOuApelido(
  bruto: string,
  catalogo: { id: string; nome: string; apelidos?: string[] }[],
): string | undefined {
  const alvo = normalizar(bruto);
  if (!alvo) return undefined;

  // Pass 1: match exato após normalização
  for (const item of catalogo) {
    if (normalizar(item.nome) === alvo) return item.id;
    for (const ap of item.apelidos ?? []) {
      if (normalizar(ap) === alvo) return item.id;
    }
  }

  // Pass 2: prefix match (cobre "CBUQ" vs "C.B.U.Q FAIXA C" → "cbuqfaixac")
  if (alvo.length >= 4) {
    for (const item of catalogo) {
      const candidatos = [item.nome, ...(item.apelidos ?? [])];
      for (const cand of candidatos) {
        const n = normalizar(cand);
        if (n.length < 4) continue;
        if (n.startsWith(alvo) || alvo.startsWith(n)) return item.id;
      }
    }
  }

  return undefined;
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
