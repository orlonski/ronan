import { Logger } from "@nestjs/common";
import type { InstagramConfig } from "./instagram.config";

/**
 * Erro vindo da Graph API, já classificado.
 *
 * A classificação é por CÓDIGO da Meta, não por status HTTP: a Graph API
 * devolve 400 tanto pra "estourou o teto de posts em 24h" (que passa sozinho)
 * quanto pra "essa legenda é longa demais" (que nunca passa). Tratar os dois
 * igual é ou desistir cedo demais ou retentar pra sempre.
 */
export class ErroMeta extends Error {
  constructor(
    readonly codigo: number | null,
    readonly subcodigo: number | null,
    readonly transitorio: boolean,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroMeta";
  }
}

/**
 * Códigos que passam sozinhos — retentar faz sentido.
 *
 *   1, 2  — erro interno/temporário da plataforma
 *   4, 17 — limite de chamadas da app e do usuário
 *   9     — teto de posts publicados em 24h (subcode 2207042)
 *   32    — limite da Página
 *   613   — limite de chamadas do recurso
 *
 * Fora daqui, o padrão é NÃO retentar. Em especial 190 (token inválido ou
 * expirado) e 100 (parâmetro errado): insistir neles só queima cota e esconde
 * o problema real de quem precisa consertar.
 */
const CODIGOS_TRANSITORIOS = new Set([1, 2, 4, 9, 17, 32, 613]);

type RespostaErro = { error?: { message?: string; code?: number; error_subcode?: number } };

export class MetaClient {
  private readonly logger = new Logger(MetaClient.name);

  constructor(
    private readonly config: InstagramConfig,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  /**
   * Fase 1: cria o container da mídia.
   *
   * `imagemUrl` tem que ser HTTPS e alcançável DE FORA — a Meta faz um GET nela.
   * Não existe upload de arquivo para foto nesta API.
   */
  async criarContainer(imagemUrl: string, legenda: string): Promise<string> {
    const corpo = await this.post<{ id: string }>(`/${this.config.igUserId}/media`, {
      image_url: imagemUrl,
      caption: legenda,
    });
    return corpo.id;
  }

  /**
   * O container é processado de forma assíncrona. Para foto costuma ser
   * imediato, mas publicar antes de `FINISHED` falha — então se pergunta.
   */
  async statusContainer(containerId: string): Promise<{
    status: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED" | string;
    erro: string | null;
  }> {
    const corpo = await this.get<{ status_code?: string; status?: string }>(
      `/${containerId}?fields=status_code,status`,
    );
    return { status: corpo.status_code ?? "IN_PROGRESS", erro: corpo.status ?? null };
  }

  /** Fase 2: publica o container. Daqui não tem volta. */
  async publicar(containerId: string): Promise<{ id: string }> {
    return this.post<{ id: string }>(`/${this.config.igUserId}/media_publish`, {
      creation_id: containerId,
    });
  }

  async permalink(mediaId: string): Promise<string | null> {
    const corpo = await this.get<{ permalink?: string }>(`/${mediaId}?fields=permalink`);
    return corpo.permalink ?? null;
  }

  /**
   * Quanto ainda cabe na janela de 24h, segundo a própria Meta.
   *
   * É a única resposta autoritativa: a documentação se contradiz entre 25, 50 e
   * 100 posts, e o número efetivo varia por conta.
   */
  async cotaRestante(): Promise<{ usados: number; teto: number } | null> {
    try {
      const corpo = await this.get<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
        `/${this.config.igUserId}/content_publishing_limit?fields=quota_usage,config`,
      );
      const linha = corpo.data?.[0];
      if (!linha) return null;
      return { usados: linha.quota_usage ?? 0, teto: linha.config?.quota_total ?? 0 };
    } catch (erro) {
      // Saber a cota é conforto, não requisito: se falhar, o teto próprio do
      // publicador continua valendo e o pior caso é a Meta recusar com code 9.
      this.logger.warn(`Não consegui ler a cota de publicação: ${(erro as Error).message}`);
      return null;
    }
  }

  /**
   * Lista as mídias recentes da conta. Usado só na reconciliação de um post que
   * ficou INDETERMINADO — para descobrir se ele saiu antes do processo morrer.
   */
  async midiasRecentes(limite = 10): Promise<{ id: string; caption?: string; timestamp?: string }[]> {
    const corpo = await this.get<{ data?: { id: string; caption?: string; timestamp?: string }[] }>(
      `/${this.config.igUserId}/media?fields=id,caption,timestamp&limit=${limite}`,
    );
    return corpo.data ?? [];
  }

  private async get<T>(caminho: string): Promise<T> {
    const juncao = caminho.includes("?") ? "&" : "?";
    const url = `${this.config.baseUrl}${caminho}${juncao}access_token=${encodeURIComponent(this.config.token)}`;
    return this.chamar<T>(url, { method: "GET" }, caminho);
  }

  private async post<T>(caminho: string, campos: Record<string, string>): Promise<T> {
    const corpo = new URLSearchParams({ ...campos, access_token: this.config.token });
    return this.chamar<T>(
      `${this.config.baseUrl}${caminho}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: corpo.toString(),
      },
      caminho,
    );
  }

  private async chamar<T>(url: string, init: RequestInit, caminho: string): Promise<T> {
    let resposta: Response;
    try {
      resposta = await this.buscar(url, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (erro) {
      // Rede caiu ou estourou o tempo: transitório por definição.
      throw new ErroMeta(null, null, true, `Falha de rede em ${caminho}: ${(erro as Error).message}`);
    }

    const texto = await resposta.text().catch(() => "");
    if (!resposta.ok) {
      let corpo: RespostaErro = {};
      try {
        corpo = JSON.parse(texto) as RespostaErro;
      } catch {
        // Resposta não-JSON (503 de proxy, página de erro): trata pelo status.
      }
      const codigo = corpo.error?.code ?? null;
      const subcodigo = corpo.error?.error_subcode ?? null;
      const transitorio =
        resposta.status >= 500 ||
        resposta.status === 429 ||
        (codigo !== null && CODIGOS_TRANSITORIOS.has(codigo));
      const mensagem = corpo.error?.message ?? texto.slice(0, 200) ?? `HTTP ${resposta.status}`;
      throw new ErroMeta(codigo, subcodigo, transitorio, mensagem);
    }

    try {
      return JSON.parse(texto) as T;
    } catch {
      throw new ErroMeta(null, null, false, `Resposta não-JSON em ${caminho}`);
    }
  }
}
