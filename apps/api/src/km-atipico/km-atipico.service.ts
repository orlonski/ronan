import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  avaliarKm,
  type ConfigKmAtipico,
  type EstatisticaPar,
  type FonteReferenciaKm,
  type ReferenciaKmPayload,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { EscopoAdmin } from "../common/escopo/escopo";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { inicioDiasAtras } from "../common/timezone";
import { contaIdAtual } from "../common/conta/conta-context";

/** Referência de km de um par carga→descarga, com as duas fontes lado a lado. */
export type ReferenciaKm = ReferenciaKmPayload & {
  /** Viagens do par marcadas atípicas e ainda não revisadas — não entram na
   *  mediana. Muitas = sinal de que a mediana envelheceu (rota mudou de regime),
   *  não de que a frota piorou. Exibido no card do painel. */
  quarentena: number;
};

/** Uma viagem comparável do par, pro card do painel. */
export type ComparavelKm = {
  /** Null quando a viagem é de outra frota: serve de referência, mas não abre. */
  id: string | null;
  data: Date | null;
  km: number;
  motoristaNome: string | null;
  status: string;
};

/** Payload completo do card de referência de km de UMA viagem. */
export type DetalheReferenciaKm = {
  /** false = o km desta viagem não descreve o par (troca de local sem recálculo
   *  / km inconsistente). Nesse caso NÃO devolve números — só a explicação. */
  baseConsistente: boolean;
  motivoInconsistencia: string | null;
  estaViagem: {
    km: number | null;
    kmCalculado: number | null;
    kmFonte: string | null;
    temTrechos: boolean;
  };
  historico: EstatisticaPar | null;
  osrm: { km: number } | null;
  efetiva: { km: number; fonte: FonteReferenciaKm } | null;
  carimbo: {
    kmForaDoPadrao: boolean | null;
    kmReferencia: number | null;
    kmReferenciaFonte: string | null;
    kmReferenciaAmostra: number | null;
    kmDesvioPct: number | null;
    kmAvaliadoEm: Date | null;
    justificativaKm: string | null;
  };
  /** Observação da viagem — virou o lugar da justificativa de km (unificado). */
  observacao: string | null;
  comparaveis: ComparavelKm[];
  quarentena: number;
  config: ConfigKmAtipico;
};

/**
 * Detecção de km atípico por trajeto. Compara o km de uma viagem com o que a
 * frota já rodou no mesmo par de locais (mediana das viagens comparáveis) ou,
 * sem amostra suficiente, com a rota calculada (OSRM).
 *
 * A REGRA de decisão (fora do padrão ou não) NÃO mora aqui — mora em
 * `avaliarKm` (shared-types), compartilhada com o app pra os dois lados darem
 * sempre o mesmo veredito sobre a mesma viagem. Este service só junta os dados
 * (mediana + OSRM + config) e carimba o resultado na viagem.
 *
 * LIMITAÇÃO CONHECIDA (catraca): viagem atípica entra em "quarentena" e sai da
 * mediana (senão o erro se auto-perpetua). Mas se a rota muda de regime de
 * verdade (acesso novo, +km permanentes), toda viagem nova é marcada e a
 * mediana congela no passado. Não auto-corrigimos — mudança de regime é
 * indistinguível de erro coletivo. A saída é humana: "Aceitar km" no painel
 * (kmAceitoEm — dedicado, NÃO é o revisadoEm da pré-validação) readmite a
 * viagem na mediana. O contador de quarentena no card torna a deriva visível.
 */
@Injectable()
export class KmAtipicoService {
  private readonly log = new Logger(KmAtipicoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roteamento: RoteamentoService,
  ) {}

  /** Config singleton (upsert garante o "default"), já convertida pra números. */
  private async config(): Promise<ConfigKmAtipico> {
    const c = await this.prisma.configuracaoKmAtipico.upsert({
      where: { contaId: contaIdAtual() },
      update: {},
      create: {},
    });
    return {
      ativo: c.ativo,
      desvioPct: c.desvioPct,
      desvioPctOsrm: c.desvioPctOsrm,
      amostraMinima: c.amostraMinima,
      janelaDias: c.janelaDias,
      kmMinimoAvaliado: Number(c.kmMinimoAvaliado),
    };
  }

  /** Trava anti-reentrância do backfill (in-memory; 1 processo por vez). */
  private reavaliando = false;

  /** Contadores pro painel decidir se vale rodar o backfill. */
  async status(): Promise<{
    pendentes: number;
    avaliadas: number;
    atipicas: number;
    rodando: boolean;
  }> {
    const [pendentes, avaliadas, atipicas] = await Promise.all([
      this.prisma.viagem.count({
        where: {
          kmAvaliadoEm: null,
          localCargaId: { not: null },
          localDescargaId: { not: null },
          km: { not: null },
        },
      }),
      this.prisma.viagem.count({ where: { kmAvaliadoEm: { not: null } } }),
      this.prisma.viagem.count({ where: { kmForaDoPadrao: true } }),
    ]);
    return { pendentes, avaliadas, atipicas, rodando: this.reavaliando };
  }

  /**
   * Backfill: avalia as viagens que ainda não foram carimbadas (kmAvaliadoEm
   * null). Roda em lotes, fire-and-forget. Como avaliarViagem sempre seta
   * kmAvaliadoEm (inclusive nas não-avaliáveis), o filtro `null` esvazia sozinho
   * e o loop termina. Idempotente: re-rodar só pega o que sobrou. Uma execução
   * por vez (trava in-memory).
   */
  async reavaliarTudo(): Promise<void> {
    if (this.reavaliando) return;
    this.reavaliando = true;
    let total = 0;
    try {
      for (;;) {
        const lote = await this.prisma.viagem.findMany({
          where: {
            kmAvaliadoEm: null,
            localCargaId: { not: null },
            localDescargaId: { not: null },
            km: { not: null },
          },
          select: { id: true },
          take: 200,
        });
        if (lote.length === 0) break;
        for (const v of lote) await this.avaliarViagem(v.id);
        total += lote.length;
        if (lote.length < 200) break;
      }
      this.log.log(`reavaliarTudo: ${total} viagens avaliadas`);
    } catch (err) {
      this.log.warn(`reavaliarTudo falhou após ${total}: ${(err as Error).message}`);
    } finally {
      this.reavaliando = false;
    }
  }

  /**
   * Referência completa do par: histórico (mediana das comparáveis), OSRM, a
   * fonte efetiva (histórico vence quando amostra >= mínima) e a quarentena.
   * `excluirViagemId` tira a própria viagem da amostra (senão ela se compara
   * consigo mesma / se auto-normaliza no re-carimbo).
   *
   * `osrmRef` é o kmCalculado da viagem (o snapshot OSRM da rota que ela
   * realmente fez) — quando presente, é a referência OSRM (mais fiel que
   * recalcular). Sem ele, calcula a rota (direta) pelo OSRM.
   */
  async referenciaDoPar(
    cargaId: string,
    descargaId: string,
    opts: {
      excluirViagemId?: string;
      osrmRef?: number | null;
    } = {},
  ): Promise<ReferenciaKm> {
    const { excluirViagemId, osrmRef } = opts;
    const config = await this.config();

    const osrmPromise: Promise<{ km: number } | null> =
      osrmRef != null && Number.isFinite(osrmRef)
        ? Promise.resolve({ km: osrmRef })
        : this.kmOsrm(cargaId, descargaId);

    const [historico, osrm, quarentena] = await Promise.all([
      this.estatisticaPar(cargaId, descargaId, config, excluirViagemId),
      osrmPromise,
      this.prisma.viagem.count({
        where: {
          localCargaId: cargaId,
          localDescargaId: descargaId,
          kmForaDoPadrao: true,
          kmAceitoEm: null,
          ...(excluirViagemId ? { id: { not: excluirViagemId } } : {}),
        },
      }),
    ]);

    let efetiva: { km: number; fonte: FonteReferenciaKm } | null = null;
    if (historico && historico.amostra >= config.amostraMinima) {
      efetiva = { km: historico.mediana, fonte: "HISTORICO" };
    } else if (osrm) {
      efetiva = { km: osrm.km, fonte: "ROTA_OSRM" };
    }

    return { historico, osrm, efetiva, config, quarentena };
  }

  /**
   * Referência de um par pro APP (mesma forma que `avaliarKm` consome). Sem a
   * quarentena — o app não precisa dela. Usada no endpoint on-demand.
   */
  async referenciaParaApp(
    cargaId: string,
    descargaId: string,
  ): Promise<ReferenciaKmPayload> {
    const ref = await this.referenciaDoPar(cargaId, descargaId);
    return { historico: ref.historico, osrm: ref.osrm, efetiva: ref.efetiva, config: ref.config };
  }

  /**
   * Pares que ESTE motorista roda (janela `dias`) com a mediana de cada — pro app
   * pré-cachear ao logar/reconectar e mostrar a sugestão offline. Sem OSRM de
   * propósito: em rota que ele repete, a amostra histórica basta pra `efetiva`, e
   * poupa uma chamada de roteador por par. O par fora do pré-cache é resolvido
   * on-demand (com OSRM) por `referenciaParaApp`.
   */
  async referenciasDoMotorista(
    motoristaId: string,
    dias: number,
  ): Promise<{
    pares: Array<ReferenciaKmPayload & { cargaId: string; descargaId: string }>;
    config: ConfigKmAtipico;
  }> {
    const config = await this.config();
    const desde = inicioDiasAtras(dias);

    const distintos = await this.prisma.$queryRaw<
      { cargaId: string; descargaId: string }[]
    >`
      SELECT DISTINCT v."localCargaId" AS "cargaId", v."localDescargaId" AS "descargaId"
      FROM viagens v
      WHERE v."contaId" = ${contaIdAtual()}
        AND v."motoristaId" = ${motoristaId}
        AND v."localCargaId" IS NOT NULL
        AND v."localDescargaId" IS NOT NULL
        AND v.data >= ${desde}
      LIMIT 100
    `;

    const pares = [];
    for (const p of distintos) {
      const historico = await this.estatisticaPar(p.cargaId, p.descargaId, config);
      const efetiva =
        historico && historico.amostra >= config.amostraMinima
          ? { km: historico.mediana, fonte: "HISTORICO" as const }
          : null;
      pares.push({
        cargaId: p.cargaId,
        descargaId: p.descargaId,
        historico,
        osrm: null,
        efetiva,
        config,
      });
    }
    return { pares, config };
  }

  /**
   * (Re)avalia UMA viagem e carimba kmForaDoPadrao + referência. Best-effort:
   * nunca lança (é chamado fire-and-forget no create/reprocessamento). NUNCA
   * mexe em justificativaKm (fato do motorista). Quando não dá pra avaliar
   * (sem locais, com trechos, km inconsistente, sem referência), carimba
   * "não avaliado" (nulls) — honesto, em vez de deixar carimbo velho de pé.
   */
  async avaliarViagem(viagemId: string): Promise<void> {
    try {
      const v = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: {
          id: true,
          km: true,
          kmCalculado: true,
          kmEditadoManual: true,
          kmFonte: true,
          localCargaId: true,
          localDescargaId: true,
          _count: { select: { trechos: true } },
        },
      });
      if (!v) return;

      const kmNum = v.km == null ? null : Number(v.km);
      const avaliavel =
        !!v.localCargaId &&
        !!v.localDescargaId &&
        kmNum != null &&
        kmNum > 0 &&
        v._count.trechos === 0 &&
        this.baseConsistente(kmNum, v.kmCalculado, v.kmFonte, v.kmEditadoManual);

      if (!avaliavel) {
        await this.carimbar(v.id, null);
        return;
      }

      const ref = await this.referenciaDoPar(v.localCargaId!, v.localDescargaId!, {
        excluirViagemId: v.id,
        osrmRef: v.kmCalculado == null ? null : Number(v.kmCalculado),
      });
      const resultado = avaliarKm(kmNum, ref);
      await this.carimbar(v.id, resultado, ref);
    } catch (err) {
      this.log.warn(`avaliarViagem(${viagemId}) falhou: ${(err as Error).message}`);
    }
  }

  /** Grava o carimbo (ou o "não avaliado" com resultado null). */
  private async carimbar(
    viagemId: string,
    resultado: ReturnType<typeof avaliarKm>,
    ref?: ReferenciaKm,
  ): Promise<void> {
    if (resultado == null) {
      await this.prisma.viagem.update({
        where: { id: viagemId },
        data: {
          kmForaDoPadrao: null,
          kmReferencia: null,
          kmReferenciaFonte: null,
          kmReferenciaAmostra: null,
          kmDesvioPct: null,
          kmAvaliadoEm: new Date(),
        },
      });
      return;
    }
    const amostra =
      resultado.fonte === "HISTORICO" ? (ref?.historico?.amostra ?? 0) : 0;
    await this.prisma.viagem.update({
      where: { id: viagemId },
      data: {
        kmForaDoPadrao: resultado.foraDoPadrao,
        kmReferencia: resultado.referencia,
        kmReferenciaFonte: resultado.fonte,
        kmReferenciaAmostra: amostra,
        kmDesvioPct: resultado.desvioPct,
        kmAvaliadoEm: new Date(),
      },
    });
  }

  /** Espelha em JS o filtro de "base consistente" do SQL (§2.1), pra UMA viagem:
   *  o km descreve mesmo este par? Procedência declarada ou km ~ kmCalculado. */
  private baseConsistente(
    km: number,
    kmCalculado: unknown,
    kmFonte: string | null,
    kmEditadoManual: boolean | null,
  ): boolean {
    if (kmFonte === "MANUAL" || kmFonte === "HISTORICO") return true;
    if (kmEditadoManual === true) return true;
    if (kmCalculado == null) return true;
    const calc = Number(kmCalculado);
    return Math.abs(km - calc) <= Math.max(1.0, 0.15 * calc);
  }

  /** Km da rota calculada (OSRM, com cache). Null se não resolver. */
  private async kmOsrm(
    cargaId: string,
    descargaId: string,
  ): Promise<{ km: number } | null> {
    try {
      const r = await this.roteamento.calcularKm(cargaId, descargaId);
      return r.km == null ? null : { km: parseFloat(r.km) };
    } catch {
      return null;
    }
  }

  /**
   * O filtro que define quem é uma viagem COMPARÁVEL do par — o coração da
   * honestidade da feature. Fragmento único, consumido pela mediana e pela lista
   * de comparáveis, pra os dois nunca divergirem. Exclui viagem com trecho (km
   * inclui o trecho), em quarentena, e — o mais importante — a que tem km
   * inconsistente com o par (troca de local sem recálculo), que entraria como
   * mediana podre com cara de estatística. Ver plano §2.1.
   */
  /**
   * A amostra que serve de referência de km. SQL cru não passa pela trava, então
   * o `contaId` entra aqui na mão.
   *
   * Repare que conta e transportadora se comportam de forma OPOSTA de propósito:
   * a frota é uma fronteira macia (a amostra inclui as outras frotas da mesma
   * empresa e só esconde a identificação — recortar destruiria a estatística),
   * enquanto a conta é uma fronteira dura. Quanto uma empresa roda entre dois
   * pontos é informação dela; a empresa nova não calibra o km dela pelo
   * histórico da Schaba.
   */
  private filtroAmostra(
    cargaId: string,
    descargaId: string,
    desde: Date,
    excluirViagemId?: string,
  ): Prisma.Sql {
    const excluir = excluirViagemId ?? null;
    return Prisma.sql`
      v."contaId" = ${contaIdAtual()}
      AND v."localCargaId" = ${cargaId}
      AND v."localDescargaId" = ${descargaId}
      AND (${excluir}::text IS NULL OR v.id <> ${excluir})
      AND v.km IS NOT NULL AND v.km > 0
      AND v.data >= ${desde}
      AND v.status::text NOT IN ('RASCUNHO_OFFLINE','EM_ANDAMENTO','AGUARDANDO_PESO','DIVERGENTE')
      AND NOT EXISTS (SELECT 1 FROM trechos_viagem t WHERE t."viagemId" = v.id)
      AND NOT (v."kmForaDoPadrao" IS TRUE AND v."kmAceitoEm" IS NULL)
      AND (
            v."kmFonte"::text IN ('MANUAL','HISTORICO') OR v."kmEditadoManual" IS TRUE
         OR v."kmCalculado" IS NULL
         OR abs(v.km - v."kmCalculado") <= GREATEST(1.0, 0.15 * v."kmCalculado")
      )`;
  }

  /** Mediana (+ quartis/faixa/amostra) das viagens comparáveis do par. */
  private async estatisticaPar(
    cargaId: string,
    descargaId: string,
    config: ConfigKmAtipico,
    excluirViagemId?: string,
  ): Promise<EstatisticaPar | null> {
    const desde = inicioDiasAtras(config.janelaDias);
    const filtro = this.filtroAmostra(cargaId, descargaId, desde, excluirViagemId);

    type StatRow = {
      mediana: number | null;
      p25: number | null;
      p75: number | null;
      min: number | null;
      max: number | null;
      amostra: bigint;
    };

    const rows = await this.prisma.$queryRaw<StatRow[]>`
      SELECT
        (percentile_cont(0.5)  WITHIN GROUP (ORDER BY v.km))::float8 AS mediana,
        (percentile_cont(0.25) WITHIN GROUP (ORDER BY v.km))::float8 AS p25,
        (percentile_cont(0.75) WITHIN GROUP (ORDER BY v.km))::float8 AS p75,
        MIN(v.km)::float8 AS min,
        MAX(v.km)::float8 AS max,
        COUNT(*) AS amostra
      FROM viagens v
      WHERE ${filtro}
    `;

    const r = rows[0];
    const amostra = r ? Number(r.amostra) : 0;
    if (amostra === 0 || r?.mediana == null) return null;
    return {
      mediana: r.mediana,
      amostra,
      p25: r.p25 ?? r.mediana,
      p75: r.p75 ?? r.mediana,
      min: r.min ?? r.mediana,
      max: r.max ?? r.mediana,
    };
  }

  /** Últimas N viagens comparáveis do par, com nome do motorista, pro card. */
  private async comparaveisDoPar(
    cargaId: string,
    descargaId: string,
    config: ConfigKmAtipico,
    excluirViagemId: string,
    escopo: EscopoAdmin,
    limite = 10,
  ): Promise<ComparavelKm[]> {
    const desde = inicioDiasAtras(config.janelaDias);
    const filtro = this.filtroAmostra(cargaId, descargaId, desde, excluirViagemId);

    type Row = {
      id: string;
      data: Date | null;
      km: number;
      motoristaNome: string | null;
      status: string;
      transportadoraId: string | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT v.id, v.data, v.km::float8 AS km, v.status::text AS status, m.nome AS "motoristaNome",
             v."transportadoraId"
      FROM viagens v
      LEFT JOIN motoristas m ON m.id = v."motoristaId"
      WHERE ${filtro}
      ORDER BY v.data DESC NULLS LAST, v."sincronizadoEm" DESC
      LIMIT ${limite}
    `;
    // A referência de km vale justamente por comparar com o que a FROTA INTEIRA
    // já rodou no mesmo par — recortar a amostra pelo escopo destruiria a
    // estatística. Então mantém o número e tira a identificação: sem `id` o
    // painel não monta o link (o gestor não abre viagem de outra frota, que de
    // todo jeito responderia 404), e sem `motoristaNome` não descobre quem é.
    const daFrota = (t: string | null) =>
      !escopo || (t != null && escopo.transportadoraIds.includes(t));
    return rows.map((r) => {
      const minha = daFrota(r.transportadoraId);
      return {
        id: minha ? r.id : null,
        data: r.data,
        km: r.km,
        motoristaNome: minha ? r.motoristaNome : null,
        status: r.status,
      };
    });
  }

  /**
   * Card completo de referência de UMA viagem, pro detalhe no painel. Retorna
   * null se a viagem não existe (o caller lança o 404). Quando a base é
   * inconsistente ou não avaliável, devolve `baseConsistente: false` e NÃO expõe
   * números — o card recusa em vez de exibir estatística sobre km podre.
   */
  async detalheReferencia(
    viagemId: string,
    escopo: EscopoAdmin,
  ): Promise<DetalheReferenciaKm | null> {
    const v = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        km: true,
        kmCalculado: true,
        kmFonte: true,
        kmEditadoManual: true,
        localCargaId: true,
        localDescargaId: true,
        kmForaDoPadrao: true,
        kmReferencia: true,
        kmReferenciaFonte: true,
        kmReferenciaAmostra: true,
        kmDesvioPct: true,
        kmAvaliadoEm: true,
        justificativaKm: true,
        observacao: true,
        _count: { select: { trechos: true } },
      },
    });
    if (!v) return null;

    const config = await this.config();
    const kmNum = v.km == null ? null : Number(v.km);
    const temTrechos = v._count.trechos > 0;
    const estaViagem = {
      km: kmNum,
      kmCalculado: v.kmCalculado == null ? null : Number(v.kmCalculado),
      kmFonte: v.kmFonte,
      temTrechos,
    };
    const carimbo = {
      kmForaDoPadrao: v.kmForaDoPadrao,
      kmReferencia: v.kmReferencia == null ? null : Number(v.kmReferencia),
      kmReferenciaFonte: v.kmReferenciaFonte,
      kmReferenciaAmostra: v.kmReferenciaAmostra,
      kmDesvioPct: v.kmDesvioPct == null ? null : Number(v.kmDesvioPct),
      kmAvaliadoEm: v.kmAvaliadoEm,
      justificativaKm: v.justificativaKm,
    };

    // Motivo de não ter números (mesma ordem do avaliável em avaliarViagem).
    let motivo: string | null = null;
    if (!v.localCargaId || !v.localDescargaId) motivo = "Viagem sem locais de carga/descarga definidos.";
    else if (temTrechos) motivo = "Viagem com trechos extras (bota-fora): o km inclui as pernas adicionais e não descreve só o par carga→descarga.";
    else if (kmNum == null || kmNum <= 0) motivo = "Viagem sem km.";
    else if (!this.baseConsistente(kmNum, v.kmCalculado, v.kmFonte, v.kmEditadoManual))
      motivo = "O km desta viagem diverge do trajeto calculado sem procedência declarada — provavelmente o local foi trocado sem recalcular. Recalcule o trajeto pra comparar.";

    const base = {
      estaViagem,
      carimbo,
      config,
      observacao: v.observacao,
    };

    if (motivo != null) {
      return {
        baseConsistente: false,
        motivoInconsistencia: motivo,
        historico: null,
        osrm: null,
        efetiva: null,
        comparaveis: [],
        quarentena: 0,
        ...base,
      };
    }

    const [ref, comparaveis] = await Promise.all([
      this.referenciaDoPar(v.localCargaId!, v.localDescargaId!, {
        excluirViagemId: viagemId,
        osrmRef: v.kmCalculado == null ? null : Number(v.kmCalculado),
      }),
      this.comparaveisDoPar(v.localCargaId!, v.localDescargaId!, config, viagemId, escopo),
    ]);

    return {
      baseConsistente: true,
      motivoInconsistencia: null,
      historico: ref.historico,
      osrm: ref.osrm,
      efetiva: ref.efetiva,
      comparaveis,
      quarentena: ref.quarentena,
      ...base,
    };
  }
}
