// VITE_API_URL é inlinado no bundle. Fallback pra prod evita apontar pro
// localhost quando esquece a env var em build de release.
export const API_URL = import.meta.env.VITE_API_URL ?? "https://api.schaba.com.br";
