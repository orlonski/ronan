import * as Updates from "expo-updates";

// Check é um round-trip rápido; 3s pra não segurar nada no boot com sinal ruim.
const CHECK_TIMEOUT_MS = 3_000;
// Download do bundle roda em BACKGROUND (não bloqueia a UI), mas ainda tem teto
// pra não vazar uma promise pendurada pra sempre num link ruim.
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
 * Baixa a OTA mais recente em SEGUNDO PLANO no primeiro launch — sem travar a UI.
 *
 * Quando o motorista instala da Play Store, o app roda o bundle embutido e a OTA
 * só entraria no próximo cold start. Aqui, no primeiro launch, baixamos a versão
 * nova em background. **Não** recarregamos no meio do uso (era o que prendia o
 * app ~38s no boot com 4G ruim): quando o download termina, `isUpdatePending`
 * fica true e o banner "Nova versão disponível" da home convida o motorista a
 * aplicar no momento dele.
 *
 * - Só age rodando o bundle embutido (`isEmbeddedLaunch`). Depois de uma OTA
 *   aplicada, é no-op — o banner da home cuida de updates futuros.
 * - Best-effort: nunca bloqueia a renderização, nunca lança. Em sinal ruim
 *   simplesmente não baixa e segue no bundle atual.
 */
export async function baixarUpdateNoBoot(): Promise<void> {
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
    // Baixa em background; NÃO recarrega. O banner da home aplica quando o
    // motorista quiser.
    await comTimeout(Updates.fetchUpdateAsync(), FETCH_TIMEOUT_MS);
  } catch {
    // Offline / erro de rede / timeout — segue no bundle atual sem travar.
  }
}

/**
 * Aplica uma OTA nova AO VOLTAR PRO APP (background→active), sem depender do
 * banner da home. Cobre o motorista que nunca toca em "Nova versão disponível":
 * na próxima vez que ele reabre o app, se há bundle novo, baixamos e
 * recarregamos calados. Roda só na volta pro foreground (não no meio de uma
 * tarefa) e só recarrega quando o bundle é REALMENTE novo (`isNew`).
 *
 * Best-effort: offline/erro = segue no bundle atual, nunca trava, nunca lança.
 */
export async function aplicarOtaAoVoltar(): Promise<void> {
  if (!Updates.isEnabled) return;
  try {
    const check = await comTimeout(
      Updates.checkForUpdateAsync(),
      CHECK_TIMEOUT_MS,
    );
    if (!check?.isAvailable) return;
    const fetched = await comTimeout(
      Updates.fetchUpdateAsync(),
      FETCH_TIMEOUT_MS,
    );
    if (fetched?.isNew) {
      await Updates.reloadAsync();
    }
  } catch {
    // Offline / erro / timeout — segue no bundle atual.
  }
}
