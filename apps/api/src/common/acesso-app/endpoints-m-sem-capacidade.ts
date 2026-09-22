/**
 * A DÍVIDA CONHECIDA do acesso ao app: handlers de `/m/*` que ainda não dizem o
 * que exigem. Cada linha tem DONO e PRAZO, e linha vencida derruba o boot —
 * dívida sem data é a "configuração por cadastro" com outro nome.
 *
 * Nasceu vazia em 22/09/2026: os 165 handlers foram classificados de uma vez.
 * Use só pra endpoint que precisa sair antes de se decidir a capacidade dele,
 * e com prazo curto. A lista só encolhe.
 *
 * Formato: `"NomeDoController.metodo": { dono: "quem resolve", ate: "AAAA-MM-DD" }`.
 */
export const ENDPOINTS_M_SEM_CAPACIDADE: ReadonlyMap<string, { dono: string; ate: string }> = new Map();
