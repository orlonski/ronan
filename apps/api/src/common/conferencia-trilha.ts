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

// ─── Recibo da Meta (sent / delivered / read / failed) ────────────────────

export type StatusMeta = {
  wamid: string;
  status: string;
  codigo?: number | null;
  titulo?: string | null;
  mensagem?: string | null;
  /** `timestamp` do webhook (segundos desde 1970, string). */
  timestamp?: string | null;
};

const cortar = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);

/** Segundos da Meta -> ISO. Lixo vira `null` (o evento usa `em` mesmo assim). */
export function metaTimestampParaIso(ts: string | null | undefined): string | null {
  const n = Number(ts);
  if (!ts || !Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

/** Regra pura (testada): a Meta manda sent -> delivered -> read no mesmo wamid; só o que é novo entra. */
export function statusJaNaTrilha(trilha: unknown, s: StatusMeta): boolean {
  return lerTrilha(trilha).some((e) => {
    if (e.evento !== "STATUS") return false;
    const d = e.detalhe as Record<string, unknown>;
    if (d.wamid !== s.wamid || d.status !== s.status) return false;
    // failed sempre entra, exceto o reenvio idêntico do MESMO webhook (mesmo código e mesmo instante).
    if (s.status !== "failed") return true;
    return (d.codigo ?? null) === (s.codigo ?? null) && (d.metaEm ?? null) === metaTimestampParaIso(s.timestamp);
  });
}

/** Texto curto da falha, pro `erroEnvio` da linha. */
export function resumoFalhaMeta(s: StatusMeta): string {
  const partes = [cortar(s.titulo, 80), cortar(s.mensagem, 160)].filter(Boolean);
  const cod = s.codigo != null ? ` (${s.codigo})` : "";
  return `A Meta aceitou o envio mas não entregou${cod}${partes.length ? `: ${partes.join(" — ")}` : "."}`.slice(0, 300);
}

type ComConferencia = ComRaw & {
  conferenciaDiaria: {
    findFirst: (a: unknown) => Promise<{
      id: string;
      contaId: string;
      trilha: unknown;
      wamid: string | null;
      lembreteWamid: string | null;
    } | null>;
    updateMany: (a: unknown) => Promise<{ count: number }>;
  };
};

/**
 * Anexa o recibo da Meta à linha da conferência dona do wamid (pergunta ou
 * lembrete). Nunca lança. Devolve `true` se anexou. Quem chama roda em
 * `comoSistema` (o webhook não tem conta); o isolamento vem de usar o
 * `contaId` da PRÓPRIA linha achada em todo write.
 *
 * Em `failed` também grava um resumo em `erroEnvio` — sem mudar o estado: a
 * pergunta continua "ENVIADA" (a Meta aceitou), só passa a dizer que não chegou.
 */
export async function registrarStatusMetaNaConferencia(prisma: unknown, s: StatusMeta): Promise<boolean> {
  try {
    const db = prisma as ComConferencia;
    const linha = await db.conferenciaDiaria.findFirst({
      where: { OR: [{ wamid: s.wamid }, { lembreteWamid: s.wamid }] },
      select: { id: true, contaId: true, trilha: true, wamid: true, lembreteWamid: true },
    });
    if (!linha) return false;
    if (statusJaNaTrilha(linha.trilha, s)) return false;
    const alvo = linha.wamid === s.wamid ? "PERGUNTA" : "LEMBRETE";
    await anexarTrilha(prisma, { id: linha.id, contaId: linha.contaId }, "STATUS", {
      status: s.status,
      wamid: s.wamid,
      alvo,
      codigo: s.codigo ?? null,
      titulo: cortar(s.titulo, 120),
      mensagem: cortar(s.mensagem, 200),
      metaEm: metaTimestampParaIso(s.timestamp),
    });
    if (s.status === "failed") {
      await db.conferenciaDiaria.updateMany({
        where: { id: linha.id, contaId: linha.contaId },
        data: { erroEnvio: resumoFalhaMeta(s) },
      });
    }
    return true;
  } catch (e) {
    log.warn(`não deu pra registrar o status da Meta na conferência (${s.wamid}): ${(e as Error).message}`);
    return false;
  }
}
