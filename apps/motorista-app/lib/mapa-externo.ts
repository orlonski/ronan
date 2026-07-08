import { Linking } from "react-native";

/**
 * Abre navegação turn-by-turn REAL num app externo (Waze → Google Maps → mapa do
 * SO → web). É a rede de segurança do guia ao vivo: se o guia in-app não servir
 * num aparelho, o motorista toca aqui e navega com voz/recálculo de verdade.
 *
 * Cascata (tenta abrir; se o app não existe, o SO rejeita e cai no próximo):
 *  1. Waze com navegação (`waze://?ll=&navigate=yes`)
 *  2. Google Maps navegação (`google.navigation:q=`)
 *  3. Mapa do SO mostrando o pino (`geo:`)
 *  4. Google Maps web (sempre abre)
 */
export async function abrirNavegacaoExterna(lat: number, lng: number): Promise<void> {
  const tentativas = [
    `waze://?ll=${lat},${lng}&navigate=yes`,
    `google.navigation:q=${lat},${lng}`,
    `geo:${lat},${lng}?q=${lat},${lng}`,
  ];
  for (const url of tentativas) {
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      /* tenta o próximo */
    }
  }
  // Fallback final: web (sempre abre num navegador).
  await Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  ).catch(() => {
    /* nada mais a fazer */
  });
}
