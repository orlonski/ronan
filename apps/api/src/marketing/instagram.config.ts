import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Configuração do publicador do Instagram do @movatruck.
 *
 * Nasce DESLIGADO: sem `INSTAGRAM_ACCESS_TOKEN` o cron não roda e o módulo diz
 * isso no boot. Mesma postura do runner do ClickUp — subir esse código em
 * produção não pode ligar nada sozinho, e aqui o que sairia é um post no feed
 * público da marca.
 *
 * Nada de `getOrThrow`: um token de marketing ausente não pode derrubar a API
 * inteira. Sem token, o painel continua de pé e o app do motorista continua
 * logando; só o publicador fica parado. (CLAUDE.md: só JWT e MinIO são
 * `getOrThrow` — o resto degrada.)
 */
@Injectable()
export class InstagramConfig {
  private readonly logger = new Logger(InstagramConfig.name);

  /** System User token do Business Manager. Não expira — por isso não há cron de renovação. */
  readonly token: string;
  /** IG User ID da conta (não é o @; é o id numérico da conta profissional). */
  readonly igUserId: string;
  readonly apiVersion: string;
  /**
   * Modo sombra: monta o container na Meta e NÃO publica. É como a conferência
   * de ticket estreou — dá pra ver a integração funcionando de ponta a ponta
   * sem nada aparecer no feed.
   */
  readonly modoSombra: boolean;
  /** Quantos posts o cron pega por vez. Feed de empresa não precisa de lote. */
  readonly loteMax: number;
  readonly tentativasMax: number;
  /** Quanto tempo a URL pública da arte fica de pé. A Meta só precisa dela por minutos. */
  readonly arteValidadeHoras: number;
  /** Depois disto, um post PUBLICANDO é considerado órfão e vira INDETERMINADO. */
  readonly timeoutPublicacaoMs: number;

  constructor(private readonly config: ConfigService) {
    this.token = (this.config.get<string>("INSTAGRAM_ACCESS_TOKEN") ?? "").trim();
    this.igUserId = (this.config.get<string>("INSTAGRAM_IG_USER_ID") ?? "").trim();
    this.apiVersion = (this.config.get<string>("INSTAGRAM_API_VERSION") ?? "v21.0").trim();
    this.modoSombra = (this.config.get<string>("INSTAGRAM_MODO_SOMBRA") ?? "").trim() !== "false";
    this.loteMax = this.numero("INSTAGRAM_LOTE_MAX", 1, 1, 10);
    this.tentativasMax = this.numero("INSTAGRAM_TENTATIVAS_MAX", 4, 1, 10);
    this.arteValidadeHoras = this.numero("INSTAGRAM_ARTE_VALIDADE_HORAS", 48, 1, 720);
    this.timeoutPublicacaoMs = this.numero("INSTAGRAM_TIMEOUT_MS", 5 * 60_000, 30_000, 30 * 60_000);
  }

  /** Publicador ligado? Sem token não há o que fazer — nem tentar. */
  get habilitado(): boolean {
    return this.token.length > 0 && this.igUserId.length > 0;
  }

  get baseUrl(): string {
    return `https://graph.facebook.com/${this.apiVersion}`;
  }

  /** Loga o estado SEM vazar segredo: diz o que está setado, nunca o valor. */
  descreverNoBoot(): void {
    if (!this.habilitado) {
      const falta = [
        this.token.length === 0 ? "INSTAGRAM_ACCESS_TOKEN" : null,
        this.igUserId.length === 0 ? "INSTAGRAM_IG_USER_ID" : null,
      ]
        .filter(Boolean)
        .join(" e ");
      this.logger.log(`Publicador do Instagram DESLIGADO (falta ${falta}): o cron não roda.`);
      return;
    }
    this.logger.log(
      JSON.stringify({
        evento: "instagram-config",
        modo: this.modoSombra ? "SOMBRA (monta o container e não publica)" : "PUBLICANDO DE VERDADE",
        igUserId: this.igUserId,
        apiVersion: this.apiVersion,
        loteMax: this.loteMax,
        tentativasMax: this.tentativasMax,
        arteValidadeHoras: this.arteValidadeHoras,
      }),
    );
  }

  private numero(chave: string, padrao: number, min: number, max: number): number {
    const bruto = (this.config.get<string>(chave) ?? "").trim();
    if (bruto.length === 0) return padrao;
    const n = Number(bruto);
    if (!Number.isFinite(n)) {
      this.logger.warn(`${chave}="${bruto}" não é número; usando ${padrao}`);
      return padrao;
    }
    const preso = Math.min(max, Math.max(min, Math.trunc(n)));
    if (preso !== Math.trunc(n)) {
      this.logger.warn(`${chave}=${n} fora de [${min}, ${max}]; usando ${preso}`);
    }
    return preso;
  }
}
