import { Logger } from "@nestjs/common";
import { contaIdAtual } from "./conta-context";

/**
 * Guarda por alguns segundos um valor de configuração que é POR CONTA.
 *
 * Existe por causa de um bug já pago: o cache era um campo único de instância
 * num provider singleton (`IaModule` é `@Global`) enquanto a consulta filtrava
 * por `contaIdAtual()`. O valor da primeira conta era servido a todas as outras
 * pelos segundos seguintes. Com tráfego de requisição isso era uma corrida
 * ocasional; num worker que pula de conta a cada job vira quase certo.
 *
 * A defesa é a chave do Map ser o `contaId` — e ter um lugar só onde isso está
 * escrito, em vez de cada serviço reimplementar o mesmo Map e algum deles
 * esquecer.
 */
export class CachePorConta<T> {
  private readonly valores = new Map<string, { valor: T; ate: number }>();
  private readonly log: Logger;

  constructor(
    private readonly nome: string,
    private readonly ttlMs = 30_000,
  ) {
    this.log = new Logger(`CachePorConta:${nome}`);
  }

  /**
   * O valor da conta ATUAL, buscando com `carregar` quando não houver cache.
   *
   * Sem conta no contexto ou com a busca falhando, devolve `padrao` e avisa —
   * engolir isso calado é exatamente como o bug acima passou despercebido.
   */
  async obter(carregar: (contaId: string) => Promise<T>, padrao: T): Promise<T> {
    let contaId: string;
    try {
      contaId = contaIdAtual();
    } catch (err) {
      this.log.warn(`sem conta no contexto, usando o padrão: ${(err as Error).message}`);
      return padrao;
    }

    const cacheado = this.valores.get(contaId);
    if (cacheado && cacheado.ate > Date.now()) return cacheado.valor;

    try {
      const valor = await carregar(contaId);
      this.valores.set(contaId, { valor, ate: Date.now() + this.ttlMs });
      return valor;
    } catch (err) {
      this.log.warn(`falha ao ler ${this.nome} de ${contaId}: ${(err as Error).message}`);
      return padrao;
    }
  }

  /** Esquece o que sabe. Pra teste e pra quando a configuração muda. */
  limpar(contaId?: string): void {
    if (contaId) this.valores.delete(contaId);
    else this.valores.clear();
  }
}
