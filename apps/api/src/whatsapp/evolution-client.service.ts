import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Wrapper HTTP do Evolution API. Toda comunicação saindo pra Evolution passa
 * por aqui — facilita logar, retry e trocar pra Cloud API oficial no futuro
 * sem mexer no resto do módulo.
 *
 * Configuração via env vars:
 *   EVOLUTION_API_URL    — base URL (ex: https://evolution.exemplo.com)
 *   EVOLUTION_API_KEY    — token global (igual AUTHENTICATION_API_KEY do Evolution)
 *   EVOLUTION_INSTANCE   — nome da instância criada no Evolution Manager
 *
 * Sem nenhuma das três configuradas, métodos lançam ServiceUnavailable —
 * útil em dev local sem Evolution rodando: o resto da app ainda sobe.
 */
/**
 * Teto de espera por requisição ao Evolution. 15s é folgado pro `sendText` e
 * ainda curto o bastante pra não segurar um cron que percorre conta por conta.
 */
const TIMEOUT_MS = 15_000;

/**
 * Teto maior pro download de mídia: o Evolution descriptografa o arquivo e
 * devolve base64, o que num áudio longo passa folgado dos 15s do envio.
 */
const TIMEOUT_MIDIA_MS = 45_000;

@Injectable()
export class EvolutionClientService {
  private readonly log = new Logger("EvolutionClient");
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly instance: string | undefined;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("EVOLUTION_API_URL")?.replace(/\/+$/, "");
    this.apiKey = config.get<string>("EVOLUTION_API_KEY");
    this.instance = config.get<string>("EVOLUTION_INSTANCE");
  }

  get configurado(): boolean {
    return !!(this.baseUrl && this.apiKey && this.instance);
  }

  /**
   * Manda o texto e devolve a `key.id` — a prova de que o Evolution aceitou e
   * enfileirou. Lança em qualquer outro desfecho.
   *
   * `alvo` é telefone (`5541...`) ou JID de grupo (`120363...@g.us`): o
   * `sendText` do Evolution aceita os dois no mesmo campo.
   */
  async enviarTextoRetornandoId(alvo: string, texto: string): Promise<string> {
    const res = await this.req(`/message/sendText/${this.instance}`, {
      number: alvo,
      text: texto,
    });
    const key = (res as { key?: { id?: string } } | null)?.key;
    if (!key?.id) {
      this.log.error(`sendText sem key.id — resposta: ${JSON.stringify(res).slice(0, 300)}`);
      throw new Error("Evolution respondeu sem key.id");
    }
    return key.id;
  }

  async enviarTexto(telefone: string, texto: string): Promise<void> {
    // Garantia de envio: só consideramos enviado quando o Evolution devolve a
    // `key.id` da mensagem (prova de que aceitou e enfileirou). Qualquer falha
    // — erro HTTP, Evolution fora do ar, ou 200 "vazio"/de erro sem key — vira
    // um 503 com código, pra quem chama NUNCA dizer ao motorista que o código
    // foi enviado quando não foi.
    //
    // Preferir `EnvioWhatsappService` a chamar isto direto: lá a mensagem de
    // erro combina com a mensagem que falhou, e o envio fica roteável.
    try {
      await this.enviarTextoRetornandoId(telefone, texto);
    } catch (e) {
      this.log.error(`Falha no sendText pra ${telefone}: ${(e as Error).message}`);
      throw new ServiceUnavailableException({
        code: "ENVIO_WHATSAPP_FALHOU",
        message:
          "Não conseguimos enviar o código pelo WhatsApp agora. Tente de novo em alguns instantes.",
      });
    }
  }

  /**
   * Lista os grupos em que o número conectado participa. `getParticipants=true`
   * traz a lista de membros junto (mais pesado, mas evita N chamadas). Usado no
   * painel pra o admin escolher em qual grupo postar os avisos.
   */
  async listarGrupos(): Promise<
    Array<{ jid: string; nome: string; tamanho: number }>
  > {
    const data = await this.req(
      `/group/fetchAllGroups/${this.instance}?getParticipants=false`,
      undefined,
      "GET",
    );
    const grupos = Array.isArray(data) ? data : [];
    return grupos
      .map((g) => {
        const o = g as { id?: string; subject?: string; size?: number };
        return { jid: o.id ?? "", nome: o.subject ?? "(sem nome)", tamanho: o.size ?? 0 };
      })
      .filter((g) => g.jid.endsWith("@g.us"));
  }

  /**
   * Verifica se a instância está conectada (Baileys "open").
   * Retorna estado bruto pra UI mostrar status.
   */
  async statusInstancia(): Promise<{
    state: "open" | "close" | "connecting" | string;
    numero: string | null;
  }> {
    const data = await this.req(`/instance/connectionState/${this.instance}`, undefined, "GET");
    const inst = (data as { instance?: { state?: string; profileName?: string; ownerJid?: string } })
      .instance;
    const numero = inst?.ownerJid?.split("@")[0] ?? null;
    return { state: inst?.state ?? "close", numero };
  }

  /**
   * Pega o QR code atual (base64) pra parear quando instância está disconnected.
   * Quando já está conectada, retorna null.
   */
  async pegarQrCode(): Promise<{ base64: string | null; pairingCode: string | null }> {
    try {
      const data = await this.req(`/instance/connect/${this.instance}`, undefined, "GET");
      const d = data as { base64?: string; code?: string; pairingCode?: string };
      return {
        base64: d.base64 ?? null,
        pairingCode: d.pairingCode ?? null,
      };
    } catch (e) {
      this.log.warn(`Falha ao pegar QR: ${(e as Error).message}`);
      return { base64: null, pairingCode: null };
    }
  }

  /**
   * Baixa o conteúdo de uma mensagem com mídia (imagem/áudio/etc) que chegou
   * pelo webhook. Aceita o payload completo da mensagem (key + message) — assim
   * funciona mesmo com DATABASE_SAVE_DATA_NEW_MESSAGE=false, pois o Evolution
   * descriptografa direto do payload sem precisar buscar no banco.
   */
  async baixarMidia(
    payload: { key: unknown; message: unknown },
  ): Promise<{ buffer: Buffer; mimetype: string } | null> {
    try {
      const data = await this.req(
        `/chat/getBase64FromMediaMessage/${this.instance}`,
        { message: payload, convertToMp4: false },
        "POST",
        TIMEOUT_MIDIA_MS,
      );
      const d = data as { base64?: string; mimetype?: string };
      if (!d.base64) return null;
      return {
        buffer: Buffer.from(d.base64, "base64"),
        mimetype: d.mimetype ?? "application/octet-stream",
      };
    } catch (e) {
      this.log.warn(`Falha ao baixar mídia: ${(e as Error).message}`);
      return null;
    }
  }

  private async req(
    path: string,
    body?: unknown,
    method: "GET" | "POST" | "PUT" | "DELETE" = body !== undefined ? "POST" : "GET",
    timeoutMs: number = TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.configurado) {
      throw new ServiceUnavailableException(
        "Evolution API não configurada (EVOLUTION_API_URL/KEY/INSTANCE)",
      );
    }
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          apikey: this.apiKey!,
          "content-type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // Sem isto um Evolution pendurado pendura o request inteiro. No cron das
        // 18h/20h o envio roda dentro de `paraCadaConta`, em série — uma
        // requisição travada segura o resumo de TODAS as empresas seguintes.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // `AbortSignal.timeout` estoura com TimeoutError; rede fora dá TypeError.
      // Os dois são falha de transporte e viram 503, não 500.
      const msg =
        (e as Error).name === "TimeoutError" ? `timeout de ${timeoutMs}ms` : (e as Error).message;
      this.log.error(`Evolution ${method} ${path} falhou: ${msg}`);
      throw new ServiceUnavailableException(`Evolution API não respondeu (${msg})`);
    }
    if (!res.ok) {
      const detalhes = await res.text().catch(() => "");
      this.log.error(`Evolution ${method} ${path} ${res.status}: ${detalhes.slice(0, 300)}`);
      throw new HttpException(
        `Evolution API erro ${res.status}: ${detalhes.slice(0, 200)}`,
        res.status,
      );
    }
    if (res.status === 204) return null;
    return res.json();
  }
}
