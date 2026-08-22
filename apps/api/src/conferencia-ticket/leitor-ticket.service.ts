import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigService } from "@nestjs/config";
import { UsoIaService } from "../ia/uso-ia.service";
import { calcularUso } from "../common/ia/uso-ia";
import type { Lido, JulgamentoIa } from "../common/conferencia-ticket";

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
const INSTRUCOES = `Você confere documentos de carga (ticket de balança, romaneio, nota fiscal) contra o que o motorista lançou no sistema.

Recebe a FOTO do documento e os dados LANÇADOS. Sua tarefa é dizer, campo a
campo, se o que está no papel corresponde ao que foi lançado — usando bom senso
de quem trabalha com transporte, não comparação de texto.

Responda APENAS um JSON puro (sem markdown, sem texto em volta):
{
  "tipoDocumento": "ticket_balanca" | "nota_fiscal" | "romaneio" | "outro",
  "legivel": true|false,
  "confidence": number,          // 0..1 — o quanto você confia na SUA LEITURA

  "numeroDocumento": "string ou null",   // o número que IDENTIFICA este documento
  "toneladas": number ou null,           // PESO LÍQUIDO em toneladas
  "data": "AAAA-MM-DD ou null",
  "placa": "string ou null",
  "cliente": "string ou null",
  "material": "string ou null",

  "conferencia": {
    "numeroDocumento": { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
    "toneladas":       { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
    "data":            { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
    "placa":           { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
    "cliente":         { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" },
    "material":        { "confere": "sim"|"nao"|"incerto", "porque": "frase curta" }
  }
}

QUAL NÚMERO COMPARAR — depende do documento:
- Ticket de balança: o número do ticket/romaneio/pesagem.
- Nota fiscal: o número da NF. Não confunda com número de pedido, série, chave
  de acesso ou número do ticket que às vezes vem impresso junto.
- Se o papel traz VÁRIOS números e um deles é igual ao lançado, é quase certo
  que o motorista digitou aquele: responda "sim" e diga qual era.
- Prefixo de série, ponto, hífen e zero à esquerda são jeito de imprimir:
  "TKB-043625" e "043625" são o mesmo documento.

CLIENTE E MATERIAL — julgue como gente, não como texto:
- Razão social contra nome curto é a MESMA empresa: "BRONZE PAVIMENTAÇÕES LTDA"
  e "Construtora Bronze" conferem. "CASTILHO" e "CONSTRUTORA CASTILHO" conferem.
- Nome técnico contra nome comercial é o MESMO material: "C.B.U.Q. FAIXA C" e
  "MASSA DE ASFALTO" conferem (CBUQ é concreto betuminoso usinado a quente, que
  é massa asfáltica). "BGS" e "BRITA GRADUADA SIMPLES" conferem.
- Faixa, tipo, graduação e granulometria qualificam o material, não mudam o que
  ele é: "BRITA 1" e "BRITA" conferem.
- O documento costuma trazer o nome da PEDREIRA, da OBRA ou do destino, que não
  é o cliente do frete. Nesse caso responda "incerto", não "nao".
- Só responda "nao" quando forem claramente coisas diferentes — areia contra
  asfalto, uma construtora contra outra construtora sem nenhuma relação.

PESO — o erro mais caro:
- O ticket mostra BRUTO, TARA e LÍQUIDO. Use SEMPRE o LÍQUIDO.
- Rótulos variam: "LIQUIDO", "LÍQ.", "PESO LIQ", "NET", "CARGA".
- Só bruto e tara, sem líquido: calcule bruto − tara.
- Ponto é separador de MILHAR e vírgula é DECIMAL: "32.500 KG" = 32500 kg =
  32.5 toneladas. No JSON use ponto decimal, sem separador de milhar.
- Caminhão carregado fica entre 5 e 50 toneladas. Fora disso, revise sua leitura.
- Diferença de algumas dezenas de quilos é arredondamento de balança: "sim".

DATA: formato brasileiro DD/MM/AAAA. Um dia de diferença é rotina (pesagem à
noite, lançamento no dia seguinte): responda "sim". Havendo várias datas,
prefira a da PESAGEM/SAÍDA.

PLACA: ignore hífen e espaço. Se o documento traz a placa da CARRETA e o
lançamento é do cavalo mecânico, responda "incerto" — não é caminhão errado.

REGRA QUE VALE MAIS QUE TODAS AS OUTRAS:
Quem lê isto é um motorista parceiro, e ele pode estar certo mesmo quando o
papel parece dizer outra coisa. Responda "nao" apenas quando tiver certeza de
que o lançamento não corresponde ao documento. Na menor dúvida — foto ruim,
campo cortado, nome que você não reconhece, número que aparece mais de uma vez —
responda "incerto". Um "incerto" manda o caso pra um humano olhar, o que é
barato. Um "nao" errado acusa alguém honesto, o que não é.`;

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
  }): Promise<{
    lido: Lido;
    julgamento: JulgamentoIa;
    custoUsd: number;
    modelo: string;
    legivel: boolean;
    /**
     * Por que a leitura não serviu. `null` quando serviu.
     *
     * Existe porque "confiança 0%" juntava três coisas que pedem desfechos
     * opostos: resposta que não parseou (defeito nosso, retenta), foto que não
     * dá pra ler (o motorista precisa mandar outra) e leitura fraca mas
     * aproveitável (humano olha). Tratar as três como a mesma coisa deixava
     * todas paradas na fila de revisão sem ninguém saber o que fazer.
     */
    falha: "resposta-invalida" | "foto-ilegivel" | null;
  }> {
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
          julgamento: {},
          custoUsd: uso.custoUsd ?? 0,
          modelo,
          legivel: false,
          // Não é foto ruim: o modelo respondeu algo que não é o JSON pedido.
          // Isso é defeito de execução e merece outra tentativa, não uma
          // cobrança de foto nova ao motorista.
          falha: "resposta-invalida",
        };
      }

      const legivel = parsed.legivel !== false;
      return {
        falha: legivel ? null : "foto-ilegivel",
        julgamento: lerJulgamento(parsed.conferencia),
        lido: {
          tipoDocumento: str(parsed.tipoDocumento),
          ticket: str(parsed.numeroDocumento) ?? str(parsed.ticket),
          toneladas: num(parsed.toneladas),
          data: str(parsed.data),
          placa: str(parsed.placa),
          clienteNome: str(parsed.cliente),
          materialNome: str(parsed.material),
          confianca: clamp01(parsed.confidence),
        },
        custoUsd: uso.custoUsd ?? 0,
        modelo,
        legivel,
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

/**
 * O parecer da IA, campo a campo.
 *
 * Vem separado do que ela LEU de propósito: o que ela leu vai pra tela, pra
 * pessoa comparar com os próprios olhos; o parecer é o que decide o veredito.
 * Qualquer valor que não seja exatamente "sim" ou "nao" vira `incerto` — na
 * dúvida, humano olha.
 */
function lerJulgamento(bruto: unknown): JulgamentoIa {
  const j: JulgamentoIa = {};
  if (!bruto || typeof bruto !== "object") return j;
  const campos = ["numeroDocumento", "toneladas", "data", "placa", "cliente", "material"] as const;
  for (const campo of campos) {
    const item = (bruto as Record<string, unknown>)[campo];
    if (!item || typeof item !== "object") continue;
    const confere = (item as Record<string, unknown>).confere;
    const porque = (item as Record<string, unknown>).porque;
    j[campo] = {
      confere: confere === "sim" ? "sim" : confere === "nao" ? "nao" : "incerto",
      porque: typeof porque === "string" ? porque.slice(0, 300) : "",
    };
  }
  return j;
}
