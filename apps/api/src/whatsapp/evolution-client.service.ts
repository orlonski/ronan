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

  async enviarTexto(telefone: string, texto: string): Promise<void> {
    await this.req(`/message/sendText/${this.instance}`, {
      number: telefone,
      text: texto,
    });
  }

  /**
   * Envia até 3 botões clicáveis pro motorista escolher entre opções.
   * Quando ele clica, vem de volta no webhook como buttonsResponseMessage
   * e é convertido pra "[OPÇÃO] <texto>" pra continuar o fluxo natural.
   *
   * Formato Evolution API v2.x. Aceita até 3 botões (limite WhatsApp).
   */
  async enviarBotoes(
    telefone: string,
    titulo: string,
    descricao: string,
    opcoes: Array<{ id: string; texto: string }>,
  ): Promise<void> {
    if (opcoes.length === 0 || opcoes.length > 3) {
      throw new Error("enviarBotoes aceita 1 a 3 opções");
    }
    await this.req(`/message/sendButtons/${this.instance}`, {
      number: telefone,
      title: titulo,
      description: descricao,
      footer: "Ronan",
      buttons: opcoes.map((o) => ({
        type: "reply",
        displayText: o.texto.slice(0, 20), // WhatsApp corta acima de 20
        id: o.id,
      })),
    });
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
   * Participantes crus de um grupo (objetos como o WhatsApp devolve). A
   * extração do telefone fica em quem chama, porque o WhatsApp moderno às vezes
   * manda o `id` no formato `@lid` (id oculto, NÃO é telefone) e o número real
   * num campo separado (`jid`/`phoneNumber`). Devolver cru deixa o chamador
   * escolher o campo certo e diagnosticar.
   */
  async participantesDoGrupo(grupoJid: string): Promise<Array<Record<string, unknown>>> {
    const data = await this.req(
      `/group/participants/${this.instance}?groupJid=${encodeURIComponent(grupoJid)}`,
      undefined,
      "GET",
    );
    const d = data as { participants?: Array<Record<string, unknown>> };
    return Array.isArray(d?.participants) ? d.participants : [];
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
      const data = await this.req(`/chat/getBase64FromMediaMessage/${this.instance}`, {
        message: payload,
        convertToMp4: false,
      });
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
  ): Promise<unknown> {
    if (!this.configurado) {
      throw new ServiceUnavailableException(
        "Evolution API não configurada (EVOLUTION_API_URL/KEY/INSTANCE)",
      );
    }
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        apikey: this.apiKey!,
        "content-type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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
