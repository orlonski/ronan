import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * O pouco que a gente precisa da API do Chatwoot: responder numa conversa e
 * entregá-la pra um humano.
 *
 * Env vars:
 *   CHATWOOT_URL       — base pública (`https://atendimento.movatruck.com.br`)
 *   CHATWOOT_API_TOKEN — token de acesso de um agente (Perfil → Token de acesso)
 *
 * Sem as duas, `configurado()` é false e o agente não responde nada — melhor
 * calado do que respondendo no vazio.
 */

/** O Chatwoot é nosso, na mesma máquina. Se demorar mais que isso, caiu. */
const TIMEOUT_MS = 10_000;

/** Etiqueta que marca conversa que o robô não deu conta. */
export const LABEL_PRECISA_HUMANO = "precisa-humano";

@Injectable()
export class ChatwootClientService {
  private readonly log = new Logger("ChatwootClient");
  private readonly base: string;
  private readonly token: string;

  constructor(config: ConfigService) {
    this.base = (config.get<string>("CHATWOOT_URL") ?? "").trim().replace(/\/+$/, "");
    this.token = (config.get<string>("CHATWOOT_API_TOKEN") ?? "").trim();
  }

  configurado(): boolean {
    return this.base.length > 0 && this.token.length > 0;
  }

  /** Responde na conversa como agente. */
  async responder(contaId: number, conversaId: number, texto: string): Promise<boolean> {
    return this.chamar(`/api/v1/accounts/${contaId}/conversations/${conversaId}/messages`, {
      content: texto,
      message_type: "outgoing",
    });
  }

  /**
   * Devolve a conversa pra fila humana: status `open` tira ela do bot, e a
   * etiqueta deixa medir depois quanto o robô resolveu sozinho.
   *
   * As duas chamadas são independentes: falhar a etiqueta não pode impedir o
   * repasse pro humano, que é o que importa.
   */
  async passarParaHumano(contaId: number, conversaId: number): Promise<void> {
    await this.chamar(`/api/v1/accounts/${contaId}/conversations/${conversaId}/toggle_status`, {
      status: "open",
    });
    await this.chamar(`/api/v1/accounts/${contaId}/conversations/${conversaId}/labels`, {
      labels: [LABEL_PRECISA_HUMANO],
    });
  }

  /**
   * Nunca lança. Quem chama está no meio de um webhook que precisa responder
   * 200 — o Chatwoot reenvia o que falha, e reenviar mensagem de agente
   * duplicaria resposta na cara do motorista.
   */
  private async chamar(caminho: string, corpo: Record<string, unknown>): Promise<boolean> {
    if (!this.configurado()) {
      this.log.error("CHATWOOT_URL ou CHATWOOT_API_TOKEN ausentes — nada foi enviado");
      return false;
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base}${caminho}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          api_access_token: this.token,
        },
        body: JSON.stringify(corpo),
        signal: ac.signal,
      });
      if (!res.ok) {
        const detalhe = await res.text().catch(() => "");
        this.log.error(`Chatwoot recusou ${caminho} (${res.status}): ${detalhe.slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (e) {
      const msg =
        (e as Error).name === "AbortError"
          ? `Chatwoot não respondeu em ${TIMEOUT_MS / 1000}s`
          : (e as Error).message;
      this.log.error(`falha ao chamar ${caminho}: ${msg}`);
      return false;
    } finally {
      clearTimeout(t);
    }
  }
}
