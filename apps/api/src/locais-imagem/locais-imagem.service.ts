import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";

export type TipoImagemLocal = "STREET_VIEW" | "SATELITE";
type CacheImagem = { tipo: TipoImagemLocal; storageKey: string };

const TIMEOUT_MS = 6000;
const TAMANHO = "640x400";
/** Raio (m) pra achar um panorama de Street View perto do ponto. */
const RAIO_PANORAMA_M = 80;

/**
 * Imagem de um local pra o humano reconhecer o lugar (o pin de lat/lng não
 * responde "é aqui mesmo?"). Street View quando existe — apontando a câmera PRA
 * o ponto — e satélite quando não existe (pedreira/obra rural raramente tem
 * cobertura de rua; de cima costuma identificar melhor).
 *
 * Cache por COORDENADA (5 casas ≈ 1 m): metadados no `GeocodingCache` (mesma
 * tabela/padrão do geocoding) e o bitmap no MinIO. Assim o custo na API do
 * Google é ÚNICO por ponto, e mudar o lat/lng do local troca a chave sozinho.
 * A chave do Google nunca vai ao cliente — tudo passa por aqui.
 */
@Injectable()
export class LocaisImagemService {
  private readonly log = new Logger(LocaisImagemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly uploads: UploadsService,
  ) {}

  async obter(lat: number, lng: number): Promise<{ buffer: Buffer; tipo: TipoImagemLocal }> {
    const chaveCoord = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
    const cacheKey = `sv:${chaveCoord}`;

    const hit = await this.prisma.geocodingCache.findUnique({ where: { query: cacheKey } });
    if (hit) {
      const meta = hit.resposta as unknown as CacheImagem;
      void this.prisma.geocodingCache
        .update({
          where: { query: cacheKey },
          data: { hits: { increment: 1 }, ultimoHit: new Date() },
        })
        .catch(() => {});
      try {
        return { buffer: await this.uploads.getObjectBuffer(meta.storageKey), tipo: meta.tipo };
      } catch {
        /* bitmap sumiu do storage — refaz abaixo */
      }
    }

    const key = this.config.get<string>("GOOGLE_MAPS_KEY");
    if (!key) {
      this.log.warn("GOOGLE_MAPS_KEY não configurado — imagem de local desabilitada");
      throw new NotFoundException("Imagem do local indisponível");
    }

    const achado = await this.buscarNoGoogle(lat, lng, key);
    if (!achado) throw new NotFoundException("Imagem do local indisponível");

    const storageKey = await this.uploads.putLocalImagem(achado.buffer, chaveCoord);
    const resposta = { tipo: achado.tipo, storageKey };
    void this.prisma.geocodingCache
      .upsert({
        where: { query: cacheKey },
        create: { query: cacheKey, resposta },
        update: { resposta, ultimoHit: new Date() },
      })
      .catch(() => {});
    return achado;
  }

  /** Street View se houver panorama por perto; senão satélite. */
  private async buscarNoGoogle(
    lat: number,
    lng: number,
    key: string,
  ): Promise<{ buffer: Buffer; tipo: TipoImagemLocal } | null> {
    // Metadados são GRÁTIS: evita pagar por um ponto sem cobertura (e evita a
    // imagem cinza de "sem imagem" que a Static API devolveria).
    const pano = await this.metadataStreetView(lat, lng, key);
    if (pano) {
      // Sem heading a foto aponta pra um lado aleatório — mira no local.
      const heading = rumo(pano.lat, pano.lng, lat, lng).toFixed(1);
      const url =
        `https://maps.googleapis.com/maps/api/streetview?size=${TAMANHO}` +
        `&location=${pano.lat},${pano.lng}&heading=${heading}&fov=80&pitch=0&key=${key}`;
      const buffer = await this.baixar(url);
      if (buffer) return { buffer, tipo: "STREET_VIEW" };
    }
    const url =
      `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
      `&zoom=18&size=${TAMANHO}&maptype=satellite&markers=color:red%7C${lat},${lng}&key=${key}`;
    const buffer = await this.baixar(url);
    return buffer ? { buffer, tipo: "SATELITE" } : null;
  }

  /** Onde está o panorama mais próximo (ou null se não há cobertura). */
  private async metadataStreetView(
    lat: number,
    lng: number,
    key: string,
  ): Promise<{ lat: number; lng: number } | null> {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}` +
        `&radius=${RAIO_PANORAMA_M}&source=outdoor&key=${key}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        status?: string;
        location?: { lat: number; lng: number };
      };
      if (json.status !== "OK" || !json.location) return null;
      return { lat: json.location.lat, lng: json.location.lng };
    } catch {
      return null;
    }
  }

  private async baixar(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        // 403 costuma ser API não habilitada no Console pra essa chave.
        this.log.warn(`imagem do local: HTTP ${res.status}`);
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.log.warn(`imagem do local falhou: ${(err as Error).message}`);
      return null;
    }
  }
}

/** Rumo (0-360°) de A pra B — pra a câmera do Street View olhar o local. */
function rumo(latA: number, lngA: number, latB: number, lngB: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLng = rad(lngB - lngA);
  const y = Math.sin(dLng) * Math.cos(rad(latB));
  const x =
    Math.cos(rad(latA)) * Math.sin(rad(latB)) -
    Math.sin(rad(latA)) * Math.cos(rad(latB)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
