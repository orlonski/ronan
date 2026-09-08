import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  FAIXAS_TEMPO_CONFERENCIA,
  ORIGENS_CONFERENCIA,
  type EstatisticaTempoConferencia,
  type FaixaTempoConferencia,
  type OrigemConferencia,
  type PeriodoConferencia,
  type RecorteConferencia,
  type RelatorioConferenciaQuery,
  type RelatorioConferenciaResposta,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { contaIdAtual } from "../../common/conta/conta-context";
import { inicioDoDiaBR } from "../../common/timezone";
import type { EscopoAdmin } from "../../common/escopo/escopo";

/**
 * Histórico de tempo de conferência: quanto uma viagem espera entre chegar no
 * servidor e ser dada como conferida, mês a mês (ou semana a semana), separado
 * por quem conferiu.
 *
 * Por que SQL cru e não Prisma: mediana e p90 são `percentile_cont`, que o
 * Prisma não expressa. E trazer viagem a viagem pra calcular em memória (como
 * faz o relatório de produção) não se paga aqui — o recorte é o histórico
 * inteiro, não um mês.
 *
 * ATENÇÃO: `$queryRaw` NÃO passa pela trava de conta (`common/conta/trava-conta`).
 * Todo SELECT deste arquivo cita `contaId` na mão — foi exatamente aqui que os
 * vazamentos entre empresas apareceram antes.
 *
 * ---
 *
 * **O instante da conferência não é sempre `revisadoEm`.** Quando quem aprovou
 * foi o robô, o carimbo pode ter sido escrito muito depois da leitura: o script
 * `aprovar-conferencias-retroativo.ts` aprovou em lote vereditos que estavam
 * parados em modo sombra e gravou `revisadoEm = agora`. Ler esse carimbo ao pé
 * da letra faria um mês inteiro de leituras instantâneas aparecer como "levou
 * duas semanas".
 *
 * Então, pro lado IA, o instante é o `finalizadoEm` da conferência que aplicou o
 * veredito — a hora em que a IA de fato decidiu —, e o `LEAST` garante que isso
 * só puxa o tempo pra baixo, nunca pra cima. Sem conferência registrada, cai de
 * volta em `revisadoEm`.
 */
@Injectable()
export class RelatoriosConferenciaService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo(
    query: RelatorioConferenciaQuery,
    escopo: EscopoAdmin,
  ): Promise<RelatorioConferenciaResposta> {
    const inicio = inicioDoDiaBR(query.de);
    // `ate` é dia civil inclusive: a fronteira de cima é a meia-noite seguinte.
    const fim = new Date(inicioDoDiaBR(query.ate).getTime() + 86_400_000);
    const base = this.base(query, escopo, inicio, fim);
    const truncar = query.granularidade === "MES" ? Prisma.raw("'month'") : Prisma.raw("'week'");
    const formato = query.granularidade === "MES" ? Prisma.raw("'YYYY-MM'") : Prisma.raw("'YYYY-MM-DD'");
    const limites = FAIXAS_TEMPO_CONFERENCIA.map((f): number | null => f.limiteSegundos).filter(
      (l): l is number => l !== null,
    );

    const [linhas, faixasRows, leituraRows] = await Promise.all([
      // Uma query só resolve a série e os totais: os GROUPING SETS pedem ao
      // Postgres o mesmo recorte em quatro níveis de agregação. Mediana não se
      // soma, então o total do período TEM que ser calculado pelo banco sobre
      // todas as linhas — não dá pra derivar dos meses.
      this.prisma.$queryRaw<LinhaAgregada[]>`
        WITH base AS (${base}),
        marcado AS (
          SELECT
            origem,
            segundos,
            to_char(
              date_trunc(
                ${truncar},
                (conferido_em AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'
              ),
              ${formato}
            ) AS bucket
          FROM base
        )
        SELECT
          bucket,
          origem,
          GROUPING(bucket)::int AS g_bucket,
          GROUPING(origem)::int AS g_origem,
          COUNT(*)::int AS n,
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY segundos))::float8 AS p50,
          (percentile_cont(0.9) WITHIN GROUP (ORDER BY segundos))::float8 AS p90,
          AVG(segundos)::float8 AS media
        FROM marcado
        GROUP BY GROUPING SETS ((bucket, origem), (bucket), (origem), ())
      `,
      // `width_bucket` com os mesmos limites do catálogo em shared-types:
      // devolve 0 pra quem está abaixo do primeiro corte e N pra quem passou do
      // último — ou seja, o índice da faixa, já pronto.
      this.prisma.$queryRaw<Array<{ faixa: number; origem: string; n: number }>>`
        WITH base AS (${base})
        SELECT
          width_bucket(segundos, ${limites}::float8[]) AS faixa,
          origem,
          COUNT(*)::int AS n
        FROM base
        GROUP BY 1, 2
      `,
      this.leitura(query, escopo, inicio, fim),
    ]);

    const totais = vazio();
    const porBucket = new Map<string, RecorteConferencia>();

    for (const l of linhas) {
      const stat: EstatisticaTempoConferencia = {
        n: l.n,
        medianaSegundos: l.p50,
        p90Segundos: l.p90,
        mediaSegundos: l.media,
      };
      const alvo = l.g_bucket === 1 ? totais : (porBucket.get(l.bucket ?? "") ?? vazio());
      if (l.g_bucket === 0) porBucket.set(l.bucket ?? "", alvo);

      if (l.g_origem === 1) {
        alvo.geral = stat;
        alvo.total = l.n;
      } else if (ehOrigem(l.origem)) {
        alvo.porOrigem[l.origem] = stat;
      }
    }

    const periodos: PeriodoConferencia[] = chavesDoPeriodo(query).map(({ chave, rotulo }) => ({
      chave,
      rotulo,
      ...(porBucket.get(chave) ?? vazio()),
    }));

    return {
      periodo: { de: query.de, ate: query.ate, dias: diasEntre(query.de, query.ate) },
      granularidade: query.granularidade,
      periodos,
      totais,
      faixas: montarFaixas(faixasRows),
      leitura: leituraRows,
      meta: { geradoEm: new Date().toISOString() },
    };
  }

  /**
   * O universo do relatório: viagens conferidas dentro do período, cada uma com
   * a origem da conferência e quantos segundos ela esperou.
   *
   * Volta como fragmento reusado por duas queries (série e distribuição) em vez
   * de virar VIEW ou de rodar duas vezes escrito à mão — duas cópias divergiriam
   * no dia em que a regra de origem mudar, e aí os dois gráficos da mesma tela
   * diriam coisas diferentes.
   */
  private base(
    query: RelatorioConferenciaQuery,
    escopo: EscopoAdmin,
    inicio: Date,
    fim: Date,
  ): Prisma.Sql {
    // Instante em que a conferência aconteceu de fato — ver o cabeçalho.
    const conferidoEm = Prisma.sql`LEAST(v."revisadoEm", COALESCE(c."finalizadoEm", v."revisadoEm"))`;

    return Prisma.sql`
      SELECT
        CASE
          WHEN v."revisadoPorId" IS NOT NULL THEN 'HUMANO'
          WHEN v."conferenciaDispensadaEm" IS NOT NULL THEN 'DISPENSA'
          WHEN v."conferidoPorIaEm" IS NOT NULL THEN 'IA'
          ELSE 'OUTRO'
        END AS origem,
        ${conferidoEm} AS conferido_em,
        -- Relógio torto (ou backfill) já produziu carimbo anterior à chegada da
        -- viagem. Tempo negativo não existe: vira zero em vez de puxar a média.
        GREATEST(EXTRACT(EPOCH FROM (${conferidoEm} - v."sincronizadoEm")), 0)::float8 AS segundos
      FROM "viagens" v
      LEFT JOIN LATERAL (
        SELECT ct."finalizadoEm"
        FROM "conferencias_ticket" ct
        WHERE ct."viagemId" = v.id
          AND v."conferidoPorIaEm" IS NOT NULL
          AND ct."finalizadoEm" IS NOT NULL
          AND ct."aplicadoEm" IS NOT NULL
        ORDER BY ct."finalizadoEm" DESC
        LIMIT 1
      ) c ON TRUE
      WHERE v."contaId" = ${contaIdAtual()}
        AND v."revisadoEm" >= ${inicio}
        AND v."revisadoEm" < ${fim}
        ${this.frota(query, escopo)}
    `;
  }

  /** Tempo de máquina da leitura no mesmo período e no mesmo recorte de frota. */
  private async leitura(
    query: RelatorioConferenciaQuery,
    escopo: EscopoAdmin,
    inicio: Date,
    fim: Date,
  ): Promise<RelatorioConferenciaResposta["leitura"]> {
    // O JOIN com viagens não é decorativo: `conferencias_ticket` não carrega
    // `transportadoraId`, e sem ele um gestor de frota terceira veria o tempo de
    // leitura da base inteira.
    const rows = await this.prisma.$queryRaw<
      Array<{ n: number; p50: number | null; p90: number | null; media: number | null }>
    >`
      SELECT
        COUNT(*)::int AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ct."duracaoMs")::float8 AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY ct."duracaoMs")::float8 AS p90,
        AVG(ct."duracaoMs")::float8 AS media
      FROM "conferencias_ticket" ct
      JOIN "viagens" v ON v.id = ct."viagemId"
      WHERE ct."contaId" = ${contaIdAtual()}
        AND v."contaId" = ${contaIdAtual()}
        AND ct."status" = 'CONCLUIDA'
        AND ct."duracaoMs" IS NOT NULL
        AND ct."finalizadoEm" >= ${inicio}
        AND ct."finalizadoEm" < ${fim}
        ${this.frota(query, escopo)}
    `;
    const r = rows[0];
    return {
      leituras: r?.n ?? 0,
      medianaMs: r?.p50 ?? null,
      p90Ms: r?.p90 ?? null,
      mediaMs: r?.media ?? null,
    };
  }

  /**
   * Recorte de frota: o escopo do usuário (o que ele PODE ver) e o filtro que
   * ele escolheu na tela, em AND. Restrito sem vínculo nenhum devolve zero
   * linhas — fail-open aqui entregaria a base inteira.
   */
  private frota(query: RelatorioConferenciaQuery, escopo: EscopoAdmin): Prisma.Sql {
    return Prisma.sql`
      ${escopo ? Prisma.sql`AND v."transportadoraId" = ANY(${escopo.transportadoraIds}::text[])` : Prisma.empty}
      ${query.transportadoraId ? Prisma.sql`AND v."transportadoraId" = ${query.transportadoraId}` : Prisma.empty}
    `;
  }
}

type LinhaAgregada = {
  bucket: string | null;
  origem: string | null;
  g_bucket: number;
  g_origem: number;
  n: number;
  p50: number | null;
  p90: number | null;
  media: number | null;
};

const semDados = (): EstatisticaTempoConferencia => ({
  n: 0,
  medianaSegundos: null,
  p90Segundos: null,
  mediaSegundos: null,
});

function vazio(): RecorteConferencia {
  return {
    total: 0,
    geral: semDados(),
    porOrigem: Object.fromEntries(ORIGENS_CONFERENCIA.map((o) => [o, semDados()])) as Record<
      OrigemConferencia,
      EstatisticaTempoConferencia
    >,
  };
}

function ehOrigem(v: string | null): v is OrigemConferencia {
  return v !== null && (ORIGENS_CONFERENCIA as readonly string[]).includes(v);
}

function montarFaixas(rows: Array<{ faixa: number; origem: string; n: number }>): FaixaTempoConferencia[] {
  const faixas: FaixaTempoConferencia[] = FAIXAS_TEMPO_CONFERENCIA.map((f) => ({
    chave: f.chave,
    rotulo: f.rotulo,
    total: 0,
    porOrigem: Object.fromEntries(ORIGENS_CONFERENCIA.map((o) => [o, 0])) as Record<
      OrigemConferencia,
      number
    >,
  }));
  for (const r of rows) {
    const alvo = faixas[r.faixa];
    if (!alvo || !ehOrigem(r.origem)) continue;
    alvo.porOrigem[r.origem] += r.n;
    alvo.total += r.n;
  }
  return faixas;
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Todas as chaves de bucket do período, inclusive as que não tiveram nenhuma
 * conferência. Sem isso, um mês parado some do eixo e a série fica mentindo
 * sobre continuidade — o gráfico emendaria julho em setembro.
 *
 * As chaves são geradas com a MESMA regra do Postgres: mês pelo primeiro dia,
 * semana pela segunda-feira (`date_trunc('week')`).
 */
function chavesDoPeriodo(query: RelatorioConferenciaQuery): Array<{ chave: string; rotulo: string }> {
  const [y1, m1, d1] = query.de.split("-").map(Number);
  const [y2, m2, d2] = query.ate.split("-").map(Number);
  const out: Array<{ chave: string; rotulo: string }> = [];

  if (query.granularidade === "MES") {
    const cursor = new Date(Date.UTC(y1, m1 - 1, 1));
    const ultimo = new Date(Date.UTC(y2, m2 - 1, 1));
    while (cursor <= ultimo) {
      const y = cursor.getUTCFullYear();
      const m = cursor.getUTCMonth();
      out.push({
        chave: `${y}-${pad(m + 1)}`,
        rotulo: `${MESES[m]}/${String(y).slice(2)}`,
      });
      cursor.setUTCMonth(m + 1);
    }
    return out;
  }

  const cursor = segunda(new Date(Date.UTC(y1, m1 - 1, d1)));
  const ultimo = segunda(new Date(Date.UTC(y2, m2 - 1, d2)));
  while (cursor <= ultimo) {
    out.push({
      chave: `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`,
      rotulo: `${pad(cursor.getUTCDate())}/${pad(cursor.getUTCMonth() + 1)}`,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

/** Segunda-feira da semana de `d`, igual ao `date_trunc('week')` do Postgres. */
function segunda(d: Date): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
  return out;
}
