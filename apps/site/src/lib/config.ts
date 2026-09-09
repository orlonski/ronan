// Valores públicos do site (número de contato, domínios, lojas). Ficam aqui, no
// código, de propósito: o Easypanel não tem campo de build arg, e as
// "Variáveis de Ambiente" dele são de runtime — num container nginx servindo
// HTML estático elas não chegam a lugar nenhum. Já custou um deploy achando
// que tinha trocado o número e não tinha.
//
// Mudar qualquer coisa aqui = commit + deploy. Nada disso é segredo: tudo
// aparece na página pra quem abrir o site.
//
// O `import.meta.env` continua valendo pra build local ou CI que queira
// sobrescrever (ex.: apontar pra um ambiente de teste).
const env = import.meta.env;

export const SITE_URL = env.VITE_SITE_URL ?? "https://www.movatruck.com.br";
export const PAINEL_URL = env.VITE_APP_URL ?? "https://app.movatruck.com.br";
export const PWA_URL = env.VITE_PWA_URL ?? "https://motorista.schaba.com.br";
export const PRIVACIDADE_URL = `${PAINEL_URL}/politica-de-privacidade`;

const zap = (env.VITE_WHATSAPP ?? "5542984223261").replace(/\D/g, "");
const recado = encodeURIComponent(
  "Oi! Vi o site do Movatruck e quero agendar uma demonstração.",
);

export const WHATSAPP_URL = `https://wa.me/${zap}?text=${recado}`;
export const EMAIL = env.VITE_EMAIL ?? "contato@movatruck.com.br";

export const PLAY_URL =
  env.VITE_PLAY_URL ??
  "https://play.google.com/store/apps/details?id=br.com.schaba.motorista";
export const APPSTORE_URL = env.VITE_APPSTORE_URL ?? "";
