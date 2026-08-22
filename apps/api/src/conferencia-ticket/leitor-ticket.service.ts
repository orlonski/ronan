import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigService } from "@nestjs/config";
import { UsoIaService } from "../ia/uso-ia.service";
import { calcularUso } from "../common/ia/uso-ia";
import type { Lido } from "../common/conferencia-ticket";

/**
 * Lê um ticket já sabendo o que o motorista declarou.
 *
 * A diferença pro OCR do app não é de prompt, é de tarefa: lá o modelo extrai
 * do zero e precisa do catálogo pra reconhecer nomes; aqui ele **confere**
 * contra valores que já temos, então o catálogo não vai junto e a saída é curta.
 * É por isso que esta chamada é a mais barata das duas.
 */

const MODELO_PADRAO = "claude-haiku-4-5-20251001";

/**
 * Instruções fixas. Sem prompt caching — o mínimo cacheável do Haiku 4.5 é 4096
 * tokens e uma conferência inteira não chega perto —, então cada palavra aqui é
 * paga em toda leitura.
 */
const INSTRUCOES = `Você confere tickets de pesagem (balança) de transporte de carga.

Recebe a FOTO de um ticket e o que o motorista LANÇOU no sistema. Sua tarefa é
dizer o que está escrito no ticket — não julgar se o motorista errou. Quem
compara é o sistema, depois de você.

Responda APENAS um JSON puro (sem markdown, sem texto em volta):
{
  "ticket": "string ou null",       // número do ticket, como impresso
  "toneladas": number ou null,      // PESO LÍQUIDO em toneladas
  "data": "AAAA-MM-DD ou null",     // data da pesagem
  "placa": "string ou null",        // placa do veículo no ticket
  "cliente": "string ou null",      // nome do cliente/obra como está no ticket
  "material": "string ou null",     // material como está no ticket
  "legivel": true|false,            // false se a foto não dá pra ler
  "confidence": number              // 0..1 — o quanto você confia NA SUA LEITURA
}

PESO — o erro mais caro:
- O ticket mostra BRUTO, TARA e LÍQUIDO. Use SEMPRE o LÍQUIDO.
- Rótulos variam: "LIQUIDO", "LÍQ.", "PESO LIQ", "NET", "CARGA" são o líquido.
- Só bruto e tara, sem líquido: calcule bruto − tara.
- Converta kg para toneladas dividindo por 1000.
- Caminhão carregado fica entre 5 e 50 toneladas. Fora disso, revise sua leitura.

NÚMEROS EM FORMATO BRASILEIRO:
- Ponto é separador de MILHAR, vírgula é DECIMAL. "32.500" é trinta e dois mil e
  quinhentos, não 32,5.
- "32.500 KG" = 32500 kg = 32.5 toneladas. "32,500 T" = 32,5 toneladas.
- No JSON use ponto decimal e nada de separador de milhar: 32.5.

DATA:
- Formato brasileiro DD/MM/AAAA: "03/04/2026" é 3 de abril.
- Havendo mais de uma data, prefira a da PESAGEM/SAÍDA.

CONFIANÇA — leia com atenção, é o que protege o motorista:
- confidence alta (0.8+) só quando você leu o campo com clareza.
- Foto borrada, cortada, escura ou amassada: confidence baixa e "legivel": false
  quando não der pra ler mesmo.
- Campo que você NÃO conseguiu ler com certeza vai como null. Null é MUITO
  melhor que um palpite: um palpite errado faz o sistema cobrar um motorista
  que não errou nada.
- Nunca copie um valor do que o motorista lançou só porque ele lançou. Se o
  ticket não mostra, é null.`;

@Injectable()
export class LeitorTicketService {
  private readonly log = new Logger(LeitorTicketService.name);
  private client?: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly uso: UsoIaService,
  ) {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (apiKey) {
      this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
    }
  }

  get disponivel(): boolean {
    return !!this.client;
  }

  /**
   * Lê a foto. Devolve o que leu + o custo, ou lança se a chamada falhar (o
   * worker distingue falha de infra de resultado ruim).
   */
  async ler(args: {
    fotoBase64: string;
    mime: string;
    declarado: Record<string, unknown>;
    modelo?: string;
  }): Promise<{ lido: Lido; custoUsd: number; modelo: string; legivel: boolean }> {
    if (!this.client) throw new Error("ANTHROPIC_API_KEY não configurada");
    const modelo = args.modelo || MODELO_PADRAO;
    const t0 = Date.now();

    try {
      const resp = await this.client.messages.create({
        model: modelo,
        max_tokens: 400,
        system: INSTRUCOES,
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
              {
                type: "text",
                text:
                  `O motorista lançou: ${JSON.stringify(args.declarado)}\n\n` +
                  "Leia o ticket da foto e responda o JSON.",
              },
            ],
          },
        ],
      });

      const uso = calcularUso(modelo, resp.usage);
      this.uso.registrar({
        escopo: "conferencia",
        modelo,
        usage: resp.usage,
        duracaoMs: Date.now() - t0,
      });

      const texto = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n");
      const parsed = extrairJson(texto);
      if (!parsed) {
        this.log.warn("Conferência: resposta sem JSON válido");
        return {
          lido: { confianca: 0 },
          custoUsd: uso.custoUsd ?? 0,
          modelo,
          legivel: false,
        };
      }

      return {
        lido: {
          ticket: str(parsed.ticket),
          toneladas: num(parsed.toneladas),
          data: str(parsed.data),
          placa: str(parsed.placa),
          clienteNome: str(parsed.cliente),
          materialNome: str(parsed.material),
          confianca: clamp01(parsed.confidence),
        },
        custoUsd: uso.custoUsd ?? 0,
        modelo,
        legivel: parsed.legivel !== false,
      };
    } catch (err) {
      this.uso.registrar({
        escopo: "conferencia",
        modelo,
        duracaoMs: Date.now() - t0,
        sucesso: false,
        erro: (err as Error).message,
      });
      throw err;
    }
  }
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const clamp01 = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

/** Tolerante a cerca markdown e a texto solto em volta do objeto. */
export function extrairJson(texto: string): Record<string, unknown> | null {
  const limpo = texto.replace(/```(?:json)?/gi, "").trim();
  const inicio = limpo.indexOf("{");
  if (inicio < 0) return null;
  const resto = limpo.slice(inicio);
  try {
    return JSON.parse(resto) as Record<string, unknown>;
  } catch {
    // Corta no primeiro fechamento balanceado — cobre resposta truncada.
    let nivel = 0;
    for (let i = 0; i < resto.length; i++) {
      if (resto[i] === "{") nivel++;
      else if (resto[i] === "}") {
        nivel--;
        if (nivel === 0) {
          try {
            return JSON.parse(resto.slice(0, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
