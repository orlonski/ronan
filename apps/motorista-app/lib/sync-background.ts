/**
 * Sincronização em SEGUNDO PLANO (app fechado/suspenso). Roda dentro da task de
 * background-fetch (piggyback no watchdog — ver tracking-watchdog.ts — pra não
 * registrar uma 2ª task, já que o iOS roda ~1 background-fetch por app). O SO
 * decide quando acordar (~15min+, best-effort).
 *
 * Fecha o furo do motorista que só abre o app em área SEM sinal: mesmo com o app
 * fechado, quando o sistema acorda a task numa janela com rede, isto:
 *   1. atualiza os catálogos (locais/clientes/materiais) no cache persistente —
 *      pro próximo uso offline já vir fresco;
 *   2. sobe a fila (viagens/eventos/posições) que ficou pendente.
 *
 * Imports nativos/pesados são lazy (await import) — top-level quebra o boot do
 * expo-router. Nunca lança: falhar aqui não pode derrubar a task.
 */
export async function sincronizarEmBackground(): Promise<void> {
  try {
    const { loadTokens } = await import("./auth");
    const tokens = await loadTokens();
    if (!tokens?.accessToken) return; // deslogado — nada a fazer

    // 1. Catálogos frescos no cache (awaited — o cachePut é o que persiste).
    try {
      const { forcarAtualizarDados } = await import("./queries");
      await forcarAtualizarDados();
    } catch {
      /* sem sinal nessa janela — mantém o cache atual, tenta na próxima */
    }

    // 2. Drena as filas — AWAITED (o drenarTudo do foreground é fire-and-forget;
    //    aqui precisamos esperar pra não cortar no meio antes do SO suspender).
    try {
      const [{ drain }, { drenar }, { drenarPosicoes }] = await Promise.all([
        import("./sync"),
        import("./event-reporter"),
        import("./posicao-sync"),
      ]);
      await drain();
      await drenar();
      await drenarPosicoes();
    } catch {
      /* best-effort */
    }
  } catch {
    /* nunca quebra a task de background */
  }
}
