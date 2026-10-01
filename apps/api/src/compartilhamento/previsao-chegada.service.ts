import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import {
  precisaCalcularRota,
  previsaoChegada,
  type EntradaPrevisao,
  type PrevisaoChegada,
} from "../common/previsao-chegada";
import { ymdSaoPaulo } from "../common/timezone";

/**
 * Junta o que a regra de `common/previsao-chegada.ts` precisa pra UMA viagem.
 *
 * O destino de uma viagem em andamento quase nunca está na viagem: no fluxo
 * guiado, `localDescargaId` só é gravado quando ele DESCARREGA. Então ele vem
 * de onde a empresa já disse pra onde o caminhão vai, nessa ordem:
 *   1. a obra da viagem, quando ela tem um local de descarga só;
 *   2. a programação do dia do motorista (o destino do pedido).
 * Com dois candidatos diferentes, não chuta — previsão pro lugar errado é pior
 * que nenhuma.
 *
 * Cache curto por viagem: cada abertura do link (e o refresh automático da
 * página) chamaria o roteador.
 */

const CACHE_MS = 60_000;

@Injectable()
export class PrevisaoChegadaService {
  private readonly log = new Logger(PrevisaoChegadaService.name);
  private readonly cache = new Map<string, { expira: number; valor: PrevisaoChegada | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly roteamento: RoteamentoService,
  ) {}

  async paraViagem(viagemId: string, agora = new Date()): Promise<PrevisaoChegada | null> {
    const emCache = this.cache.get(viagemId);
    if (emCache && emCache.expira > agora.getTime()) return emCache.valor;

    let valor: PrevisaoChegada | null = null;
    try {
      valor = await this.calcular(viagemId, agora);
    } catch (e) {
      // Previsão é enfeite do comprovante: falhar não pode derrubar o link.
      this.log.warn(`Previsão de chegada falhou (${viagemId}): ${(e as Error).message}`);
    }
    this.cache.set(viagemId, { expira: agora.getTime() + CACHE_MS, valor });
    if (this.cache.size > 2000) this.cache.clear();
    return valor;
  }

  private async calcular(viagemId: string, agora: Date): Promise<PrevisaoChegada | null> {
    const v = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        status: true,
        motoristaId: true,
        localCargaId: true,
        localDescargaId: true,
        iniciadoEm: true,
        cliente: {
          select: {
            locais: {
              select: {
                local: { select: { id: true, nome: true, tipo: true, lat: true, lng: true } },
              },
            },
          },
        },
        eventosViagem: { where: { tipoEvento: { ehCarga: true } }, select: { id: true }, take: 1 },
      },
    });
    if (!v || v.status !== "EM_ANDAMENTO") return null;

    const destino = await this.resolverDestino(v, agora);
    const posicao = await this.prisma.motoristaPosicao.findFirst({
      where: {
        motoristaId: v.motoristaId,
        capturadoEm: { lte: agora, ...(v.iniciadoEm ? { gte: v.iniciadoEm } : {}) },
      },
      orderBy: { capturadoEm: "desc" },
      select: { lat: true, lng: true, capturadoEm: true },
    });

    const entrada: EntradaPrevisao = {
      emAndamento: true,
      carregado: v.eventosViagem.length > 0,
      descarregado: v.localDescargaId != null,
      destino,
      posicao,
      agora,
    };
    if (!precisaCalcularRota(entrada)) return previsaoChegada(entrada, null);

    const rota = await this.roteamento.calcularEntreCoordenadas(
      { lat: posicao!.lat, lng: posicao!.lng },
      { lat: destino!.lat, lng: destino!.lng },
    );
    return previsaoChegada(entrada, rota.km != null ? rota.duracaoSegundos : null);
  }

  private async resolverDestino(
    v: {
      motoristaId: string;
      localCargaId: string | null;
      cliente: {
        locais: { local: { id: string; nome: string; tipo: string; lat: number | null; lng: number | null } }[];
      } | null;
    },
    agora: Date,
  ): Promise<{ nome: string; lat: number; lng: number } | null> {
    // 1. A obra, quando ela tem UM lugar onde se descarrega.
    const daObra = (v.cliente?.locais ?? [])
      .map((l) => l.local)
      .filter((l) => l.tipo !== "CARGA" && l.lat != null && l.lng != null);
    if (daObra.length === 1) {
      const l = daObra[0]!;
      return { nome: l.nome, lat: l.lat!, lng: l.lng! };
    }

    // 2. A programação de hoje do motorista. A planejada só é ligada à viagem
    // quando ela termina, então aqui se procura pelo dia e pelo motorista.
    const [a, m, d] = ymdSaoPaulo(agora);
    const hoje = new Date(Date.UTC(a, m - 1, d));
    const planejadas = await this.prisma.viagemPlanejada.findMany({
      where: {
        motoristaId: v.motoristaId,
        dataPrevista: hoje,
        viagemId: null,
        status: { in: ["PUBLICADA", "ACEITA", "EM_EXECUCAO"] },
      },
      select: {
        pedido: {
          select: {
            localCargaId: true,
            localDescarga: { select: { id: true, nome: true, lat: true, lng: true } },
          },
        },
      },
    });
    const candidatos = planejadas
      .map((p) => p.pedido)
      .filter((p): p is NonNullable<typeof p> => p?.localDescarga?.lat != null && p.localDescarga.lng != null)
      // Se já se sabe de onde saiu a carga, só vale a programação daquela carga.
      .filter((p) => !v.localCargaId || !p.localCargaId || p.localCargaId === v.localCargaId)
      .map((p) => p.localDescarga!);
    const distintos = new Map(candidatos.map((l) => [l.id, l]));
    if (distintos.size !== 1) return null;
    const l = [...distintos.values()][0]!;
    return { nome: l.nome, lat: l.lat!, lng: l.lng! };
  }
}
