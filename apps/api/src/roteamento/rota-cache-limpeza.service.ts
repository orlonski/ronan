import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { comoSistema } from "../common/conta/conta-context";
import { comLockDeCron } from "../common/cron-exclusivo";
import { distanciaMetros } from "../common/geo";
import { decodificarPolyline } from "./polyline";
import { ENCAIXE_MAX_M } from "./roteamento.service";

type Ponto = { lat: number | null; lng: number | null } | null;

/**
 * A rota guardada nasceu mesmo nos locais do par? Olha a PRIMEIRA e a ÚLTIMA
 * coordenada da polilinha contra a carga e a descarga.
 *
 * Antes da trava de cobertura (`ENCAIXE_MAX_M`), o OSRM com mapa só do Sul
 * encaixava um ponto de SP na estrada mais próxima do Paraná e devolvia "Ok".
 * Essa rota foi gravada no cache e continua sendo servida — km e polilinha de
 * outro lugar. A ponta da polilinha é onde o roteador encaixou o ponto, então
 * ponta longe do Local = rota que não é daquele par.
 *
 * Sem geometria ou sem coordenada não há como medir: "não sei" é mantido.
 */
export function rotaCacheadaEncaixa(geometria: string | null, origem: Ponto, destino: Ponto): boolean {
  if (!geometria || origem?.lat == null || origem.lng == null || destino?.lat == null || destino.lng == null) {
    return true;
  }
  const pontos = decodificarPolyline(geometria);
  if (pontos.length < 2) return true;
  const [latIni, lngIni] = pontos[0]!;
  const [latFim, lngFim] = pontos[pontos.length - 1]!;
  return (
    distanciaMetros(origem.lat, origem.lng, latIni, lngIni) <= ENCAIXE_MAX_M &&
    distanciaMetros(destino.lat, destino.lng, latFim, lngFim) <= ENCAIXE_MAX_M
  );
}

const LOTE = 500;

/**
 * Apaga do `rota_cache` as rotas que não começam/terminam nos locais do par
 * (ver `rotaCacheadaEncaixa`). O próximo acesso recalcula: dentro do mapa vem a
 * rota certa; fora dele, a trava devolve "fora da área do mapa".
 *
 * Mexe só no cache. O km já gravado em viagem não é tocado — o km do motorista
 * é lei, e o faturado só muda pelo painel com motivo.
 */
@Injectable()
export class RotaCacheLimpezaService {
  private readonly logger = new Logger(RotaCacheLimpezaService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron("0 50 3 * * *", { name: "limpar-rota-cache-fora-do-mapa", timeZone: "America/Sao_Paulo" })
  async sweep(): Promise<void> {
    await comLockDeCron(this.prisma, "limpar-rota-cache-fora-do-mapa", async () => {
      const apagadas = await comoSistema(() => this.limpar());
      if (apagadas > 0) {
        this.logger.log(`rota_cache: ${apagadas} rota(s) fora dos locais do par apagada(s)`);
      }
    });
  }

  async limpar(): Promise<number> {
    let apagadas = 0;
    let ultimo: string | undefined;
    for (;;) {
      const linhas = await this.prisma.rotaCache.findMany({
        // `id > último` e não `cursor`: o cursor do Prisma aponta pra uma linha,
        // e se ela foi apagada no lote anterior a página volta vazia.
        where: { geometria: { not: null }, ...(ultimo ? { id: { gt: ultimo } } : {}) },
        select: {
          id: true,
          geometria: true,
          localOrigem: { select: { lat: true, lng: true } },
          localDestino: { select: { lat: true, lng: true } },
        },
        orderBy: { id: "asc" },
        take: LOTE,
      });
      if (linhas.length === 0) break;
      ultimo = linhas[linhas.length - 1]!.id;

      const ruins = linhas
        .filter((l) => !rotaCacheadaEncaixa(l.geometria, l.localOrigem, l.localDestino))
        .map((l) => l.id);
      if (ruins.length > 0) {
        const r = await this.prisma.rotaCache.deleteMany({ where: { id: { in: ruins } } });
        apagadas += r.count;
      }
      if (linhas.length < LOTE) break;
    }
    return apagadas;
  }
}
