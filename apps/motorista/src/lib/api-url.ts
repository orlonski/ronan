// VITE_API_URL é inlinado no bundle no build. Aceita só se for um host público
// utilizável pelo browser. Caso contrário cai pro fallback. Filtros:
// - localhost / 127.0.0.1 / 0.0.0.0 (build sem o arg → pega o ARG default do Dockerfile)
// - hostnames sem ponto (Docker internal tipo `ronan-api` que o browser não resolve)
// - URL http:// quando o PWA é servido via https:// (mixed content é bloqueado)
const FALLBACK = "https://ronan-api.2azr6q.easypanel.host";

function ehUsavel(url: string | undefined): url is string {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (/(^|\.)?(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(parsed.hostname)) return false;
  if (!parsed.hostname.includes(".")) return false;
  if (typeof window !== "undefined" && window.location.protocol === "https:" && parsed.protocol === "http:") {
    return false;
  }
  return true;
}

const fromEnv = import.meta.env.VITE_API_URL;
export const API_URL = ehUsavel(fromEnv) ? fromEnv : FALLBACK;
