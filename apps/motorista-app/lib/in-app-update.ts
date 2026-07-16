import { Platform } from "react-native";

/**
 * Dispara o fluxo IMMEDIATE do Google Play In-App Update: uma tela cheia oficial
 * do Google DENTRO do app onde o motorista toca "Atualizar" uma vez e o Google
 * baixa + instala ali mesmo (sem ir na Play Store manualmente). É o mais próximo
 * de "auto-instalar" que o Android permite.
 *
 * Só Android. Envolto em try/catch porque o módulo é NATIVO: numa build que
 * ainda não o embarca (dev client, versão antiga, iOS) qualquer chamada falha e
 * a função só retorna false — o caller então cai no fallback (abrir a loja).
 *
 * O Google só oferece o update se houver um versionCode MAIOR publicado na faixa
 * (interna/produção) e o app tiver vindo da Play — em sideload não dispara.
 *
 * @returns true se conseguiu iniciar o fluxo do Google; false se indisponível.
 */
export async function tentarInAppUpdateImediato(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    // require lazy DE PROPÓSITO: o podspec da lib exige iOS 16.4, o app roda
    // 15.1, entao o CocoaPods dropa o pod no iOS sem falhar o build. Import
    // estatico aqui roda requireNativeModule("ExpoInAppUpdates") no escopo do
    // modulo e joga "Cannot find native module" no boot de todo iPhone — antes
    // do gate acima. Carregar so depois do gate mantem o iOS no fallback.
    const InAppUpdates =
      require("expo-in-app-updates") as typeof import("expo-in-app-updates");
    // true = update IMMEDIATE (tela cheia bloqueante do Google). checkAndStart
    // já checa disponibilidade e só inicia se houver update; retorna se começou.
    return await InAppUpdates.checkAndStartUpdate(true);
  } catch {
    return false;
  }
}
