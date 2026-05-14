import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { NivelConfiancaLocal } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ValidacaoLocalService } from "./validacao-local.service";

const RAIO_SUGESTAO_M = 200;
const RAIO_GRAUS_APROX = 0.003; // ~330m — pre-filtra antes do haversine exato

@Injectable()
export class LocaisMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validacao: ValidacaoLocalService,
  ) {}

  /**
   * Antes de criar, busca locais ativos dentro de 200m do GPS enviado. Se
   * achar 1+, devolve 409 com sugestões pra o app perguntar "é algum
   * destes?". App reenvia com forcarCriacao=true se motorista insistir.
   */
  async criar(
    motoristaId: string,
    input: {
      nome: string;
      logradouro: string;
      numero?: string;
      bairro?: string;
      cidade: string;
      uf: string;
      cep?: string;
      pontoReferencia?: string;
      tipo: "CARGA" | "DESCARGA" | "AMBOS";
      obraId?: string;
      lat?: number;
      lng?: number;
      forcarCriacao?: boolean;
    },
  ) {
    if (input.lat != null && input.lng != null && !input.forcarCriacao) {
      const sugestoes = await this.buscarProximos(input.lat, input.lng, RAIO_SUGESTAO_M);
      if (sugestoes.length > 0) {
        throw new ConflictException({
          message: "Já existem locais cadastrados próximos. Confira antes de criar.",
          sugestoes,
        });
      }
    }

    return this.prisma.local.create({
      data: {
        nome: input.nome,
        logradouro: input.logradouro,
        numero: input.numero,
        bairro: input.bairro,
        cidade: input.cidade,
        uf: input.uf.toUpperCase(),
        cep: input.cep,
        pontoReferencia: input.pontoReferencia,
        tipo: input.tipo,
        obraId: input.obraId,
        lat: input.lat,
        lng: input.lng,
        criadoPorMotoristaId: motoristaId,
        nivelConfianca: NivelConfiancaLocal.RASCUNHO,
      },
      select: {
        id: true,
        nome: true,
        logradouro: true,
        numero: true,
        bairro: true,
        cidade: true,
        uf: true,
        pontoReferencia: true,
        tipo: true,
        obraId: true,
        lat: true,
        lng: true,
        nivelConfianca: true,
      },
    });
  }

  /**
   * Locais que o motorista cadastrou e ainda não estão "validados" (≠
   * RECORRENTE/HUMANO). Usado pelo app pra registrar geofences passivos.
   */
  async emValidacao(motoristaId: string) {
    return this.prisma.local.findMany({
      where: {
        criadoPorMotoristaId: motoristaId,
        ativo: true,
        lat: { not: null },
        lng: { not: null },
        nivelConfianca: {
          in: [
            NivelConfiancaLocal.RASCUNHO,
            NivelConfiancaLocal.PRESENCA_PONTUAL,
            NivelConfiancaLocal.DWELL_CONFIRMADO,
          ],
        },
      },
      select: {
        id: true,
        nome: true,
        lat: true,
        lng: true,
        nivelConfianca: true,
        criadoEm: true,
      },
      orderBy: { criadoEm: "desc" },
      take: 20, // limite iOS de geofences ativas
    });
  }

  /**
   * App envia evento de geofence ENTER→EXIT detectado pelo OS. Se duração
   * ≥ 10min, vira evidência DWELL_CONFIRMADO.
   */
  async registrarEventoPresenca(
    motoristaId: string,
    localId: string,
    input: { duracaoSeg: number; detectadoEm: string },
  ) {
    if (!Number.isFinite(input.duracaoSeg) || input.duracaoSeg < 0) {
      throw new BadRequestException("duracaoSeg inválido");
    }
    const detectadoEm = new Date(input.detectadoEm);
    if (Number.isNaN(detectadoEm.getTime())) {
      throw new BadRequestException("detectadoEm inválido");
    }
    const local = await this.prisma.local.findUnique({
      where: { id: localId },
      select: { id: true, nivelConfianca: true },
    });
    if (!local) throw new BadRequestException("Local não encontrado");

    // Já validado por humano/recorrência — não precisa mais de evidência.
    if (
      local.nivelConfianca === NivelConfiancaLocal.RECORRENTE ||
      local.nivelConfianca === NivelConfiancaLocal.HUMANO
    ) {
      return { ok: true, ignorado: true };
    }

    await this.validacao.registrarGeofenceDwell({
      localId,
      motoristaId,
      duracaoSeg: Math.round(input.duracaoSeg),
      detectadoEm,
    });
    return { ok: true };
  }

  /**
   * Locais ativos com lat/lng dentro de ~200m do ponto dado. Usa pré-filtro
   * por bounding-box (graus aprox) pra evitar haversine em todos os locais.
   */
  private async buscarProximos(lat: number, lng: number, raioM: number) {
    const candidatos = await this.prisma.local.findMany({
      where: {
        ativo: true,
        lat: { gte: lat - RAIO_GRAUS_APROX, lte: lat + RAIO_GRAUS_APROX },
        lng: { gte: lng - RAIO_GRAUS_APROX, lte: lng + RAIO_GRAUS_APROX },
      },
      select: {
        id: true,
        nome: true,
        logradouro: true,
        numero: true,
        bairro: true,
        cidade: true,
        uf: true,
        tipo: true,
        lat: true,
        lng: true,
        nivelConfianca: true,
      },
    });
    return candidatos.filter(
      (c) =>
        c.lat != null &&
        c.lng != null &&
        haversine(lat, lng, c.lat, c.lng) <= raioM,
    );
  }
}

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
