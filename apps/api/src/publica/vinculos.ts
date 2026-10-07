import type { Prisma } from "@prisma/client";

/**
 * O número de um registro nosso no sistema de fora (`VinculoExterno`).
 *
 * Uma tabela pra todas as entidades, e não uma coluna `externalId` em cada
 * uma: a mesma empresa costuma ter ERP + rastreador + app próprio, três
 * números pro MESMO caminhão. O `sistema` faz parte da chave.
 *
 * Tudo aqui recebe o client da transação: o vínculo é gravado junto com o
 * registro, ou nenhum dos dois.
 */

export type EntidadeExterna = "viagem" | "motorista" | "veiculo" | "local";

/** Client da transação OU o normal (pra leitura solta). Só o que se usa aqui. */
type Tx = Pick<Prisma.TransactionClient, "vinculoExterno" | "$executeRaw">;

export async function idPorExterno(
  tx: Tx,
  sistema: string,
  entidade: EntidadeExterna,
  idExterno: string,
): Promise<string | null> {
  const v = await tx.vinculoExterno.findFirst({
    where: { sistema, entidade, idExterno },
    select: { entidadeId: true },
  });
  return v?.entidadeId ?? null;
}

export async function externoPorId(
  tx: Tx,
  sistema: string,
  entidade: EntidadeExterna,
  entidadeId: string,
): Promise<string | null> {
  const v = await tx.vinculoExterno.findFirst({
    where: { sistema, entidade, entidadeId },
    select: { idExterno: true },
  });
  return v?.idExterno ?? null;
}

/** Os números de vários registros de uma vez (pra montar resposta sem N consultas). */
export async function externosPorIds(
  tx: Tx,
  sistema: string,
  entidade: EntidadeExterna,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const vs = await tx.vinculoExterno.findMany({
    where: { sistema, entidade, entidadeId: { in: ids } },
    select: { entidadeId: true, idExterno: true },
  });
  return new Map(vs.map((v) => [v.entidadeId, v.idExterno]));
}

/**
 * Grava o vínculo. Se o registro já tinha outro número neste sistema, o novo
 * vence (o sistema de fora renumerou). Chamar sempre dentro do lock do número
 * (`travarNumero`), senão dois pedidos simultâneos brigam pelo único.
 */
export async function vincular(
  tx: Tx,
  dados: { sistema: string; entidade: EntidadeExterna; entidadeId: string; idExterno: string; integracaoId: string },
): Promise<void> {
  await tx.vinculoExterno.deleteMany({
    where: { sistema: dados.sistema, entidade: dados.entidade, entidadeId: dados.entidadeId },
  });
  await tx.vinculoExterno.create({ data: dados });
}

/**
 * Segura o número (conta+sistema+entidade+número) até o fim da transação.
 *
 * Dois POST simultâneos com o mesmo número: sem isto os dois não acham
 * vínculo, os dois criam viagem, e uma delas vira duplicata faturada. Com
 * isto o segundo espera o primeiro terminar e acha o vínculo dele.
 */
export async function travarNumero(
  tx: Tx,
  contaId: string,
  sistema: string,
  entidade: EntidadeExterna,
  idExterno: string,
): Promise<void> {
  const chave = `${contaId}|${sistema}|${entidade}|${idExterno}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`;
}
