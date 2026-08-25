import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ExtrairTicketResult } from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { CachePorConta } from "../common/conta/cache-por-conta";
import { UsoIaService } from "./uso-ia.service";

// Default usado caso ConfiguracaoIa.modelo não esteja setada (raro).
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Teto por chamada. Uma leitura de ticket resolve em poucos segundos; passar
 * disso é sinal de problema, não de imagem difícil. O default do SDK (10 min)
 * deixaria o motorista esperando por nada.
 */
const TIMEOUT_ANTHROPIC_MS = 60_000;

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
  ticket: string | null;
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
    private readonly uso: UsoIaService,
  ) {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (apiKey) {
      // Timeout e retries explícitos. O default do SDK é 10 min por tentativa e
      // 2 retries — até 30 min de relógio numa chamada só. Num endpoint que o
      // motorista está esperando isso é inaceitável, e num worker é pior ainda:
      // segura uma vaga de execução pelo mesmo tempo.
      this.client = new Anthropic({
        apiKey,
        timeout: TIMEOUT_ANTHROPIC_MS, // milissegundos no SDK TS
        maxRetries: 1,
      });
    }
  }

  /**
   * Lê o modelo da config da conta; cache curto pra não consultar a cada call.
   *
   * O cache é POR CONTA, e o `CachePorConta` guarda o porquê: era um campo
   * único de instância num provider singleton, o que fazia a primeira conta a
   * chamar fixar o modelo de todas as outras.
   */
  private readonly modeloCache = new CachePorConta<string>("ConfiguracaoIa.modelo");
  private async modeloAtual(): Promise<string> {
    return this.modeloCache.obter(async (contaId) => {
      const cfg = await this.prisma.configuracaoIa.upsert({
        where: { contaId },
        update: {},
        create: {},
      });
      return cfg.modelo || DEFAULT_MODEL;
    }, DEFAULT_MODEL);
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

    const t0 = Date.now();
    try {
      const res = await this.client.messages.create({
        model: modelo,
        max_tokens: 2000,
        system: sysPrompt,
        messages: [{ role: "user", content: userMsg }],
      });
      this.uso.registrar({
        escopo: "layout",
        modelo,
        usage: res.usage,
        duracaoMs: Date.now() - t0,
      });
      const text = res.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      const parsed = extractJson<LayoutInferenceResult>(text);
      return parsed;
    } catch (err) {
      this.uso.registrar({
        escopo: "layout",
        modelo,
        duracaoMs: Date.now() - t0,
        sucesso: false,
        erro: (err as Error).message,
      });
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

    const t0 = Date.now();
    try {
      const res = await this.client.messages.create({
        model: modelo,
        max_tokens: 500,
        system: sysPrompt,
        messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
      });
      this.uso.registrar({
        escopo: "match",
        modelo,
        usage: res.usage,
        duracaoMs: Date.now() - t0,
      });
      const text = res.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      return extractJson<SugestaoMatchResult>(text);
    } catch (err) {
      this.uso.registrar({
        escopo: "match",
        modelo,
        duracaoMs: Date.now() - t0,
        sucesso: false,
        erro: (err as Error).message,
      });
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

    const catalogoStr = catalogoCompacto(args.catalogos);

    const modelo = await this.modeloAtual();
    const t0 = Date.now();
    try {
      const resp = await this.client.messages.create({
        model: modelo,
        max_tokens: 1024,
        // Dois blocos: as instruções, idênticas em toda chamada, e o catálogo,
        // que muda a cada cadastro novo. A ordem importa se um dia isto for
        // cacheável — o que HOJE NÃO É, e o motivo está registrado abaixo.
        //
        // ⚠️ NÃO ponha `cache_control` aqui enquanto o modelo for Haiku 4.5.
        // O prefixo mínimo cacheável dele é 4096 tokens, e uma leitura inteira
        // (imagem ~1.600 + instruções ~1.300 + catálogo ~600) dá ~3.500. Ou
        // seja: o prompt COMPLETO não alcança o mínimo, então nenhum
        // breakpoint cacheia coisa alguma. A API não reclama — devolve
        // `cache_creation_input_tokens: 0` e segue cobrando cheio, que foi
        // exatamente o que aconteceu aqui (5 leituras, zero cache).
        //
        // O mínimo NÃO é monotônico entre modelos: Sonnet 4.5/5 pedem 1024 e
        // Opus 5 pede 512. Se um dia o modelo mudar, reavaliar — mas medindo
        // `tokensCacheEscrita` em `usos_ia`, não no chute (foi o chute de 1024
        // que inflou este prompt à toa).
        system: [
          { type: "text", text: INSTRUCOES_TICKET },
          { type: "text", text: catalogoStr },
        ],
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
      this.uso.registrar({
        escopo: "ocr-app",
        modelo,
        usage: resp.usage,
        duracaoMs: Date.now() - t0,
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
      // Falha também é medida: a Anthropic cobra o que processou antes de
      // estourar, e uma sequência de falhas é justamente o que precisa aparecer
      // no relatório — hoje o OCR pode estar fora do ar por dias sem ninguém ver.
      this.uso.registrar({
        escopo: "ocr-app",
        modelo,
        duracaoMs: Date.now() - t0,
        sucesso: false,
        erro: (err as Error).message,
      });
      this.log.warn(`OCR ticket falhou: ${(err as Error).message}`);
      throw err;
    }
  }
}

/**
 * As instruções do OCR de ticket, fixas e fora do método de propósito.
 *
 * Prompt caching é casamento de PREFIXO byte a byte: qualquer variação invalida
 * tudo daí pra frente. Por isso este texto é uma constante de módulo, sem
 * interpolação nenhuma — é ele que leva o `cache_control`, e é ele que todas as
 * contas e todos os motoristas compartilham.
 *
 * O catálogo NÃO mora aqui: ele muda a cada cliente cadastrado, e mantê-lo
 * separado deixa este texto estável entre chamadas.
 *
 * Não há prompt caching neste fluxo — ver o comentário no `system` da chamada
 * pro motivo (Haiku 4.5 pede 4096 tokens de prefixo e a leitura inteira dá
 * ~3.500). Portanto **cada palavra aqui é paga em toda leitura**: só entra
 * texto que melhore o que o modelo lê. As regras de formato numérico
 * brasileiro, por exemplo, pagam-se sozinhas — confundir "32.500" com 32,5
 * erra o peso por mil vezes, e peso é o que vira dinheiro.
 */
const INSTRUCOES_TICKET = `Você lê tickets de pesagem (balança) de transporte de carga e extrai dados estruturados.
Tickets têm tipicamente: número do ticket, data, placa do veículo, peso (toneladas), cliente, material/produto, origem/destino, eventualmente km.

Retorne UM objeto JSON puro (sem markdown, sem texto antes/depois) com este schema:
{
  "ticket": "string ou null",            // número do ticket
  "toneladas": number ou null,           // PESO LÍQUIDO em toneladas (ver regras abaixo)
  "data": "YYYY-MM-DD ou null",
  "km": number ou null,                  // km rodados se aparecer
  "clienteSugerido": "string ou null",   // ver REGRAS DE NOMES
  "materialSugerido": "string ou null",
  "placaSugerida": "string ou null",     // placa lida no ticket
  "observacoes": "string ou null",       // notas curtas (ex: "ticket borrado em parte")
  "confidence": number                    // 0..1 confiança geral da extração
}

REGRAS DE PESO (importante — erro recorrente):
- O ticket geralmente mostra TRÊS valores: PESO BRUTO, TARA e PESO LÍQUIDO. Use SEMPRE o PESO LÍQUIDO em "toneladas". NUNCA o bruto, NUNCA a tara.
- Os rótulos variam: "LIQUIDO", "LÍQ.", "PESO LIQ", "NET", "CARGA" são todos o líquido. "BRUTO"/"GROSS"/"PBT" e "TARA"/"TARE" são os outros dois.
- Se só aparecerem dois valores (bruto e tara) sem líquido explícito, calcule: líquido = bruto − tara.
- Se aparecer um valor único de peso sem rótulo, assuma que é líquido.
- Converta de kg pra toneladas dividindo por 1000 (ex: 32.000 kg → 32 toneladas; 32500 kg → 32.5).
- Se o valor já vier em toneladas/t, use direto.
- Peso de caminhão carregado vive entre 5 e 50 toneladas. Se o seu número saiu muito fora disso, você provavelmente leu a unidade errada ou pegou o bruto — reveja antes de responder.

NÚMEROS EM FORMATO BRASILEIRO (a armadilha mais cara aqui):
- O separador de MILHAR é o ponto e o de DECIMAL é a vírgula — o contrário do inglês. "32.500" é trinta e dois mil e quinhentos, NÃO trinta e dois vírgula cinco.
- Então: "32.500 KG" = 32500 kg = 32.5 toneladas. E "32,500 T" = 32,5 toneladas. Os dois dão o mesmo resultado por caminhos diferentes; confundir a regra erra por mil vezes.
- No JSON que você devolve, use SEMPRE ponto decimal e nunca separador de milhar: 32.5, nunca "32,5" e nunca 32.500.
- Balança costuma imprimir o peso em kg, com 0 ou 2 casas. Um valor como "32.480" quase sempre é 32480 kg = 32.48 toneladas.

DATA:
- Formato brasileiro: DD/MM/AAAA. "03/04/2026" é 3 de abril, não 4 de março.
- Ano com 2 dígitos ("03/04/26") vira 2026. Devolva sempre em AAAA-MM-DD.
- Se houver mais de uma data no ticket (emissão, entrada, saída, vencimento), prefira a da PESAGEM/SAÍDA — é a que corresponde à viagem.
- Hora não entra; só a data.

NÚMERO DO TICKET:
- Aparece como "TICKET", "Nº", "ROMANEIO", "NOTA", "CONTROLE", "SEQ" ou só um número grande em destaque no topo.
- Copie exatamente como está impresso, inclusive zeros à esquerda e letras. Não normalize, não tire pontuação, não converta pra número.
- Se houver vários números candidatos, prefira o que estiver rotulado como ticket/romaneio; na dúvida entre dois sem rótulo, deixe null.

REGRAS DE NOMES (cliente / material / placa):
- Depois das instruções vem a lista de nomes já cadastrados no sistema, um por linha, com as variações conhecidas separadas por "|".
- Quando o que você leu no ticket corresponder a um item da lista, devolva o **primeiro nome daquela linha, copiado exatamente como está escrito lá**. É assim que o sistema liga o ticket ao cadastro.
- Quando não corresponder a nada da lista, devolva o texto bruto que você leu no ticket. Não invente e não force parecença.
- Pra comparar, ignore caixa, pontos, espaços, hífens e acentos: "C.B.U.Q" = "cbuq"; "São José" = "SAO JOSE".
- Ignore sufixos que só qualificam o material e não mudam a identidade: "FAIXA A/B/C", "TIPO 1/2", "GRUPO X", "GRADUAÇÃO Y". Ex.: "C.B.U.Q FAIXA C" corresponde ao item "CBUQ".
- Razão social costuma vir por extenso no ticket e curta no cadastro: "PEDREIRA SÃO JOÃO LTDA - ME" corresponde ao item "São João". Nome contido no outro conta como correspondência.
- Placa: normalize removendo hífen e espaço (ABC-1234 = ABC1234 = abc 1234). Devolva sempre em "placaSugerida".

OUTRAS REGRAS:
- Só preencha campos que conseguir ler com confiança. Em dúvida, deixe null — campo vazio é MUITO melhor que campo errado, porque quem lançou vai conferir o que você preencheu.
- confidence abaixo de 0.5 quando a foto está ruim, cortada ou borrada; abaixo de 0.3 quando você mal conseguiu ler.
- Se a imagem não for um ticket de pesagem, devolva todos os campos null e confidence 0.`;

/**
 * O catálogo, no formato mais barato que ainda deixa o modelo reconhecer nome.
 *
 * Antes ia como JSON com UUID em cada item — e o UUID é ~14 tokens que não
 * ajudam a IA a reconhecer absolutamente nada, só a devolver um id pronto.
 * Trocar por "nome|apelido|apelido" corta a maior parte do peso do catálogo,
 * e quem resolve nome → id passa a ser `matchPorNomeOuApelido` aqui no
 * servidor, que já existia como fallback e é testável.
 */
function catalogoCompacto(catalogos: {
  clientes: { nome: string; apelidos?: string[] }[];
  materiais: { nome: string; apelidos?: string[] }[];
  veiculos: { placa: string }[];
}): string {
  const linhas = (itens: { nome: string; apelidos?: string[] }[]) =>
    itens
      .map((i) => [i.nome, ...(i.apelidos ?? [])].filter(Boolean).join("|"))
      .join("\n");

  return [
    "Cadastrados no sistema (primeiro nome da linha = o que devolver):",
    "",
    "CLIENTES:",
    linhas(catalogos.clientes) || "(nenhum)",
    "",
    "MATERIAIS:",
    linhas(catalogos.materiais) || "(nenhum)",
    "",
    "PLACAS:",
    catalogos.veiculos.map((v) => v.placa).join("\n") || "(nenhuma)",
  ].join("\n");
}

/**
 * Normaliza string pra comparação fuzzy: lowercase + remove acentos +
 * remove tudo que não for letra/dígito. "C.B.U.Q FAIXA C" → "cbuqfaixac".
 */
export function normalizar(s: string): string {
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
export function matchPorNomeOuApelido(
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

  // Pass 2: correspondência parcial — prefixo (cobre "CBUQ" vs "C.B.U.Q FAIXA
  // C" → "cbuqfaixac") ou um contido no outro em qualquer posição, que é o caso
  // da razão social: vem por extenso no ticket e curta no cadastro. "PEDREIRA
  // SÃO JOÃO LTDA - ME" contém "São João" no MEIO, onde prefixo não alcança.
  //
  // **Vence o candidato mais longo**, e não o primeiro encontrado. Sem isso,
  // "BRITA GRADUADA SIMPLES" casava com "Brita" ou com "Brita Graduada"
  // conforme a ordem em que os materiais saíram do banco — e material errado
  // muda o preço da viagem. Ganha quem explica mais do texto lido.
  //
  // Guarda de tamanho: prefixo aceita a partir de 4 caracteres; "contido em",
  // que casa por acaso com muito mais facilidade, exige 6.
  if (alvo.length >= 4) {
    let melhorId: string | undefined;
    let melhorTam = 0;

    for (const item of catalogo) {
      for (const cand of [item.nome, ...(item.apelidos ?? [])]) {
        const n = normalizar(cand);
        if (n.length < 4 || n.length <= melhorTam) continue;

        const prefixo = n.startsWith(alvo) || alvo.startsWith(n);
        const contido = n.length >= 6 && alvo.length >= 6 && (alvo.includes(n) || n.includes(alvo));

        if (prefixo || contido) {
          melhorId = item.id;
          melhorTam = n.length;
        }
      }
    }
    if (melhorId) return melhorId;
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
