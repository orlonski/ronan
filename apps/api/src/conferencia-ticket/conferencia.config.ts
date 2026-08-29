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

  private str(chave: string, padrao: string): string {
    return this.config.get<string>(chave)?.trim() || padrao;
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

  /**
   * Aprovar sozinho a viagem que confere — marcando como conferida, do jeito
   * que um humano marcaria.
   *
   * É a ação de maior raio de dano do sistema: aprovar errado deixa passar
   * viagem torta pro fechamento, e ninguém revisa o que já está aprovado.
   * Nasce DESLIGADA e só faz sentido depois de olhar a taxa de acerto real em
   * modo sombra.
   *
   * Aprovar não é o contrário de acusar: acusar errado incomoda um motorista
   * honesto, aprovar errado passa dinheiro errado adiante sem ninguém ver.
   */
  get autoAprovar(): boolean {
    return this.bool("CONFERENCIA_AUTO_APROVAR", false);
  }

  /**
   * Confiança mínima da leitura pra aprovar sozinho — mais alta que a de
   * avisar, de propósito: pra deixar passar sem olho humano, tem que estar bem
   * mais certo do que pra pedir uma conferida.
   */
  get confiancaParaAprovar(): number {
    return this.num("CONFERENCIA_CONFIANCA_APROVAR", 0.9, 0.5, 1);
  }

  /**
   * Quantos campos precisam ter sido conferidos pra valer aprovação.
   *
   * Sem isto, uma viagem em que só o peso deu pra ler seria "aprovada" com um
   * campo — e o resto passaria sem ninguém olhar.
   */
  get minCamposParaAprovar(): number {
    return this.num("CONFERENCIA_MIN_CAMPOS_APROVAR", 3, 1, 6);
  }

  /**
   * A viagem também precisa fechar com o que a frota já rodou no trajeto: km
   * dentro do padrão do par de locais (`Viagem.kmForaDoPadrao`).
   *
   * O ticket fala da CARGA — ele não sabe nada sobre o caminho. Uma leitura
   * impecável convive com um km fora de qualquer padrão do trajeto, e aprovar
   * pelo papel deixaria isso passar direto pro fechamento.
   *
   * "Não avaliado" conta como reprovado: sem referência não dá pra dizer que o
   * km está na média, e a viagem só continua onde já estaria — na fila de quem
   * confere.
   */
  get exigirKmNoPadrao(): boolean {
    return this.bool("CONFERENCIA_APROVAR_EXIGE_KM_PADRAO", true);
  }

  /**
   * Se a rota passa por praça de pedágio, a viagem tem que trazer o valor — e
   * um valor parecido com o que as outras viagens do mesmo trajeto trazem.
   *
   * Desligar só faz sentido pra empresa que não usa o cadastro de praças: sem
   * praça cadastrada a checagem responde "não sei" e nada é aprovado sozinho.
   */
  get exigirPedagioCoerente(): boolean {
    return this.bool("CONFERENCIA_APROVAR_EXIGE_PEDAGIO", true);
  }

  /**
   * Quanto o valor do pedágio pode fugir da mediana do trajeto, em %.
   *
   * Folgado de propósito: praça reajusta, tag dá desconto, o motorista pega um
   * desvio. A régua existe pra pegar o zero digitado errado e o valor de outra
   * viagem, não pra brigar por alguns reais.
   */
  get desvioPedagioPct(): number {
    return this.num("CONFERENCIA_PEDAGIO_DESVIO_PCT", 40, 5, 300);
  }

  /** Abaixo disto a mediana de pedágio não é afirmável — e não bloqueia nada. */
  get amostraMinimaPedagio(): number {
    return this.num("CONFERENCIA_PEDAGIO_AMOSTRA_MIN", 3, 2, 50);
  }

  /** Janela da amostra de pedágio do par, em dias. */
  get janelaDiasPedagio(): number {
    return this.num("CONFERENCIA_PEDAGIO_JANELA_DIAS", 180, 7, 1825);
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
   * Modelo da PRIMEIRA passada, quando a empresa não escolheu um.
   *
   * Era uma constante dentro do leitor, o que fazia trocar de modelo exigir
   * deploy. Virou config porque a única forma honesta de avaliar um fornecedor
   * de OCR é rodar contra ticket real e comparar — e isso pede poder voltar
   * atrás rápido. O default é o mesmo Haiku de sempre: quem não mexer em nada
   * não muda de comportamento.
   *
   * `ConfiguracaoIa.modeloConferencia` da empresa vence isto quando existir.
   */
  get modeloPadrao(): string {
    return this.str("CONFERENCIA_MODELO", "claude-haiku-4-5-20251001");
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
        modelo: this.modeloPadrao,
        concorrencia: this.concorrencia,
        intervaloMs: this.intervaloMs,
        segundaOpiniao: this.modeloSegundaOpiniao || "desligada",
        autoAprovar: this.autoAprovar
          ? `sim (confiança ≥ ${this.confiancaParaAprovar}, ≥ ${this.minCamposParaAprovar} campos)`
          : "não",
        exigeKmNoPadrao: this.exigirKmNoPadrao,
        exigePedagio: this.exigirPedagioCoerente
          ? `sim (desvio ≤ ${this.desvioPedagioPct}% com ≥ ${this.amostraMinimaPedagio} viagens)`
          : "não",
      }),
    );
  }
}
