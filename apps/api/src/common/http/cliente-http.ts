/**
 * Cliente HTTP de saída com fila por host, espera entre chamadas e retry.
 *
 * O projeto sempre usou `fetch` cru espalhado, o que funciona quando se chama
 * um serviço nosso. Não funciona pra varrer milhares de CNPJs num serviço
 * público de terceiro: sem fila a gente vira um ataque, e sem retry o primeiro
 * soluço de rede derruba a varredura inteira.
 *
 * A fila é POR HOST. Dois serviços diferentes não competem pela mesma vez, e
 * um serviço lento não segura o outro.
 */

export type OpcoesCliente = {
  /** Espera mínima entre duas chamadas ao MESMO host. */
  intervaloMs?: number;
  /** Quantas vezes tentar de novo antes de desistir. */
  tentativas?: number;
  timeoutMs?: number;
  /** Identifica a gente pro dono do serviço. Educação básica, e evita bloqueio. */
  userAgent?: string;
  /** Injetável no teste, pra não esperar de verdade. */
  dormir?: (ms: number) => Promise<void>;
  /** Injetável no teste. */
  buscar?: typeof fetch;
};

export class RespostaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly corpo: string,
    url: string,
  ) {
    super(`HTTP ${status} em ${url}`);
    this.name = "RespostaHttpError";
  }
}

const dormirDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 429 e 5xx são o servidor pedindo calma — tenta de novo.
 * Os outros 4xx são a requisição estando errada; repetir só gasta a cota.
 */
function valeTentarDeNovo(status: number): boolean {
  return status === 429 || status >= 500;
}

export class ClienteHttp {
  private readonly intervaloMs: number;
  private readonly tentativas: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly buscar: typeof fetch;

  /** Uma corrente de promises por host: a próxima só começa quando a anterior solta. */
  private readonly filaPorHost = new Map<string, Promise<unknown>>();

  constructor(opcoes: OpcoesCliente = {}) {
    this.intervaloMs = opcoes.intervaloMs ?? 1000;
    this.tentativas = opcoes.tentativas ?? 3;
    this.timeoutMs = opcoes.timeoutMs ?? 15_000;
    this.userAgent = opcoes.userAgent ?? "Movatruck/1.0 (+https://www.movatruck.com.br)";
    this.dormir = opcoes.dormir ?? dormirDeVerdade;
    this.buscar = opcoes.buscar ?? fetch;
  }

  /**
   * GET que devolve JSON. Entra na fila do host, respeita o intervalo e tenta
   * de novo no que for transitório.
   *
   * Devolve `null` em 404: "esse CNPJ não existe na base" é resposta válida,
   * não falha — quem chama não deve precisar de try/catch pro caso normal.
   */
  async obterJson<T>(url: string): Promise<T | null> {
    return this.naFila(url, async () => {
      let ultimoErro: unknown;

      for (let tentativa = 1; tentativa <= this.tentativas; tentativa++) {
        try {
          const resposta = await this.buscar(url, {
            headers: { "User-Agent": this.userAgent, Accept: "application/json" },
            signal: AbortSignal.timeout(this.timeoutMs),
          });

          if (resposta.status === 404) return null;

          if (!resposta.ok) {
            const corpo = await resposta.text().catch(() => "");
            const erro = new RespostaHttpError(resposta.status, corpo.slice(0, 300), url);
            if (!valeTentarDeNovo(resposta.status) || tentativa === this.tentativas) {
              throw erro;
            }
            ultimoErro = erro;
            await this.dormir(this.esperaDoBackoff(tentativa, resposta));
            continue;
          }

          return (await resposta.json()) as T;
        } catch (erro) {
          // Erro de rede e timeout são transitórios; erro de status já foi
          // decidido acima e vem relançado.
          if (erro instanceof RespostaHttpError && !valeTentarDeNovo(erro.status)) throw erro;
          if (tentativa === this.tentativas) throw erro;
          ultimoErro = erro;
          await this.dormir(this.esperaDoBackoff(tentativa));
        }
      }

      throw ultimoErro ?? new Error(`Falha em ${url}`);
    });
  }

  /** Respeita `Retry-After` quando o servidor manda; senão, backoff exponencial. */
  private esperaDoBackoff(tentativa: number, resposta?: Response): number {
    const pedido = resposta?.headers.get("retry-after");
    if (pedido) {
      const segundos = Number(pedido);
      if (Number.isFinite(segundos) && segundos > 0) return Math.min(segundos * 1000, 60_000);
    }
    return Math.min(1000 * 2 ** (tentativa - 1), 30_000);
  }

  /**
   * Encadeia a chamada na fila do host.
   *
   * O `catch` no elo da corrente é essencial: sem ele, uma chamada que falha
   * deixaria a fila do host como promise rejeitada e toda chamada seguinte
   * quebraria junto.
   */
  private async naFila<T>(url: string, tarefa: () => Promise<T>): Promise<T> {
    const host = hostDe(url);
    const anterior = this.filaPorHost.get(host) ?? Promise.resolve();

    const minha = anterior
      .catch(() => undefined)
      .then(async () => {
        const resultado = await tarefa();
        await this.dormir(this.intervaloMs);
        return resultado;
      });

    this.filaPorHost.set(
      host,
      minha.catch(() => undefined),
    );

    return minha;
  }
}

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
