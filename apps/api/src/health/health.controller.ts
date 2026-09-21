import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";
import { Public } from "../auth/decorators/public.decorator";

/**
 * Quando este processo subiu.
 *
 * Módulo, não campo de instância: é o instante em que o Node carregou o
 * arquivo, e é o que responde "o deploy trocou o container?" — a pergunta que
 * sobra quando o push não traz migration nova nem rota nova pra sondar.
 */
const INICIADO_EM = new Date().toISOString();

/**
 * O redimensionador de imagem existe NESTE build?
 *
 * ⚠️ Pergunta que nenhuma tela responde. `sharp` é binário nativo e o runtime
 * é alpine; o import é dinâmico e protegido, então quando ele falta a API sobe
 * normalmente e o endpoint de miniatura serve o arquivo ORIGINAL. Visualmente
 * fica idêntico — a miniatura aparece igual — e o único sintoma é o pacote de
 * dados do motorista indo embora: 522 KB por documento em vez de 6 KB.
 *
 * Defeito que só aparece na conta de celular de outra pessoa precisa de sonda,
 * senão ninguém descobre.
 *
 * Cache em memória: a resposta não muda enquanto o processo viver.
 */
let miniaturaOk: boolean | null = null;
async function temRedimensionador(): Promise<boolean> {
  if (miniaturaOk !== null) return miniaturaOk;
  try {
    await import("sharp");
    miniaturaOk = true;
  } catch {
    miniaturaOk = false;
  }
  return miniaturaOk;
}

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
      /** Reiniciou depois do seu push? Então o deploy subiu. */
      iniciadoEm: INICIADO_EM,
      /**
       * Os dois serviços de estrada estão configurados?
       *
       * Só `true`/`false` — nunca a URL. Existe porque a falta deles não dá
       * erro em lugar nenhum: sem `OSRM_URL` todo km volta como "servidor de
       * rotas não configurado", e sem `VALHALLA_URL` a viagem guiada abre o
       * mapa SEM a linha da rota e sem voz, calada. Passei mais tempo do que
       * devia procurando isso no app quando a resposta estava numa env var.
       */
      rotas: {
        osrm: !!process.env.OSRM_URL,
        navegacao: !!process.env.VALHALLA_URL,
      },
      /**
       * `false` = as miniaturas de documento estão saindo em tamanho real e o
       * 4G do motorista está pagando por isso. Ver `temRedimensionador`.
       */
      miniatura: await temRedimensionador(),
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
