import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { comoSistema } from "../../common/conta/conta-context";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * O relógio do período de teste.
 *
 * A regra de "venceu?" mora em `estadoDaConta` e já vale por si a cada
 * requisição — este cron não é o que faz a conta expirar, é o que **grava** que
 * ela expirou. A diferença importa: sem ele, uma conta vencida se comportaria
 * certo mas apareceria como ativa em toda listagem e relatório, e ninguém
 * conseguiria filtrar quem caiu.
 *
 * Roda de madrugada porque o corte é por dia, não por minuto.
 */
@Injectable()
export class TrialService {
  private readonly log = new Logger(TrialService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron("0 10 3 * * *", { name: "expirar-testes", timeZone: "America/Sao_Paulo" })
  async expirarVencidos(): Promise<void> {
    try {
      const { count } = await comoSistema(() =>
        this.prisma.conta.updateMany({
          where: {
            trialExpiraEm: { lte: new Date() },
            somenteLeitura: false,
            // Conta suspensa já está fora do ar; não há o que degradar.
            ativa: true,
          },
          data: {
            somenteLeitura: true,
            motivoBloqueio:
              "Seu período de teste terminou. Você continua vendo e exportando tudo que já lançou — pra voltar a lançar, fale com a Movatruck.",
          },
        }),
      );
      if (count > 0) this.log.log(`${count} empresa(s) passaram para somente leitura.`);
      await this.podarEnviosAntigos();
    } catch (err) {
      this.log.error(`Falha ao expirar testes: ${(err as Error).message}`);
    }
  }

  /**
   * O teto de códigos olha uma hora pra trás; linha mais velha que um dia não
   * serve nem pra isso nem pra investigar abuso, e só faria a tabela crescer.
   */
  private async podarEnviosAntigos(): Promise<void> {
    const { count } = await comoSistema(() =>
      this.prisma.envioCodigoCadastro.deleteMany({
        where: { criadoEm: { lt: new Date(Date.now() - 86_400_000) } },
      }),
    );
    if (count > 0) this.log.log(`${count} registro(s) de envio de código expurgados.`);
  }
}
