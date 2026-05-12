// EXPO_PUBLIC_* vars sao inlinadas no bundle; sem fallback pra localhost
// pra build de produçao nunca apontar pro 127.0.0.1.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.schaba.com.br";
