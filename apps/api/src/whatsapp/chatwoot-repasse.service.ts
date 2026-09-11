import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Repassa pro Chatwoot o evento que a Meta entregou nesta API.
 *
 * Existe porque a Meta aceita UMA URL de webhook por app, e essa URL é a nossa:
 * é ela que carimba status de entrega e avisa template reprovado. Apontar a
 * Meta direto pro Chatwoot ganharia o atendimento humano e perderia as duas
 * coisas — em silêncio, que é o pior jeito de perder.
 *
 * Então a API continua sendo o webhook oficial e faz o fan-out: processa o que
 * é dela e devolve o mesmo corpo, byte a byte, pro Chatwoot.
 *
 * Env var:
 *   CHATWOOT_WEBHOOK_URL  — a URL que o Chatwoot mostra ao criar o canal
 *                           (`https://<chatwoot>/webhooks/whatsapp/<numero>`).
 *                           Vazia = repasse desligado, sem barulho.
 *   CHATWOOT_WEBHOOK_URLS — com MAIS DE UM número, o mapa
 *                           `phone_number_id=url,phone_number_id=url`.
 *
 * **Por que o mapa existe.** A URL do Chatwoot carrega o número dentro dela, e
 * cada inbox só aceita o que é dele: mandar o evento do número comercial pra
 * URL do transacional não cai no lugar errado — toma 404 e some. Com um número
 * só isso não podia acontecer; com o comercial ao lado do transacional, uma URL
 * fixa significaria perder metade das conversas em silêncio.
 *
 * Configurado o mapa, número que não está nele NÃO é repassado: entregar no
 * inbox errado é pior que não entregar, porque o atendente responde achando que
 * fala com outra pessoa. Sem mapa, tudo vai pra URL única, como antes.
 */

/**
 * Curto de propósito. Quem espera do outro lado é a Meta, que exige 200 rápido
 * e desliga o webhook depois de muito tempo de espera. O repasse é disparado
 * sem `await` justamente pra não entrar nessa conta, e o timeout é a segunda
 * trava: garante que um Chatwoot pendurado não deixe conexão vazando.
 */
const TIMEOUT_MS = 5000;

@Injectable()
export class ChatwootRepasseService {
  private readonly log = new Logger("ChatwootRepasse");
  private readonly url: string;
  private readonly porNumero: Map<string, string>;

  constructor(config: ConfigService) {
    this.url = (config.get<string>("CHATWOOT_WEBHOOK_URL") ?? "").trim();
    this.porNumero = lerMapa(config.get<string>("CHATWOOT_WEBHOOK_URLS"));
    if (this.porNumero.size) {
      this.log.log(
        `repasse pro Chatwoot ligado em ${this.porNumero.size} número(s): ` +
          [...this.porNumero.keys()].join(", "),
      );
    } else if (this.url) {
      this.log.log(`repasse pro Chatwoot ligado (${esconderCaminho(this.url)})`);
    }
  }

  configurado(): boolean {
    return this.porNumero.size > 0 || this.url.length > 0;
  }

  /**
   * Pra qual inbox vai o evento deste número.
   *
   * Devolve `null` quando há mapa e o número não está nele — o chamador loga e
   * não entrega. É de propósito: conversa no inbox errado vira atendente
   * respondendo a pessoa errada.
   */
  private destino(phoneNumberId?: string): string | null {
    if (!this.porNumero.size) return this.url || null;
    if (!phoneNumberId) return null;
    return this.porNumero.get(phoneNumberId) ?? null;
  }

  /**
   * Dispara o repasse e volta na hora — o retorno é `void` porque ninguém deve
   * esperar por ele. Falha aqui não pode virar erro lá: o handler da Meta já
   * respondeu 200, e transformar um Chatwoot fora do ar em não-200 faria a Meta
   * reenviar (e eventualmente desligar) o webhook que carrega os status.
   *
   * O corpo vai CRU e a assinatura vai junto: reserializar o JSON mudaria
   * espaço e ordem de chave, e o `X-Hub-Signature-256` que o Chatwoot pode
   * conferir deixaria de bater.
   */
  repassar(corpo: Buffer, assinatura?: string, numeros: string[] = []): void {
    if (!this.configurado()) return;

    // Um POST da Meta pode trazer eventos de números diferentes. Cada destino
    // recebe o corpo INTEIRO, uma vez só: o Chatwoot descarta o que não é do
    // inbox dele, e reserializar pra separar quebraria a assinatura.
    const alvos = new Set<string>();
    const desconhecidos: string[] = [];
    for (const n of numeros.length ? numeros : [undefined]) {
      const url = this.destino(n);
      if (url) alvos.add(url);
      else if (n) desconhecidos.push(n);
    }

    if (desconhecidos.length) {
      this.log.warn(
        `número ${desconhecidos.join(", ")} não está em CHATWOOT_WEBHOOK_URLS — ` +
          "evento não repassado (inbox faltando?)",
      );
    }

    for (const url of alvos) void this.enviar(corpo, assinatura, url);
  }

  private async enviar(corpo: Buffer, assinatura: string | undefined, url: string): Promise<void> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(assinatura ? { "X-Hub-Signature-256": assinatura } : {}),
        },
        body: corpo,
        signal: ac.signal,
      });

      if (!res.ok) {
        // 404 aqui quase sempre é o número na URL diferente do número que
        // registrou o canal no Chatwoot — vale o log com o status.
        const detalhe = await res.text().catch(() => "");
        this.log.error(
          `Chatwoot recusou o repasse pra ${esconderCaminho(url)} (${res.status}): ` +
            detalhe.slice(0, 200).trim(),
        );
      }
    } catch (e) {
      const msg =
        (e as Error).name === "AbortError"
          ? `Chatwoot não respondeu em ${TIMEOUT_MS / 1000}s`
          : (e as Error).message;
      this.log.error(`falha ao repassar pro Chatwoot: ${msg}`);
    } finally {
      clearTimeout(t);
    }
  }
}

/** A URL do webhook carrega o número; no log fica só o host. */
function esconderCaminho(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "url inválida";
  }
}

/**
 * Lê `phone_number_id=url,phone_number_id=url`.
 *
 * Entrada torta não derruba o repasse: o par que não dá pra ler é ignorado com
 * aviso, e os outros seguem valendo. Vírgula e espaço à vontade — a variável é
 * digitada na mão no painel do Easypanel.
 */
function lerMapa(bruto?: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const par of (bruto ?? "").split(",")) {
    const texto = par.trim();
    if (!texto) continue;
    const corte = texto.indexOf("=");
    const id = corte > 0 ? texto.slice(0, corte).trim() : "";
    const url = corte > 0 ? texto.slice(corte + 1).trim() : "";
    if (!id || !url) continue;
    mapa.set(id, url);
  }
  return mapa;
}
