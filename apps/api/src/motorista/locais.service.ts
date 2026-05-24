import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { NivelConfiancaLocal, type TipoLocal } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { GeocodingService } from "../geocoding/geocoding.service";
import { ValidacaoLocalService } from "./validacao-local.service";

const RAIO_SUGESTAO_M = 200;
const RAIO_GRAUS_APROX = 0.003; // ~330m — pre-filtra antes do haversine exato

@Injectable()
export class LocaisMotoristaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validacao: ValidacaoLocalService,
    private readonly geocoding: GeocodingService,
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
      clienteIds?: string[];
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

    const clienteIds = input.clienteIds ?? [];
    const local = await this.prisma.local.create({
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
        lat: input.lat,
        lng: input.lng,
        criadoPorMotoristaId: motoristaId,
        nivelConfianca: NivelConfiancaLocal.RASCUNHO,
        clientes: clienteIds.length
          ? { create: clienteIds.map((clienteId) => ({ clienteId })) }
          : undefined,
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
        lat: true,
        lng: true,
        nivelConfianca: true,
        clientes: { select: { clienteId: true } },
      },
    });
    const { clientes, ...rest } = local;
    return { ...rest, clienteIds: clientes.map((c) => c.clienteId) };
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
   * Busca locais existentes dentro de raio (default 200m) ordenados por distância,
   * com contagem de uso pelo motorista nos últimos 90d. Usado pelo fluxo
   * "Estou no local de descarga" do app — motorista aperta o botão, app pega GPS,
   * e isso devolve as opções de match.
   */
  async proximosPorGps(input: {
    motoristaId: string;
    lat: number;
    lng: number;
    tipoUso?: "carga" | "descarga" | "ambos";
    raioM?: number;
    limit?: number;
  }) {
    const raio = input.raioM ?? RAIO_SUGESTAO_M;
    const limit = input.limit ?? 5;
    const tiposPermitidos: TipoLocal[] =
      input.tipoUso === "carga"
        ? ["CARGA", "AMBOS"]
        : input.tipoUso === "descarga"
          ? ["DESCARGA", "AMBOS"]
          : ["CARGA", "DESCARGA", "AMBOS"];

    const candidatos = await this.prisma.local.findMany({
      where: {
        ativo: true,
        tipo: { in: tiposPermitidos },
        lat: { gte: input.lat - RAIO_GRAUS_APROX, lte: input.lat + RAIO_GRAUS_APROX },
        lng: { gte: input.lng - RAIO_GRAUS_APROX, lte: input.lng + RAIO_GRAUS_APROX },
      },
      select: {
        id: true,
        nome: true,
        cidade: true,
        uf: true,
        tipo: true,
        lat: true,
        lng: true,
        nivelConfianca: true,
        clientes: { select: { clienteId: true } },
      },
    });

    const filtrados = candidatos
      .map((c) => ({
        ...c,
        distanciaMetros:
          c.lat != null && c.lng != null
            ? haversine(input.lat, input.lng, c.lat, c.lng)
            : Number.POSITIVE_INFINITY,
      }))
      .filter((c) => c.distanciaMetros <= raio)
      .sort((a, b) => a.distanciaMetros - b.distanciaMetros)
      .slice(0, limit);

    if (filtrados.length === 0) return [];

    // Conta uso pelo motorista nos últimos 90d (carga + descarga)
    const desde = new Date();
    desde.setDate(desde.getDate() - 90);
    const ids = filtrados.map((f) => f.id);
    const usos = await this.prisma.viagem.findMany({
      where: {
        motoristaId: input.motoristaId,
        data: { gte: desde },
        OR: [{ localCargaId: { in: ids } }, { localDescargaId: { in: ids } }],
      },
      select: { localCargaId: true, localDescargaId: true },
    });
    const contador = new Map<string, number>();
    for (const v of usos) {
      if (ids.includes(v.localCargaId)) {
        contador.set(v.localCargaId, (contador.get(v.localCargaId) ?? 0) + 1);
      }
      if (ids.includes(v.localDescargaId)) {
        contador.set(v.localDescargaId, (contador.get(v.localDescargaId) ?? 0) + 1);
      }
    }

    return filtrados.map((f) => ({
      id: f.id,
      nome: f.nome,
      cidade: f.cidade,
      uf: f.uf,
      tipo: f.tipo,
      lat: f.lat,
      lng: f.lng,
      nivelConfianca: f.nivelConfianca,
      clienteIds: f.clientes.map((c) => c.clienteId),
      distanciaMetros: Math.round(f.distanciaMetros),
      vezesUsadoMotorista: contador.get(f.id) ?? 0,
    }));
  }

  /**
   * Fluxo rápido: motorista digitou só o nome no app (após não achar match
   * por GPS no `proximosPorGps`). Backend resolve logradouro/cidade/uf via
   * reverse geocoding (Nominatim) e cria o Local em RASCUNHO. Vai pra fila
   * "Em validação" do dashboard pra admin completar/homologar.
   */
  async criarRapido(
    motoristaId: string,
    input: { nome: string; lat: number; lng: number; tipo: TipoLocal; clienteIds?: string[] },
  ) {
    const reverse = await this.geocoding.reverseGeocoding(input.lat, input.lng);
    const clienteIds = input.clienteIds ?? [];
    const local = await this.prisma.local.create({
      data: {
        nome: input.nome,
        logradouro: reverse.logradouro ?? "(sem endereço)",
        numero: reverse.numero,
        bairro: reverse.bairro,
        cidade: reverse.cidade,
        uf: reverse.uf.toUpperCase().slice(0, 2),
        cep: reverse.cep,
        tipo: input.tipo,
        lat: input.lat,
        lng: input.lng,
        criadoPorMotoristaId: motoristaId,
        nivelConfianca: NivelConfiancaLocal.RASCUNHO,
        clientes: clienteIds.length
          ? { create: clienteIds.map((clienteId) => ({ clienteId })) }
          : undefined,
      },
      select: {
        id: true,
        nome: true,
        cidade: true,
        uf: true,
        tipo: true,
        lat: true,
        lng: true,
        nivelConfianca: true,
        clientes: { select: { clienteId: true } },
      },
    });
    const { clientes, ...rest } = local;
    return { ...rest, clienteIds: clientes.map((c) => c.clienteId) };
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
