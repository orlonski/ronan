import { Injectable, Logger } from "@nestjs/common";

/**
 * Fonte AUTORITATIVA do "último OTA publicado". Em vez de adivinhar olhando qual
 * motorista tem o bundle mais novo (frágil: um aparelho destoante poluía a
 * referência), o backend faz a MESMA pergunta que o app faz ao servidor de
 * updates da Expo: "qual é o último bundle do canal `production`?".
 *
 * É o endpoint público de updates (u.expo.dev/<projectId>) — não precisa de
 * EXPO_TOKEN. Resposta vem como manifesto (multipart) com `id` (updateId) e
 * `createdAt` (data de publicação). O `createdAt` é idêntico entre plataformas
 * pra um mesmo publish, então comparar por ele é à prova de iOS/Android.
 *
 * Cache em memória (TTL 10min) pra não bater na Expo a cada listagem. Se a Expo
 * falhar, devolve o último valor bom (mesmo vencido) ou null — quem chama cai no
 * fallback da heurística antiga, nunca regride.
 */
const PROJECT_ID = "33e8e936-fbac-4bb3-9f98-5de6dc84da53";
const UPDATES_URL = `https://u.expo.dev/${PROJECT_ID}`;
const CHANNEL = "production";
const PLATFORMS = ["android", "ios"] as const;
const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;

export type LatestUpdate = {
  latestUpdateId: string | null;
  latestBuiltAt: string | null; // ISO
  latestVersion: string | null; // runtimeVersion
};

@Injectable()
export class EasUpdateService {
  private readonly logger = new Logger(EasUpdateService.name);
  private cache = new Map<string, { value: LatestUpdate | null; ts: number }>();
  private inFlight = new Map<string, Promise<LatestUpdate | null>>();

  /**
   * Último OTA publicado pro runtime informado (ex.: "1.0.0"). Cacheado por
   * runtime. `null` quando a Expo não respondeu e não há cache.
   */
  async latest(runtimeVersion: string): Promise<LatestUpdate | null> {
    const cached = this.cache.get(runtimeVersion);
    const agora = Date.now();
    if (cached && agora - cached.ts < TTL_MS) return cached.value;

    const existing = this.inFlight.get(runtimeVersion);
    if (existing) return existing;

    const p = this.buscar(runtimeVersion)
      .then((value) => {
        // Só sobrescreve o cache com sucesso; em falha mantém o último bom.
        if (value) this.cache.set(runtimeVersion, { value, ts: Date.now() });
        else if (!this.cache.has(runtimeVersion))
          this.cache.set(runtimeVersion, { value: null, ts: Date.now() });
        return value ?? this.cache.get(runtimeVersion)?.value ?? null;
      })
      .finally(() => this.inFlight.delete(runtimeVersion));

    this.inFlight.set(runtimeVersion, p);
    return p;
  }

  private async buscar(runtimeVersion: string): Promise<LatestUpdate | null> {
    // Busca em todas as plataformas e fica com o publish mais recente.
    const manifestos = await Promise.all(
      PLATFORMS.map((plat) => this.buscarPlataforma(plat, runtimeVersion)),
    );
    const validos = manifestos.filter(
      (m): m is { id: string; createdAt: string; runtimeVersion?: string } => !!m?.createdAt,
    );
    if (validos.length === 0) return null;
    const maisNovo = validos.reduce((a, b) =>
      new Date(b.createdAt).getTime() > new Date(a.createdAt).getTime() ? b : a,
    );
    return {
      latestUpdateId: maisNovo.id ?? null,
      latestBuiltAt: new Date(maisNovo.createdAt).toISOString(),
      latestVersion: maisNovo.runtimeVersion ?? runtimeVersion,
    };
  }

  private async buscarPlataforma(
    platform: string,
    runtimeVersion: string,
  ): Promise<{ id: string; createdAt: string; runtimeVersion?: string } | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(UPDATES_URL, {
        method: "GET",
        signal: ctrl.signal,
        headers: {
          accept: "multipart/mixed",
          "expo-platform": platform,
          "expo-channel-name": CHANNEL,
          "expo-runtime-version": runtimeVersion,
          "expo-protocol-version": "1",
          "expo-api-version": "1",
        },
      });
      if (!res.ok) return null;
      const body = await res.text();
      const manifest = extrairManifesto(body, res.headers.get("content-type") ?? "");
      if (!manifest || typeof manifest.id !== "string" || typeof manifest.createdAt !== "string") {
        return null; // sem update disponível (directive/rollback) ou formato inesperado
      }
      return {
        id: manifest.id,
        createdAt: manifest.createdAt,
        runtimeVersion:
          typeof manifest.runtimeVersion === "string" ? manifest.runtimeVersion : undefined,
      };
    } catch (e) {
      this.logger.warn(`Falha ao consultar OTA (${platform}/${runtimeVersion}): ${String(e)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Extrai o JSON do manifesto da resposta. Protocolo 1 vem como multipart/mixed
 * com uma parte `name="manifest"`; pega o trecho entre o primeiro `{` e o último
 * `}` dessa parte (robusto contra cruft de boundary). Se não for multipart,
 * tenta parsear o corpo direto.
 */
function extrairManifesto(body: string, contentType: string): Record<string, unknown> | null {
  const boundaryMatch = /boundary=("?)([^";]+)\1/i.exec(contentType);
  if (!boundaryMatch) return tentarJson(body);
  const boundary = boundaryMatch[2];
  for (const parte of body.split(`--${boundary}`)) {
    if (!/name="manifest"/i.test(parte)) continue;
    const ini = parte.indexOf("{");
    const fim = parte.lastIndexOf("}");
    if (ini >= 0 && fim > ini) {
      const json = tentarJson(parte.slice(ini, fim + 1));
      if (json) return json;
    }
  }
  return null;
}

function tentarJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s.trim());
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
