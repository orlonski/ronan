import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Configuração do gateway de pagamento (Asaas).
 *
 * Nasce DESLIGADO, como o publicador do Instagram e o runner do ClickUp: sem
 * `ASAAS_API_KEY` nada é criado no gateway, o cron não roda e o webhook recusa
 * tudo. Subir esse código em produção não pode, sozinho, começar a cobrar
 * ninguém.
 *
 * Nada de `getOrThrow`: uma chave de cobrança ausente não derruba a API. O
 * painel continua de pé e o motorista continua lançando viagem — só a
 * mensalidade fica sem ser gerada, e o boot diz isso em voz alta.
 * (CLAUDE.md: só JWT e MinIO são `getOrThrow`.)
 */
@Injectable()
export class AsaasConfig {
  private readonly logger = new Logger(AsaasConfig.name);

  /** Chave de API. Vai no header `access_token`, e NUNCA é logada. */
  readonly apiKey: string;
  /**
   * `sandbox` ou `producao`.
   *
   * Nasce em sandbox de propósito, e não tem default esperto: a chave de
   * sandbox e a de produção são valores diferentes, então uma configuração
   * incompleta erra pro lado de não cobrar ninguém de verdade.
   */
  readonly ambiente: "sandbox" | "producao";
  /**
   * Segredo que o Asaas manda no header `asaas-access-token` de todo webhook.
   * É a única autenticação daquela rota — ela é `@Public()`, como todo webhook.
   */
  readonly webhookToken: string;
  /**
   * Chave Pix que recebe o primeiro pagamento do Pix Automático.
   *
   * Obrigatória só pra essa forma: a autorização precisa dizer em qual chave o
   * QR Code inicial cai. As outras formas não usam.
   */
  readonly chavePix: string;
  /** Timeout de cada chamada. Gateway lento não pode segurar requisição do painel. */
  readonly timeoutMs: number;
  /**
   * Emitir nota fiscal de serviço na confirmação do pagamento.
   *
   * Desligado por padrão: emitir nota exige o município configurado no Asaas e
   * certificado digital válido. Ligar antes disso gera nota recusada, que é
   * pior que nota nenhuma.
   */
  readonly emitirNfse: boolean;

  constructor(private readonly config: ConfigService) {
    this.apiKey = (this.config.get<string>("ASAAS_API_KEY") ?? "").trim();
    this.ambiente =
      (this.config.get<string>("ASAAS_AMBIENTE") ?? "").trim() === "producao"
        ? "producao"
        : "sandbox";
    this.webhookToken = (this.config.get<string>("ASAAS_WEBHOOK_TOKEN") ?? "").trim();
    this.chavePix = (this.config.get<string>("ASAAS_CHAVE_PIX") ?? "").trim();
    this.timeoutMs = this.numero("ASAAS_TIMEOUT_MS", 20_000, 3_000, 60_000);
    this.emitirNfse = (this.config.get<string>("ASAAS_EMITIR_NFSE") ?? "").trim() === "true";
  }

  /** Dá pra falar com o gateway? Sem chave não há nem o que tentar. */
  get habilitado(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * O webhook aceita alguma coisa?
   *
   * Separado do `habilitado` porque são segredos diferentes e com ciclos de
   * vida diferentes: dá pra rotacionar o token do webhook sem tocar na chave de
   * API, e uma rota pública sem segredo configurado tem que recusar tudo — não
   * aceitar tudo.
   */
  get webhookHabilitado(): boolean {
    return this.webhookToken.length >= 16;
  }

  get baseUrl(): string {
    return this.ambiente === "producao"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  }

  /** Loga o estado SEM vazar segredo: diz o que está setado, nunca o valor. */
  descreverNoBoot(): void {
    if (!this.habilitado) {
      this.logger.log(
        "Gateway de pagamento DESLIGADO (falta ASAAS_API_KEY): " +
          "nenhuma assinatura é criada e o cron de cobrança não roda.",
      );
      return;
    }
    this.logger.log(
      JSON.stringify({
        evento: "asaas-config",
        ambiente: this.ambiente,
        webhook: this.webhookHabilitado ? "aberto" : "FECHADO (falta ASAAS_WEBHOOK_TOKEN)",
        chavePix: this.chavePix ? "configurada" : "ausente (Pix Automático indisponível)",
        nfse: this.emitirNfse ? "emite na confirmação" : "não emite",
      }),
    );
    if (this.ambiente === "sandbox") {
      this.logger.warn(
        "Asaas em SANDBOX: as cobranças criadas aqui não existem no mundo real.",
      );
    }
  }

  private numero(chave: string, padrao: number, min: number, max: number): number {
    const bruto = (this.config.get<string>(chave) ?? "").trim();
    if (bruto.length === 0) return padrao;
    const n = Number(bruto);
    if (!Number.isFinite(n)) {
      this.logger.warn(`${chave}="${bruto}" não é número; usando ${padrao}`);
      return padrao;
    }
    return Math.min(max, Math.max(min, Math.trunc(n)));
  }
}
