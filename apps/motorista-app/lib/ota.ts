import * as Updates from "expo-updates";

// Timeouts pra não prender o motorista no boot quando o sinal tá ruim.
// O check é um round-trip rápido; o download do bundle pode demorar mais, mas
// como já mostramos a tela "Atualizando", vale esperar um pouco mais por ele.
const CHECK_TIMEOUT_MS = 8_000;
const FETCH_TIMEOUT_MS = 30_000;

function comTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/**
 * Aplica a OTA mais recente ANTES de liberar a UI — mirando o primeiro download.
 *
 * Quando o motorista instala da Play Store, o app roda o bundle embutido (a
 * build enviada à loja) e a OTA só entraria no próximo cold start. Aqui, no
 * primeiro launch (bundle embutido), baixamos a versão mais recente e
 * recarregamos — ele já cai na versão atual sem precisar fechar/reabrir.
 *
 * - Só age rodando o bundle embutido (`isEmbeddedLaunch`). Depois que uma OTA é
 *   aplicada, os launches seguintes são instantâneos e o banner da home cuida
 *   de updates futuros sem travar a abertura.
 * - Tem timeout: em sinal ruim, segue no bundle atual em vez de prender o app.
 * - Se `reloadAsync` for chamado, o JS reinicia e esta promise nunca resolve.
 */
export async function aplicarUpdateNoBoot(opts?: {
  onDownloadStart?: () => void;
}): Promise<void> {
  // Dev client / Expo Go: updates desligado.
  if (!Updates.isEnabled) return;
  // Só no primeiro download (ainda rodando o bundle da loja).
  if (!Updates.isEmbeddedLaunch) return;

  try {
    const check = await comTimeout(
      Updates.checkForUpdateAsync(),
      CHECK_TIMEOUT_MS,
    );
    if (!check?.isAvailable) return;

    opts?.onDownloadStart?.();

    const fetched = await comTimeout(
      Updates.fetchUpdateAsync(),
      FETCH_TIMEOUT_MS,
    );
    if (!fetched?.isNew) return;

    await Updates.reloadAsync();
  } catch {
    // Offline / erro de rede / timeout — segue no bundle atual sem travar.
  }
}
