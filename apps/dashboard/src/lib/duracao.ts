/**
 * Duração em texto curto, pra ler de relance num card ou num tooltip.
 *
 * A unidade muda com a grandeza de propósito: "13 h" e "47.320 s" são o mesmo
 * número, mas só um deles responde "demora muito?" sem a pessoa fazer conta. Em
 * compensação nunca some com a magnitude — dias sempre aparecem com as horas
 * junto, senão "2 d" e "2 d 23 h" viram a mesma coisa na tela.
 */
export function fmtDuracaoSegundos(segundos: number | null | undefined): string {
  if (segundos == null) return "—";
  if (segundos < 1) return "instantâneo";
  if (segundos < 60) return `${Math.round(segundos)} s`;

  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;

  const horas = Math.floor(segundos / 3600);
  if (horas < 24) {
    const resto = Math.round((segundos % 3600) / 60);
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }

  const dias = Math.floor(segundos / 86_400);
  const restoH = Math.round((segundos % 86_400) / 3600);
  return restoH ? `${dias} d ${restoH} h` : `${dias} d`;
}

/** Idem, pro tempo de máquina da leitura, que vem em milissegundos. */
export function fmtDuracaoMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return fmtDuracaoSegundos(ms / 1000);
}
