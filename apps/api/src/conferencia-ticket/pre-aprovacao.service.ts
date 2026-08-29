import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KmAtipicoService } from "../km-atipico/km-atipico.service";
import { PedagiosRodoviaConsultaService } from "../admin/pedagios-rodovia/pedagios-rodovia-consulta.service";
import { contaIdAtual } from "../common/conta/conta-context";
import { inicioDiasAtras } from "../common/timezone";
import { ConferenciaConfig } from "./conferencia.config";
import {
  avaliarPreAprovacao,
  type PreAprovacao,
  type SinaisPreAprovacao,
} from "./pre-aprovacao";

/**
 * Junta os sinais da VIAGEM (km e pedágio) pra decisão de aprovar sozinho. A
 * regra mora em `pre-aprovacao.ts`; aqui só se busca o que ela precisa.
 *
 * Nada disto chama IA: km atípico e praças na rota já são carimbados/calculados
 * pelo sistema há tempos, e reusá-los é o que torna esta trava barata — uma
 * leitura de linha, uma checagem geométrica sobre polyline cacheada e uma
 * mediana.
 */
@Injectable()
export class PreAprovacaoService {
  private readonly log = new Logger("ConferenciaTicket");

  constructor(
    private readonly prisma: PrismaService,
    private readonly kmAtipico: KmAtipicoService,
    private readonly pedagios: PedagiosRodoviaConsultaService,
    private readonly config: ConferenciaConfig,
  ) {}

  async avaliar(viagemId: string): Promise<PreAprovacao> {
    const sinais = await this.colher(viagemId);
    if (!sinais) return { aprova: false, motivo: "viagem não encontrada", resumo: [] };
    return avaliarPreAprovacao(sinais, {
      exigirKmNoPadrao: this.config.exigirKmNoPadrao,
      exigirPedagioCoerente: this.config.exigirPedagioCoerente,
      desvioPedagioPct: this.config.desvioPedagioPct,
      amostraMinimaPedagio: this.config.amostraMinimaPedagio,
    });
  }

  private async colher(viagemId: string): Promise<SinaisPreAprovacao | null> {
    let viagem = await this.lerViagem(viagemId);
    if (!viagem) return null;

    // O carimbo de km atípico é escrito fire-and-forget no lançamento; a
    // conferência pode chegar antes dele. Sem isto, viagem recém-lançada cairia
    // sempre em "km sem referência" — não por estar torta, mas por corrida.
    if (viagem.kmAvaliadoEm == null && this.config.exigirKmNoPadrao) {
      await this.kmAtipico.avaliarViagem(viagemId);
      viagem = (await this.lerViagem(viagemId)) ?? viagem;
    }

    const pracas = await this.pracasNaRota(viagemId);
    const valorInformado =
      viagem.valorPedagioTotal == null ? null : Number(viagem.valorPedagioTotal);

    const referencia =
      pracas != null && pracas > 0 && viagem.localCargaId && viagem.localDescargaId
        ? await this.medianaPedagioDoPar(viagem.localCargaId, viagem.localDescargaId, viagemId)
        : { mediana: null, amostra: 0 };

    return {
      km: {
        foraDoPadrao: viagem.kmForaDoPadrao,
        aceitoPorHumano: viagem.kmAceitoEm != null,
        desvioPct: viagem.kmDesvioPct == null ? null : Number(viagem.kmDesvioPct),
        referencia: viagem.kmReferencia == null ? null : Number(viagem.kmReferencia),
      },
      pedagio: { pracas, valorInformado, ...referencia },
    };
  }

  private lerViagem(id: string) {
    return this.prisma.viagem.findUnique({
      where: { id },
      select: {
        localCargaId: true,
        localDescargaId: true,
        kmForaDoPadrao: true,
        kmAceitoEm: true,
        kmAvaliadoEm: true,
        kmDesvioPct: true,
        kmReferencia: true,
        valorPedagioTotal: true,
      },
    });
  }

  /**
   * Quantas praças a rota real da viagem atravessa — `null` quando não deu pra
   * saber (sem geometria, roteador fora, viagem sem os dois locais).
   *
   * Sem `somenteCache` de propósito: aqui é UMA viagem por vez, e vale pagar a
   * rota pra não confundir "não passa por pedágio" com "não perguntei".
   */
  private async pracasNaRota(viagemId: string): Promise<number | null> {
    try {
      const { pedagios } = await this.pedagios.pedagiosDaViagem(viagemId);
      return pedagios === null ? null : pedagios.length;
    } catch (err) {
      this.log.warn(`Praças da viagem ${viagemId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Mediana do valor de pedágio lançado nas outras viagens do mesmo par de
   * locais. Mesma vizinhança de filtros da amostra de km atípico, pelo mesmo
   * motivo: viagem incompleta ou divergente não é referência de nada, e viagem
   * com trechos (bota-fora) paga praça a mais e distorceria a mediana.
   *
   * SQL cru não passa pela trava de conta — o filtro por `contaId` aqui é
   * obrigatório, não decorativo.
   */
  private async medianaPedagioDoPar(
    cargaId: string,
    descargaId: string,
    excluirViagemId: string,
  ): Promise<{ mediana: number | null; amostra: number }> {
    const desde = inicioDiasAtras(this.config.janelaDiasPedagio);
    try {
      const rows = await this.prisma.$queryRaw<{ mediana: number | null; amostra: bigint }[]>`
        SELECT
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY v."valorPedagioTotal"))::float8 AS mediana,
          COUNT(*) AS amostra
        FROM viagens v
        WHERE v."contaId" = ${contaIdAtual()}
          AND v."localCargaId" = ${cargaId}
          AND v."localDescargaId" = ${descargaId}
          AND v.id <> ${excluirViagemId}
          AND v."valorPedagioTotal" IS NOT NULL AND v."valorPedagioTotal" > 0
          AND v.data >= ${desde}
          AND v.status::text NOT IN ('RASCUNHO_OFFLINE','EM_ANDAMENTO','AGUARDANDO_PESO','AGUARDANDO_SAIDA','INCOMPLETA','DIVERGENTE')
          AND NOT EXISTS (SELECT 1 FROM trechos_viagem t WHERE t."viagemId" = v.id)
      `;
      const r = rows[0];
      return { mediana: r?.mediana ?? null, amostra: r ? Number(r.amostra) : 0 };
    } catch (err) {
      this.log.warn(`Mediana de pedágio do par falhou: ${(err as Error).message}`);
      return { mediana: null, amostra: 0 };
    }
  }
}
