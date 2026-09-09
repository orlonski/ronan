// URLs públicas entram via build arg no Dockerfile (ver apps/site/Dockerfile).
const env = import.meta.env;

export const SITE_URL = env.VITE_SITE_URL ?? "https://www.movatruck.com.br";
export const PAINEL_URL = env.VITE_APP_URL ?? "https://app.movatruck.com.br";
export const PWA_URL = env.VITE_PWA_URL ?? "https://motorista.schaba.com.br";
export const PRIVACIDADE_URL = `${PAINEL_URL}/politica-de-privacidade`;

const zap = (env.VITE_WHATSAPP ?? "5541999999999").replace(/\D/g, "");
const recado = encodeURIComponent(
  "Oi! Vi o site do Movatruck e quero agendar uma demonstração.",
);

export const WHATSAPP_URL = `https://wa.me/${zap}?text=${recado}`;
export const EMAIL = env.VITE_EMAIL ?? "contato@movatruck.com.br";

export const PLAY_URL =
  env.VITE_PLAY_URL ??
  "https://play.google.com/store/apps/details?id=br.com.schaba.motorista";
export const APPSTORE_URL = env.VITE_APPSTORE_URL ?? "";
