import { Logger } from "@nestjs/common";
import { TRILHA_CONFERENCIA_MAX, type EventoTrilhaConferencia } from "@ronan/shared-types";

/**
 * Trilha durável de uma linha da conferência diária.
 *
 * Existe porque o dono não enxerga log: quando "o motorista tocou e o calendário
 * diz que está esperando", o que aconteceu tem que estar no banco, na ficha, pra
 * tirar print. Cada coisa que o webhook trata (ou ignora) e cada envio deixa um
 * evento aqui — id da linha, opção, origem, `context.id`, wamid, count do
 * updateMany, motivo de ignorar.
 *
 * ⚠️ Anexar NUNCA pode derrubar o fluxo (a resposta ao motorista já saiu): o
 * helper engole erro e só loga. E é SQL atômico (append + corte nos últimos N)
 * porque envio e toque podem gravar na mesma linha ao mesmo tempo — um
 * ler-modificar-gravar perderia evento justamente na corrida que se quer ver.
 */

export type TipoEventoTrilha = EventoTrilhaConferencia["evento"];

const log = new Logger("ConferenciaTrilha");

/** Regra pura (testada): acrescenta e mantém só os `max` mais recentes. */
export function acrescentarNaTrilha(
  atual: unknown,
  evento: EventoTrilhaConferencia,
  max: number = TRILHA_CONFERENCIA_MAX,
): EventoTrilhaConferencia[] {
  return [...lerTrilha(atual), evento].slice(-max);
}

/** Lê o Json da coluna sem confiar nele (linha antiga = `[]`, lixo = `[]`). */
export function lerTrilha(json: unknown): EventoTrilhaConferencia[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (e): e is EventoTrilhaConferencia =>
      !!e && typeof e === "object" && typeof (e as { em?: unknown }).em === "string" && typeof (e as { evento?: unknown }).evento === "string",
  );
}

export function novoEvento(evento: TipoEventoTrilha, detalhe: Record<string, unknown>, em: Date = new Date()): EventoTrilhaConferencia {
  return { em: em.toISOString(), evento, detalhe };
}

/** O mínimo do Prisma que o helper usa (facilita o teste com fake). */
type ComRaw = { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number> };

/**
 * Anexa um evento à trilha da linha. SQL cru: sempre filtra `contaId` (o cru não
 * passa pela trava de conta) e usa o nome do `@@map`.
 */
export async function anexarTrilha(
  prisma: unknown,
  alvo: { id: string; contaId: string },
  evento: TipoEventoTrilha,
  detalhe: Record<string, unknown>,
): Promise<void> {
  try {
    const ev = JSON.stringify(novoEvento(evento, { linhaId: alvo.id, ...detalhe }));
    await (prisma as ComRaw).$executeRaw`
      UPDATE "conferencia_diaria"
      SET "trilha" = COALESCE((
        SELECT jsonb_agg(x.e ORDER BY x.n)
        FROM (
          SELECT t.e, t.n
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof("trilha") = 'array' THEN "trilha" ELSE '[]'::jsonb END || ${ev}::jsonb
          ) WITH ORDINALITY AS t(e, n)
          ORDER BY t.n DESC
          LIMIT ${TRILHA_CONFERENCIA_MAX}
        ) x
      ), '[]'::jsonb)
      WHERE "id" = ${alvo.id} AND "contaId" = ${alvo.contaId}`;
  } catch (e) {
    log.warn(`não deu pra gravar a trilha da conferência ${alvo.id} (${evento}): ${(e as Error).message}`);
  }
}
