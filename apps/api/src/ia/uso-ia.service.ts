import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { calcularUso, type EscopoIa, type UsageAnthropic } from "../common/ia/uso-ia";

/**
 * Grava quanto custou cada chamada de IA.
 *
 * A regra que governa este arquivo inteiro: **medir nunca pode quebrar o que
 * estava sendo medido**. Toda gravação é best-effort e engole o próprio erro —
 * perder uma linha de contabilidade é barato, derrubar o OCR do motorista na
 * estrada por causa dela não é.
 *
 * Por isso `registrar` não devolve promise pra ninguém esperar: quem chama usa
 * `void`, e o serviço se vira.
 */
@Injectable()
export class UsoIaService {
  private readonly log = new Logger(UsoIaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra uma chamada. Chamar com `void` — nunca dá `await` nisso no caminho
   * quente.
   *
   * Roda no contexto de conta de quem chamou: a trava do Prisma carimba o
   * `contaId` sozinha. Num worker, isso significa estar dentro de
   * `comConta(...)` — que é justamente onde a conferência vai rodar.
   */
  registrar(entrada: {
    escopo: EscopoIa;
    modelo: string;
    usage?: UsageAnthropic | null;
    duracaoMs?: number;
    sucesso?: boolean;
    erro?: string;
  }): void {
    void this.gravar(entrada);
  }

  private async gravar(entrada: {
    escopo: EscopoIa;
    modelo: string;
    usage?: UsageAnthropic | null;
    duracaoMs?: number;
    sucesso?: boolean;
    erro?: string;
  }): Promise<void> {
    try {
      const uso = calcularUso(entrada.modelo, entrada.usage);
      await this.prisma.usoIa.create({
        data: {
          escopo: entrada.escopo,
          modelo: entrada.modelo,
          tokensEntrada: uso.tokensEntrada,
          tokensSaida: uso.tokensSaida,
          tokensCacheLeitura: uso.tokensCacheLeitura,
          tokensCacheEscrita: uso.tokensCacheEscrita,
          custoUsd: uso.custoUsd != null ? new Prisma.Decimal(uso.custoUsd) : null,
          duracaoMs: entrada.duracaoMs ?? null,
          sucesso: entrada.sucesso ?? true,
          // Mensagem de erro pode vir enorme (stack de SDK); o que interessa é
          // o começo.
          erro: entrada.erro ? entrada.erro.slice(0, 500) : null,
        },
      });
    } catch (err) {
      // Fora de contexto de conta (script solto, boot) a trava recusa a escrita.
      // É esperado e não merece stack trace — só um aviso pra não sumir de vez.
      this.log.warn(
        `Não consegui registrar uso de IA (${entrada.escopo}/${entrada.modelo}): ${
          (err as Error).message
        }`,
      );
    }
  }
}
