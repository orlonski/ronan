import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Configuração da conferência automática de ticket.
 *
 * Nasce em MODO SOMBRA: o worker roda, lê, compara e grava o veredito — e não
 * toca na viagem nem avisa ninguém. Ligar a atuação é decisão consciente, feita
 * depois de olhar alguns dias de veredito contra o que o conferente humano
 * decidiu. Acusar motorista por erro de leitura é o pior desfecho possível
 * deste projeto, e não se descobre isso em teste.
 */
@Injectable()
export class ConferenciaConfig {
  private readonly log = new Logger("ConferenciaTicket");

  constructor(private readonly config: ConfigService) {}

  private num(chave: string, padrao: number, min: number, max: number): number {
    const bruto = this.config.get<string>(chave);
    if (!bruto) return padrao;
    const n = Number(bruto);
    if (!Number.isFinite(n)) {
      this.log.warn(`${chave}="${bruto}" não é número; usando ${padrao}`);
      return padrao;
    }
    return Math.min(max, Math.max(min, n));
  }

  private bool(chave: string, padrao: boolean): boolean {
    const bruto = this.config.get<string>(chave)?.trim().toLowerCase();
    if (bruto === undefined || bruto === "") return padrao;
    return bruto === "true" || bruto === "1";
  }

  /** Kill switch do worker. Desligado = nada é consumido da fila. */
  get habilitado(): boolean {
    return this.bool("CONFERENCIA_TICKET_ATIVA", true);
  }

  /**
   * Modo sombra: grava veredito e NÃO mexe na viagem, não notifica, não escreve
   * no chat. É o default, e sair dele é decisão explícita.
   */
  get modoSombra(): boolean {
    return this.bool("CONFERENCIA_MODO_SOMBRA", true);
  }

  /** Quantas conferências ao mesmo tempo no processo. */
  get concorrencia(): number {
    return this.num("CONFERENCIA_CONCORRENCIA", 2, 1, 10);
  }

  /** Intervalo do laço do worker. */
  get intervaloMs(): number {
    return this.num("CONFERENCIA_INTERVALO_MS", 15_000, 5_000, 300_000);
  }

  /** Teto duro por conferência. Uma leitura resolve em ~3s. */
  get timeoutMs(): number {
    return this.num("CONFERENCIA_TIMEOUT_MS", 120_000, 30_000, 600_000);
  }

  /** Só falha de infra retenta. */
  get tentativasMax(): number {
    return this.num("CONFERENCIA_TENTATIVAS_MAX", 3, 1, 6);
  }

  /**
   * Modelo da segunda opinião, quando o peso diverge ou a leitura foi fraca.
   * Vazio desliga a escada — fica só a primeira passada.
   */
  get modeloSegundaOpiniao(): string {
    return this.config.get<string>("CONFERENCIA_MODELO_2A_OPINIAO")?.trim() ?? "claude-opus-5";
  }

  /**
   * Teto de segundas opiniões por hora, em toda a plataforma.
   *
   * A 2ª opinião custa ~5x a 1ª. Se o campo `confidence` da leitura quebrar e
   * passar a vir sempre 0, a escada dispararia em 100% dos jobs — este teto é o
   * que transforma isso em "algumas a mais" em vez de "a conta do mês".
   */
  get maxSegundaOpiniaoPorHora(): number {
    return this.num("CONFERENCIA_MAX_2A_OPINIAO_HORA", 30, 0, 500);
  }

  descreverNoBoot(): void {
    if (!this.habilitado) {
      this.log.log("Conferência de ticket DESLIGADA (CONFERENCIA_TICKET_ATIVA=false).");
      return;
    }
    this.log.log(
      JSON.stringify({
        evento: "conferencia-config",
        modo: this.modoSombra ? "SOMBRA (não mexe na viagem)" : "ATUANDO",
        concorrencia: this.concorrencia,
        intervaloMs: this.intervaloMs,
        segundaOpiniao: this.modeloSegundaOpiniao || "desligada",
      }),
    );
  }
}
