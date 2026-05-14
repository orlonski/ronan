import { Injectable, Logger } from "@nestjs/common";
import { FonteEvidencia, NivelConfiancaLocal } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const RAIO_VALIDACAO_M = 200;
const DWELL_MIN_SEG = 600; // 10 min
const RECORRENCIA_MIN_MOTORISTAS = 3;
const CLUSTER_GAP_MAX_SEG = 180; // até 3 min entre pontos contíguos no mesmo cluster

const NIVEL_RANK: Record<NivelConfiancaLocal, number> = {
  RASCUNHO: 0,
  PRESENCA_PONTUAL: 1,
  DWELL_CONFIRMADO: 2,
  RECORRENTE: 3,
  HUMANO: 4,
};

@Injectable()
export class ValidacaoLocalService {
  private readonly log = new Logger(ValidacaoLocalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Roda após POST /m/viagens. Compara o GPS pontual da viagem com lat/lng
   * dos locais usados (carga e descarga). Se bate ±200m, registra evidência
   * GPS_REGISTRO e promove pra PRESENCA_PONTUAL.
   */
  async revalidarApos(viagemId: string): Promise<void> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        motoristaId: true,
        lat: true,
        lng: true,
        localCarga: { select: { id: true, lat: true, lng: true, nivelConfianca: true } },
        localDescarga: { select: { id: true, lat: true, lng: true, nivelConfianca: true } },
      },
    });
    if (!viagem || viagem.lat == null || viagem.lng == null) return;

    for (const local of [viagem.localCarga, viagem.localDescarga]) {
      if (!local || local.lat == null || local.lng == null) continue;
      const dist = haversine(viagem.lat, viagem.lng, local.lat, local.lng);
      if (dist > RAIO_VALIDACAO_M) continue;
      await this.registrarEvidencia({
        localId: local.id,
        motoristaId: viagem.motoristaId,
        fonte: FonteEvidencia.GPS_REGISTRO,
        viagemId: viagem.id,
        promoverPara: NivelConfiancaLocal.PRESENCA_PONTUAL,
      });
    }
  }

  /**
   * Roda quando a viagem termina o tracking ativo. Analisa ViagemPonto pra
   * achar cluster contíguo de pontos dentro de 200m do Local com duração
   * ≥ 10min. Se sim, registra TRACKING_DWELL e promove pra DWELL_CONFIRMADO.
   */
  async revalidarComDwell(viagemId: string): Promise<void> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        motoristaId: true,
        localCarga: { select: { id: true, lat: true, lng: true } },
        localDescarga: { select: { id: true, lat: true, lng: true } },
        pontos: {
          select: { lat: true, lng: true, capturadoEm: true },
          orderBy: { capturadoEm: "asc" },
        },
      },
    });
    if (!viagem || viagem.pontos.length < 2) return;

    for (const local of [viagem.localCarga, viagem.localDescarga]) {
      if (!local || local.lat == null || local.lng == null) continue;
      const dwellSeg = maiorClusterDentro(
        viagem.pontos,
        local.lat,
        local.lng,
        RAIO_VALIDACAO_M,
        CLUSTER_GAP_MAX_SEG,
      );
      if (dwellSeg < DWELL_MIN_SEG) continue;
      await this.registrarEvidencia({
        localId: local.id,
        motoristaId: viagem.motoristaId,
        fonte: FonteEvidencia.TRACKING_DWELL,
        viagemId: viagem.id,
        duracaoSeg: dwellSeg,
        promoverPara: NivelConfiancaLocal.DWELL_CONFIRMADO,
      });
    }
  }

  /**
   * Chamado pelo POST /m/locais/:id/eventos-presenca quando o app dispara
   * dwell via geofence passivo. Promove pra DWELL_CONFIRMADO se ≥ 10min.
   */
  async registrarGeofenceDwell(input: {
    localId: string;
    motoristaId: string;
    duracaoSeg: number;
    detectadoEm: Date;
  }): Promise<void> {
    if (input.duracaoSeg < DWELL_MIN_SEG) return;
    await this.registrarEvidencia({
      localId: input.localId,
      motoristaId: input.motoristaId,
      fonte: FonteEvidencia.GEOFENCE_PASSIVO,
      duracaoSeg: input.duracaoSeg,
      detectadoEm: input.detectadoEm,
      promoverPara: NivelConfiancaLocal.DWELL_CONFIRMADO,
    });
  }

  private async registrarEvidencia(input: {
    localId: string;
    motoristaId: string;
    fonte: FonteEvidencia;
    viagemId?: string;
    duracaoSeg?: number;
    detectadoEm?: Date;
    promoverPara: NivelConfiancaLocal;
  }): Promise<void> {
    try {
      await this.prisma.localEvidencia.create({
        data: {
          localId: input.localId,
          motoristaId: input.motoristaId,
          fonte: input.fonte,
          viagemId: input.viagemId,
          duracaoSeg: input.duracaoSeg,
          detectadoEm: input.detectadoEm ?? new Date(),
        },
      });
    } catch (err) {
      // Falha não bloqueia o fluxo principal — só loga.
      this.log.warn(`Falha ao registrar evidencia: ${(err as Error).message}`);
      return;
    }

    const local = await this.prisma.local.findUnique({
      where: { id: input.localId },
      select: { nivelConfianca: true },
    });
    if (!local) return;

    const nivelAtual = local.nivelConfianca;
    let novoNivel = nivelAtual;
    if (NIVEL_RANK[input.promoverPara] > NIVEL_RANK[nivelAtual]) {
      novoNivel = input.promoverPara;
    }

    // Recorrência: ≥ 3 motoristas distintos com evidência (qualquer fonte
    // que não seja a própria RECORRENCIA, pra evitar ciclo).
    const motoristasDistintos = await this.prisma.localEvidencia.findMany({
      where: { localId: input.localId, fonte: { not: FonteEvidencia.RECORRENCIA } },
      distinct: ["motoristaId"],
      select: { motoristaId: true },
    });
    if (
      motoristasDistintos.length >= RECORRENCIA_MIN_MOTORISTAS &&
      NIVEL_RANK[NivelConfiancaLocal.RECORRENTE] > NIVEL_RANK[novoNivel]
    ) {
      novoNivel = NivelConfiancaLocal.RECORRENTE;
    }

    await this.prisma.local.update({
      where: { id: input.localId },
      data: {
        nivelConfianca: novoNivel,
        ultimaValidacaoEm: new Date(),
        contadorValidacoes: { increment: 1 },
      },
    });
  }
}

/**
 * Distância haversine em metros entre dois pontos lat/lng.
 */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Pega a maior janela contígua (gap ≤ gapMaxSeg) de pontos dentro de raioM
 * do centro. Retorna duração em segundos (0 se nenhum cluster).
 */
function maiorClusterDentro(
  pontos: Array<{ lat: number; lng: number; capturadoEm: Date }>,
  centroLat: number,
  centroLng: number,
  raioM: number,
  gapMaxSeg: number,
): number {
  let melhor = 0;
  let inicio: Date | null = null;
  let ultimoDentro: Date | null = null;

  for (const p of pontos) {
    const dentro = haversine(p.lat, p.lng, centroLat, centroLng) <= raioM;
    const t = p.capturadoEm;
    if (dentro) {
      if (inicio == null) {
        inicio = t;
        ultimoDentro = t;
      } else if (ultimoDentro && (t.getTime() - ultimoDentro.getTime()) / 1000 > gapMaxSeg) {
        // Gap muito grande — fecha cluster anterior, começa novo
        const dur = (ultimoDentro.getTime() - inicio.getTime()) / 1000;
        if (dur > melhor) melhor = dur;
        inicio = t;
        ultimoDentro = t;
      } else {
        ultimoDentro = t;
      }
    } else if (inicio && ultimoDentro) {
      const dur = (ultimoDentro.getTime() - inicio.getTime()) / 1000;
      if (dur > melhor) melhor = dur;
      inicio = null;
      ultimoDentro = null;
    }
  }
  if (inicio && ultimoDentro) {
    const dur = (ultimoDentro.getTime() - inicio.getTime()) / 1000;
    if (dur > melhor) melhor = dur;
  }
  return melhor;
}
