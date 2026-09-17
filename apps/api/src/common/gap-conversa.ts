/**
 * O tempo que passou entre duas mensagens, dito em português.
 *
 * Conversa de WhatsApp não tem começo nem fim declarados: a mesma thread
 * carrega o assunto de hoje e o de três semanas atrás. Sem um marcador de
 * quanto tempo passou, o modelo lê tudo como se fosse seguido e responde a
 * pergunta errada — assume continuação de uma conversa que ficou no limbo.
 *
 * Nasceu no agente do motorista, que pagou por isso em produção. Mora aqui
 * porque vale para qualquer conversa nossa com uma pessoa, e duas cópias da
 * mesma régua divergem na primeira vez que uma delas for ajustada.
 */

/** A partir daqui a próxima mensagem já é uma retomada, não uma continuação. */
export const GAP_NOVA_CONVERSA_MIN = 30;

/** "12min", "3h20min", "2d4h" — o jeito que uma pessoa diria. */
export function formatarGap(minutos: number): string {
  if (minutos < 60) return `${Math.floor(minutos)}min`;
  const horas = Math.floor(minutos / 60);
  const mins = Math.floor(minutos % 60);
  if (horas < 24) return mins > 0 ? `${horas}h${mins}min` : `${horas}h`;
  const dias = Math.floor(horas / 24);
  const horasRest = horas % 24;
  return horasRest > 0 ? `${dias}d${horasRest}h` : `${dias}d`;
}

/**
 * Carimba o intervalo na frente da mensagem, quando ele é grande o bastante.
 *
 * O marcador vai no conteúdo e não numa mensagem à parte de propósito: o
 * histórico alterna user/assistant, e uma linha solta de sistema no meio
 * quebraria a alternância que os dois providers esperam.
 */
export function comMarcadorDeGap(conteudo: string, gapMinutos: number): string {
  if (gapMinutos < GAP_NOVA_CONVERSA_MIN) return conteudo;
  return `[depois de ${formatarGap(gapMinutos)} sem mensagem]\n${conteudo}`;
}

/** Minutos entre dois instantes. Existe pra não repetir a divisão por 60000. */
export function minutosEntre(antes: Date, depois: Date | number): number {
  const fim = typeof depois === "number" ? depois : depois.getTime();
  return (fim - antes.getTime()) / 60000;
}
