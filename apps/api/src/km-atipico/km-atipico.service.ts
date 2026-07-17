import { Injectable, Logger } from "@nestjs/common";
import {
  avaliarKm,
  type ConfigKmAtipico,
  type EstatisticaPar,
  type FonteReferenciaKm,
  type ReferenciaKmPayload,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { inicioDiasAtras } from "../common/timezone";

/** Referência de km de um par carga→descarga, com as duas fontes lado a lado. */
export type ReferenciaKm = ReferenciaKmPayload & {
  /** Viagens do par marcadas atípicas e ainda não revisadas — não entram na
   *  mediana. Muitas = sinal de que a mediana envelheceu (rota mudou de regime),
   *  não de que a frota piorou. Exibido no card do painel. */
  quarentena: number;
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
 * (revisadoEm) readmite a viagem na mediana. O contador de quarentena no card
 * torna a deriva visível.
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
      where: { id: "default" },
      update: {},
      create: { id: "default" },
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

  /**
   * Referência completa do par: histórico (mediana das comparáveis), OSRM, a
   * fonte efetiva (histórico vence quando amostra >= mínima) e a quarentena.
   * `excluirViagemId` tira a própria viagem da amostra (senão ela se compara
   * consigo mesma / se auto-normaliza no re-carimbo).
   */
  async referenciaDoPar(
    cargaId: string,
    descargaId: string,
    excluirViagemId?: string,
  ): Promise<ReferenciaKm> {
    const config = await this.config();

    const [historico, osrm, quarentena] = await Promise.all([
      this.estatisticaPar(cargaId, descargaId, config, excluirViagemId),
      this.kmOsrm(cargaId, descargaId),
      this.prisma.viagem.count({
        where: {
          localCargaId: cargaId,
          localDescargaId: descargaId,
          kmForaDoPadrao: true,
          revisadoEm: null,
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

      const ref = await this.referenciaDoPar(v.localCargaId!, v.localDescargaId!, v.id);
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
   * Mediana (+ quartis/faixa/amostra) das viagens COMPARÁVEIS do par. O filtro é
   * o coração da honestidade da feature: exclui viagem com trecho (km inclui o
   * trecho), em quarentena, e — o mais importante — a que tem km inconsistente
   * com o par (troca de local sem recálculo), que entraria como mediana podre
   * com cara de estatística. Ver plano §2.1.
   */
  private async estatisticaPar(
    cargaId: string,
    descargaId: string,
    config: ConfigKmAtipico,
    excluirViagemId?: string,
  ): Promise<EstatisticaPar | null> {
    const desde = inicioDiasAtras(config.janelaDias);
    const excluir = excluirViagemId ?? null;

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
      WHERE v."localCargaId" = ${cargaId}
        AND v."localDescargaId" = ${descargaId}
        AND (${excluir}::text IS NULL OR v.id <> ${excluir})
        AND v.km IS NOT NULL AND v.km > 0
        AND v.data >= ${desde}
        AND v.status::text NOT IN ('RASCUNHO_OFFLINE','EM_ANDAMENTO','AGUARDANDO_PESO','DIVERGENTE')
        AND NOT EXISTS (SELECT 1 FROM trechos_viagem t WHERE t."viagemId" = v.id)
        AND NOT (v."kmForaDoPadrao" IS TRUE AND v."revisadoEm" IS NULL)
        AND (
              v."kmFonte"::text IN ('MANUAL','HISTORICO') OR v."kmEditadoManual" IS TRUE
           OR v."kmCalculado" IS NULL
           OR abs(v.km - v."kmCalculado") <= GREATEST(1.0, 0.15 * v."kmCalculado")
        )
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
}
