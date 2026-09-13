import { Logger } from "@nestjs/common";

/**
 * Roda um job de cron em UMA instância só, usando advisory lock do Postgres.
 *
 * POR QUE: os crons são `@Cron` in-process. Hoje há um container e funciona; no
 * dia em que a API ganhar uma segunda réplica — que é a primeira coisa que se
 * faz quando ela fica lenta — os dois processos disparam o mesmo job no mesmo
 * segundo. Em `resumo-motorista` isso é WhatsApp duplicado para a frota inteira;
 * em `expurgar-posicoes`, dois DELETE gigantes concorrendo; em
 * `precificar-pendentes`, duas escritas na mesma linha.
 *
 * POR QUE ADVISORY LOCK e não uma tabela de "job rodando": o lock do Postgres é
 * liberado sozinho quando a conexão cai. Uma linha numa tabela fica presa se o
 * processo morrer no meio, e aí o job nunca mais roda — e ninguém descobre,
 * porque "não rodou" é silencioso por natureza. Foi por isso que a tela de
 * pendentes precisou de stale-recovery.
 *
 * `pg_try_advisory_lock` não espera: se outra instância pegou, esta desiste na
 * hora. É o comportamento certo — o job vai rodar de qualquer jeito, só não
 * aqui.
 */

/** Cliente mínimo, tipado por forma (mesmo motivo de `teto-da-conta.ts`). */
type ClienteLock = {
  $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>;
};

const log = new Logger("CronExclusivo");

/**
 * Chave numérica estável a partir do nome do job.
 *
 * O advisory lock usa bigint, não texto. Hash djb2 truncado em 31 bits: o mesmo
 * nome sempre dá a mesma chave, em qualquer instância, sem precisar de registro
 * em lugar nenhum.
 */
export function chaveDoLock(nome: string): number {
  let h = 5381;
  for (let i = 0; i < nome.length; i++) {
    h = ((h << 5) + h + nome.charCodeAt(i)) | 0;
  }
  // Positivo e dentro de int4: o Postgres aceita bigint, mas manter pequeno
  // evita surpresa de precisão no driver.
  return Math.abs(h) % 2_000_000_000;
}

/**
 * Executa `fn` só se conseguir o lock. Devolve `false` se outra instância já
 * estava com ele.
 *
 * O lock é liberado no `finally` — e se o processo morrer antes disso, a queda
 * da conexão libera de qualquer jeito.
 */
export async function comLockDeCron(
  prisma: ClienteLock,
  nome: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  const chave = chaveDoLock(nome);

  const pegou = await prisma.$queryRawUnsafe<[{ ok: boolean }]>(
    "SELECT pg_try_advisory_lock($1) AS ok",
    chave,
  );
  if (!pegou[0]?.ok) {
    // Não é erro: é outra instância cuidando disso. Nível debug de propósito —
    // com duas réplicas, metade dos disparos cai aqui e virar ruído no log
    // faria alguém desligar o log em vez do ruído.
    log.debug(`"${nome}" já está rodando em outra instância — pulando`);
    return false;
  }

  try {
    await fn();
    return true;
  } finally {
    // `Unsafe` porque o Prisma não parametriza função de sistema com template
    // tag sem cast; a chave é um número derivado de uma constante do código,
    // nunca de entrada de usuário.
    await prisma
      .$queryRawUnsafe("SELECT pg_advisory_unlock($1)", chave)
      .catch((e: unknown) =>
        log.warn(`falha ao soltar o lock de "${nome}": ${(e as Error).message}`),
      );
  }
}
