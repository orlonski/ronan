import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";
import { Public } from "../auth/decorators/public.decorator";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let db: "ok" | "down" = "down";
    let migracao: string | null = null;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = "ok";
      migracao = await this.ultimaMigracao();
    } catch {
      db = "down";
    }
    return {
      status: db === "ok" ? "ok" : "degraded",
      service: "ronan-api",
      db,
      /**
       * Carimbo da última migration aplicada (só o YYYYMMDDHHMMSS do nome).
       *
       * Existe pra responder de fora, sem token, a única pergunta que sempre
       * aparece depois de um push: **este deploy já subiu?** Antes disso a
       * conferência era adivinhação — sondar uma rota que o deploy adicionou,
       * o que só funciona quando ele adiciona alguma, e num deploy sem rota
       * nova não sobrava sinal nenhum.
       *
       * Vai só o número, sem o nome da migration: o carimbo identifica a
       * versão sem contar pra quem perguntar o que foi feito nela.
       */
      migracao,
      time: new Date().toISOString(),
    };
  }

  /**
   * O `_prisma_migrations` é tabela do Prisma, não do domínio — não existe model
   * pra ela, então é SQL cru mesmo. Não tem `contaId` e não é dado de negócio:
   * a trava não se aplica (ver common/conta/trava-conta.ts, que só intercepta o
   * Client, e o raw passa por fora de qualquer jeito).
   */
  private async ultimaMigracao(): Promise<string | null> {
    const linhas = await this.prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    const nome = linhas[0]?.migration_name;
    // Só o carimbo de tempo do começo do nome (20260909100000_algo → 20260909100000).
    return nome ? (nome.split("_")[0] ?? null) : null;
  }
}
