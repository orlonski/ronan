import { Logger } from "@nestjs/common";
import { comConta, comoSistema } from "./conta-context";

const log = new Logger("paraCadaConta");

/**
 * Cliente mínimo pra listar contas. Tipado por forma, e não como
 * `PrismaService`, porque este arquivo é importado pela própria trava — o
 * import direto fecharia um ciclo.
 */
type ClienteContas = {
  conta: {
    findMany: (args: {
      where: { ativa: boolean };
      select: { id: true; nome: true };
      orderBy: { criadaEm: "asc" };
    }) => Promise<{ id: string; nome: string }[]>;
  };
};

/**
 * Roda `fn` uma vez por conta ativa, cada uma dentro do seu próprio contexto —
 * então tudo que `fn` fizer já sai filtrado pela conta da vez.
 *
 * É o padrão pra tudo que roda fora de uma requisição e vale pra todo mundo:
 * seeds de boot, crons (resumo diário, reprocessamento de km, limpezas). Rodar
 * esse tipo de trabalho em `comoSistema` seria pior que um bug de tela — o
 * resumo diário da Schaba sairia com as viagens da outra empresa.
 *
 * Uma conta que falha não derruba as outras: o erro é registrado e a varredura
 * continua. Um cron não pode parar de rodar pra todo mundo porque uma empresa
 * está com dado inconsistente.
 */
export async function paraCadaConta(
  prisma: ClienteContas,
  fn: (contaId: string) => Promise<void>,
): Promise<void> {
  const contas = await comoSistema(() =>
    prisma.conta.findMany({
      where: { ativa: true },
      select: { id: true, nome: true },
      orderBy: { criadaEm: "asc" },
    }),
  );

  for (const conta of contas) {
    try {
      await comConta(conta.id, () => fn(conta.id));
    } catch (erro) {
      log.error(
        `Falhou na conta ${conta.nome} (${conta.id}): ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
    }
  }
}
