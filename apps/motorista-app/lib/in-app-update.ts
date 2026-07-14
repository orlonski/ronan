import { Platform } from "react-native";
import * as InAppUpdates from "expo-in-app-updates";

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
    // true = update IMMEDIATE (tela cheia bloqueante do Google). checkAndStart
    // já checa disponibilidade e só inicia se houver update; retorna se começou.
    return await InAppUpdates.checkAndStartUpdate(true);
  } catch {
    return false;
  }
}
