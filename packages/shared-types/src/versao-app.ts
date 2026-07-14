import { z } from "zod";

/**
 * Força-atualização do app nativo (motorista-app iOS/Android).
 *
 * O app manda a própria versão (`x-app-version`) e plataforma (`x-app-platform`)
 * em toda request. O backend aprende sozinho a "versão mais nova em circulação"
 * por plataforma (maior versão vista, firmada em ≥N motoristas) e decide se o
 * device que está pedindo precisa atualizar pela loja.
 *
 * Comparação é pela VERSÃO DE MARKETING ("1.0.3"), não pelo build nativo:
 * o SDK 54 tirou o versionCode/buildNumber do runtime (só `expo-application`
 * — módulo nativo — daria isso, e ele não sai por OTA). A versão de marketing
 * é legível via OTA na base já instalada e é bumpada a cada release da loja.
 */

export const APP_PLATFORMS = ["ios", "android"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

/** Identidade nas lojas — pro deep link que abre direto na página do app. */
export const APP_STORE_IOS_ID = "6778807216";
export const APP_ANDROID_PACKAGE = "br.com.schaba.motorista";

/**
 * Deep link que abre a loja direto na página do app + fallback https (caso o
 * app da loja não esteja instalado / o esquema nativo falhe).
 */
export function storeUrls(plataforma: AppPlatform): {
  deepLink: string;
  web: string;
} {
  if (plataforma === "ios") {
    return {
      deepLink: `itms-apps://apps.apple.com/app/id${APP_STORE_IOS_ID}`,
      web: `https://apps.apple.com/app/id${APP_STORE_IOS_ID}`,
    };
  }
  return {
    deepLink: `market://details?id=${APP_ANDROID_PACKAGE}`,
    web: `https://play.google.com/store/apps/details?id=${APP_ANDROID_PACKAGE}`,
  };
}

/**
 * Extrai a sequência numérica de uma versão ("1.2.3-beta" → [1,2,3]).
 * Para no primeiro segmento que não começa com número. Retorna null se não
 * houver nenhum número legível — o caller usa isso pra fazer fail-open
 * (NUNCA bloquear com base numa versão ilegível).
 */
function parseVersao(v: unknown): number[] | null {
  if (typeof v !== "string") return null;
  const limpos: number[] = [];
  for (const seg of v.trim().split(".")) {
    const m = seg.match(/^\d+/);
    if (!m) break; // segmento não-numérico encerra o parse
    limpos.push(Number.parseInt(m[0], 10));
  }
  return limpos.length ? limpos : null;
}

/**
 * Compara duas versões "x.y.z" numericamente (semver simplificado, sem
 * pré-release semantics — só a parte numérica). Segmentos faltando contam 0
 * ("1.2" == "1.2.0"). Retorna <0 se a<b, 0 se iguais, >0 se a>b, e **null se
 * qualquer uma for ilegível** — nesse caso o caller não deve tomar decisão.
 */
export function compararVersao(a: unknown, b: unknown): number | null {
  const pa = parseVersao(a);
  const pb = parseVersao(b);
  if (!pa || !pb) return null;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Modo global da força-atualização (config no dashboard). */
export const MODOS_FORCA_ATUALIZACAO = [
  "off", // desligado — nunca age (kill switch)
  "observar", // detecta e mostra no painel, mas o app não faz nada visível
  "nudge", // desatualizado → aviso dispensável
  "bloquear", // desatualizado → tela cheia obrigatória
] as const;
export type ModoForcaAtualizacao = (typeof MODOS_FORCA_ATUALIZACAO)[number];

/** Ação que o app deve tomar pra ESTE device nesta request. */
export const AcaoAtualizacao = z.enum(["nenhuma", "recomendar", "bloquear"]);
export type AcaoAtualizacao = z.infer<typeof AcaoAtualizacao>;

/**
 * Resposta de `GET /m/versao-app`. O backend já entrega a decisão pronta
 * (`acao`) — mas o app SEMPRE faz seu próprio fail-open: qualquer erro de rede,
 * timeout ou payload inválido = nenhuma ação (app normal).
 */
export const VersaoAppResponse = z.object({
  acao: AcaoAtualizacao,
  // Versão mais nova detectada pra esta plataforma (ou override manual).
  // null = ainda não firmou / desconhecida → app não age.
  ultimaVersao: z.string().nullable(),
  // Eco do que o backend leu do header desta request (debug/telemetria).
  minhaVersao: z.string().nullable(),
  // Deep link da loja (abre direto na página) + fallback https.
  storeUrl: z.string(),
  storeUrlWeb: z.string(),
});
export type VersaoAppResponse = z.infer<typeof VersaoAppResponse>;
