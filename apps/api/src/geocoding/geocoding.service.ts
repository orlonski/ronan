import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type SugestaoLista = {
  fonte: "GOOGLE";
  placeId: string;
  nome: string;
  textoCompleto: string;
};

export type SugestaoEndereco = {
  fonte: "VIACEP" | "GOOGLE";
  placeId?: string;
  textoCompleto?: string;
  nome?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
  lat?: number;
  lng?: number;
};

type ViaCepResponse = {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
};

type GoogleAutocompleteResponse = {
  suggestions?: {
    placePrediction?: {
      placeId: string;
      text?: { text: string };
      structuredFormat?: {
        mainText?: { text: string };
        secondaryText?: { text: string };
      };
    };
  }[];
};

type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type GooglePlaceResponse = {
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: GoogleAddressComponent[];
  types?: string[];
};

// Bias retangular cobrindo PR + buffer (sul de SP, leste de MS, norte de SC).
// Google rejeita circle com radius > 50km — rectangle não tem esse limite.
const BIAS_LOW = { latitude: -27.0, longitude: -55.0 }; // SW
const BIAS_HIGH = { latitude: -22.0, longitude: -47.5 }; // NE

@Injectable()
export class GeocodingService {
  private readonly log = new Logger(GeocodingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async buscarPorCep(cepRaw: string | undefined): Promise<SugestaoEndereco | null> {
    // Sem `?cep=` isto estourava em `.replace` de undefined e virava 500 — que
    // além de mentir sobre a causa, enchia o error_logs. CEP ausente é o mesmo
    // caso de CEP inválido: não achou nada.
    const cep = (cepRaw ?? "").replace(/\D/g, "");
    if (cep.length !== 8) return null;
    const base = this.config.get<string>("VIACEP_URL") ?? "https://viacep.com.br/ws";
    try {
      const res = await fetch(`${base}/${cep}/json/`);
      if (!res.ok) return null;
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) return null;
      return {
        fonte: "VIACEP",
        logradouro: data.logradouro || undefined,
        bairro: data.bairro || undefined,
        cidade: data.localidade,
        uf: data.uf,
        cep: data.cep,
      };
    } catch (err) {
      this.log.warn(`ViaCEP falhou: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Autocomplete via Google Places API (New). Cacheia por query normalizada.
   * Retorna apenas placeId + textos — o detalhe (lat/lng, componentes) sai do `resolverPlace`.
   */
  async buscarPorTexto(
    query: string,
    bias?: { lat: number; lng: number },
  ): Promise<SugestaoLista[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 3) return [];
    // Cache inclui rounded lat/lng (4 casas = ~10m) pra distinguir buscas de
    // regiões diferentes mas não estourar o cache com qualquer micro-deslocamento.
    const biasKey = bias
      ? `@${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}`
      : "";
    const cacheKey = `q:${q}${biasKey}`;

    const hit = await this.prisma.geocodingCache.findUnique({ where: { query: cacheKey } });
    if (hit) {
      void this.prisma.geocodingCache
        .update({
          where: { query: cacheKey },
          data: { hits: { increment: 1 }, ultimoHit: new Date() },
        })
        .catch(() => {});
      return hit.resposta as unknown as SugestaoLista[];
    }

    const key = this.config.get<string>("GOOGLE_MAPS_KEY");
    if (!key) {
      this.log.warn("GOOGLE_MAPS_KEY não configurado — busca por texto desabilitada");
      return [];
    }

    // Bias dinamico (motorista) com raio 50km, ou fallback regional.
    const locationBias = bias
      ? {
          circle: {
            center: { latitude: bias.lat, longitude: bias.lng },
            radius: 50000,
          },
        }
      : { rectangle: { low: BIAS_LOW, high: BIAS_HIGH } };

    let sugestoes: SugestaoLista[] = [];
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
        },
        body: JSON.stringify({
          input: query,
          languageCode: "pt-BR",
          regionCode: "BR",
          includedRegionCodes: ["br"],
          locationBias,
        }),
      });
      if (!res.ok) {
        this.log.warn(`Google autocomplete respondeu ${res.status}: ${await res.text()}`);
        return [];
      }
      const data = (await res.json()) as GoogleAutocompleteResponse;
      sugestoes = (data.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
        .map((p) => ({
          fonte: "GOOGLE" as const,
          placeId: p.placeId,
          nome: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
          textoCompleto: p.text?.text ?? "",
        }));
    } catch (err) {
      this.log.warn(`Google autocomplete falhou: ${(err as Error).message}`);
      return [];
    }

    if (sugestoes.length > 0) {
      await this.prisma.geocodingCache
        .create({
          data: {
            query: cacheKey,
            resposta: sugestoes as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => {});
    }
    return sugestoes;
  }

  /**
   * Reverse geocoding via Nominatim (OpenStreetMap) — grátis, sem API key.
   * Cacheia por lat/lng arredondado a 4 casas (~10m).
   * Usado pelo fluxo "criar local rápido" do app motorista (motorista informa
   * só o nome; backend preenche logradouro/cidade/uf via reverse).
   * Se Nominatim falhar, retorna placeholders genéricos pra não bloquear o cadastro.
   */
  async reverseGeocoding(
    lat: number,
    lng: number,
  ): Promise<{ logradouro?: string; numero?: string; bairro?: string; cidade: string; uf: string; cep?: string }> {
    const latR = Math.round(lat * 10000) / 10000;
    const lngR = Math.round(lng * 10000) / 10000;
    const cacheKey = `r:${latR.toFixed(4)},${lngR.toFixed(4)}`;

    const hit = await this.prisma.geocodingCache.findUnique({ where: { query: cacheKey } });
    if (hit) {
      void this.prisma.geocodingCache
        .update({
          where: { query: cacheKey },
          data: { hits: { increment: 1 }, ultimoHit: new Date() },
        })
        .catch(() => {});
      return hit.resposta as unknown as {
        logradouro?: string;
        numero?: string;
        bairro?: string;
        cidade: string;
        uf: string;
        cep?: string;
      };
    }

    const placeholder = {
      logradouro: "(sem endereço)",
      cidade: "?",
      uf: "??",
    };

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${latR}&lon=${lngR}&format=json&accept-language=pt-BR&zoom=18`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Ronan/1.0 (transportadora; contato@ronan.local)",
        },
      });
      if (!res.ok) {
        this.log.warn(`Nominatim reverse respondeu ${res.status}`);
        return placeholder;
      }
      const data = (await res.json()) as {
        address?: {
          road?: string;
          house_number?: string;
          suburb?: string;
          neighbourhood?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          state?: string;
          state_code?: string;
          postcode?: string;
          country_code?: string;
        };
      };
      const addr = data.address ?? {};
      const cidade = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? "?";
      const uf = (addr.state_code ?? siglaEstado(addr.state) ?? "??").toUpperCase().slice(0, 2);
      const resultado = {
        logradouro: addr.road ?? "(sem endereço)",
        numero: addr.house_number,
        bairro: addr.suburb ?? addr.neighbourhood,
        cidade,
        uf,
        cep: addr.postcode?.replace(/\D/g, ""),
      };

      await this.prisma.geocodingCache
        .create({
          data: {
            query: cacheKey,
            resposta: resultado as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => {});

      return resultado;
    } catch (err) {
      this.log.warn(`Nominatim reverse falhou: ${(err as Error).message}`);
      return placeholder;
    }
  }

  /**
   * Resolve um placeId em endereço estruturado via Place Details. Cacheia por placeId.
   */
  async resolverPlace(placeId: string): Promise<SugestaoEndereco | null> {
    const id = placeId.trim();
    if (!id) return null;
    const cacheKey = `p:${id}`;

    const hit = await this.prisma.geocodingCache.findUnique({ where: { query: cacheKey } });
    if (hit) {
      void this.prisma.geocodingCache
        .update({
          where: { query: cacheKey },
          data: { hits: { increment: 1 }, ultimoHit: new Date() },
        })
        .catch(() => {});
      return hit.resposta as unknown as SugestaoEndereco;
    }

    const key = this.config.get<string>("GOOGLE_MAPS_KEY");
    if (!key) return null;

    let sug: SugestaoEndereco | null = null;
    try {
      const fields = "displayName,formattedAddress,location,addressComponents,types";
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": fields,
        },
      });
      if (!res.ok) {
        this.log.warn(`Google place details respondeu ${res.status}: ${await res.text()}`);
        return null;
      }
      const data = (await res.json()) as GooglePlaceResponse;
      sug = normalizarPlace(id, data);
    } catch (err) {
      this.log.warn(`Google place details falhou: ${(err as Error).message}`);
      return null;
    }

    if (sug) {
      await this.prisma.geocodingCache
        .create({
          data: {
            query: cacheKey,
            resposta: sug as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => {});
    }
    return sug;
  }
}

// Fallback: mapeia nome do estado BR pra sigla (Nominatim às vezes não retorna state_code).
const SIGLAS_ESTADO: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapá: "AP", amapa: "AP", amazonas: "AM",
  bahia: "BA", ceará: "CE", ceara: "CE", "distrito federal": "DF",
  "espírito santo": "ES", "espirito santo": "ES", goiás: "GO", goias: "GO",
  maranhão: "MA", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  "minas gerais": "MG", pará: "PA", para: "PA", paraíba: "PB", paraiba: "PB",
  paraná: "PR", parana: "PR", pernambuco: "PE", piauí: "PI", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  rondônia: "RO", rondonia: "RO", roraima: "RR", "santa catarina": "SC",
  "são paulo": "SP", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};
function siglaEstado(nome?: string): string | undefined {
  if (!nome) return undefined;
  return SIGLAS_ESTADO[nome.toLowerCase().trim()];
}

function pegarComponente(
  comps: GoogleAddressComponent[] | undefined,
  tipo: string,
  preferShort = false,
): string | undefined {
  if (!comps) return undefined;
  const c = comps.find((x) => x.types?.includes(tipo));
  if (!c) return undefined;
  return preferShort ? c.shortText ?? c.longText : c.longText ?? c.shortText;
}

function normalizarPlace(placeId: string, p: GooglePlaceResponse): SugestaoEndereco {
  const comps = p.addressComponents;
  const logradouro = pegarComponente(comps, "route");
  const numero = pegarComponente(comps, "street_number");
  const bairro =
    pegarComponente(comps, "sublocality_level_1") ??
    pegarComponente(comps, "sublocality") ??
    pegarComponente(comps, "neighborhood");
  const cidade =
    pegarComponente(comps, "administrative_area_level_2") ??
    pegarComponente(comps, "locality") ??
    "";
  const uf = pegarComponente(comps, "administrative_area_level_1", true) ?? "";
  const cep = pegarComponente(comps, "postal_code");
  const ehPoi =
    !!p.types?.some((t) => t === "establishment" || t === "point_of_interest") ||
    (!logradouro && !!p.displayName?.text);

  return {
    fonte: "GOOGLE",
    placeId,
    textoCompleto: p.formattedAddress ?? p.displayName?.text,
    nome: ehPoi ? p.displayName?.text : undefined,
    logradouro,
    numero,
    bairro,
    cidade,
    uf,
    cep,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  };
}
