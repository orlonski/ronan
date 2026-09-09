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
 *   CHATWOOT_WEBHOOK_URL — a URL que o Chatwoot mostra ao criar o canal
 *                          (`https://<chatwoot>/webhooks/whatsapp/<numero>`).
 *                          Vazia = repasse desligado, sem barulho.
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

  constructor(config: ConfigService) {
    this.url = (config.get<string>("CHATWOOT_WEBHOOK_URL") ?? "").trim();
    if (this.url) this.log.log(`repasse pro Chatwoot ligado (${esconderCaminho(this.url)})`);
  }

  configurado(): boolean {
    return this.url.length > 0;
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
  repassar(corpo: Buffer, assinatura?: string): void {
    if (!this.configurado()) return;
    void this.enviar(corpo, assinatura);
  }

  private async enviar(corpo: Buffer, assinatura?: string): Promise<void> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(this.url, {
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
          `Chatwoot recusou o repasse (${res.status}): ${detalhe.slice(0, 200)}`.trim(),
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
