/**
 * Roda o espelho do acesso do app agora, sem esperar o cron da hora cheia.
 *
 *   cd apps/api && pnpm acesso:espelhar                  # todas as contas ativas
 *   cd apps/api && pnpm acesso:espelhar -- --conta schaba
 *
 * É o mesmo código do cron (`AcessoAppService.sincronizar`). Não muda nada pra
 * ninguém: escreve só o espelho (perfis herdados, exceções de origem
 * MIGRACAO e o efetivo), e só se o cálculo reproduzir a ficha de cada
 * motorista aprovado. Se não reproduzir, não escreve nada e diz quem divergiu.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { AcessoAppService } from "../common/acesso-app/acesso-app.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { travaConta } from "../common/conta/trava-conta";
import type { PrismaService } from "../prisma/prisma.service";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const contaSlug = arg("--conta");
  const base = new PrismaClient();
  const prisma = base.$extends(travaConta) as unknown as PrismaService;
  const service = new AcessoAppService(prisma);

  const contas = await comoSistema(() =>
    base.conta.findMany({
      where: contaSlug ? { slug: contaSlug } : { ativa: true },
      select: { id: true, nome: true },
      orderBy: { criadaEm: "asc" },
    }),
  );

  for (const conta of contas) {
    await comConta(conta.id, async () => {
      const r = await service.sincronizar("SCRIPT");
      const cfg = await prisma.configuracaoAcessoApp.findUnique({ where: { contaId: conta.id } });
      const excecoes = await prisma.excecaoAcessoApp.count({ where: { revogadaEm: null } });
      const padrao = cfg?.perfilPadraoMotoristaId
        ? await prisma.perfilAcessoApp.findFirst({
            where: { id: cfg.perfilPadraoMotoristaId },
            select: { capacidades: true },
          })
        : null;
      console.log(`\n${conta.nome}`);
      console.log(`  pessoas: ${r.pessoas}  mudaram: ${r.mudaram}  exceções vivas: ${excecoes}`);
      console.log(`  padrão herdado: ${padrao?.capacidades.join(", ") ?? "—"}`);
      if (r.divergencias > 0) {
        console.log(`  ⚠️ ${r.divergencias} divergência(s) — NADA foi escrito:`);
        console.log(JSON.stringify(cfg?.espelhoDetalhe, null, 2));
      }
    });
  }
  await base.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
