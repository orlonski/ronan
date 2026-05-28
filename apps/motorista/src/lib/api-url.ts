// VITE_API_URL é inlinado no bundle no build. Se vier como localhost
// (Dockerfile default quando o build arg não foi passado), trata como
// não-configurado e usa o fallback de produção — evita PWA em prod batendo
// num endpoint que não existe.
const fromEnv = import.meta.env.VITE_API_URL;
const ehLocalhost = fromEnv && /(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(fromEnv);
export const API_URL =
  fromEnv && !ehLocalhost ? fromEnv : "https://ronan-api.2azr6q.easypanel.host";
