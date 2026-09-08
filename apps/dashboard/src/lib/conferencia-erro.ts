/**
 * Traduz a falha técnica da leitura de ticket pra uma frase que diz o que
 * houve — e, principalmente, de quem é o problema.
 *
 * "Connection error." é a mensagem crua do SDK do provedor, e na tela ela
 * parecia defeito da foto ou do lançamento do motorista. Não é: a chamada nem
 * saiu daqui. Quem confere precisa saber que não há nada pra corrigir na
 * viagem, só uma leitura pra refazer.
 *
 * A mensagem original continua guardada no banco pra diagnóstico; o que muda é
 * o que a pessoa lê.
 */
export function humanizarErroConferencia(erro: string | null | undefined): string | null {
  if (!erro) return null;
  const e = erro.toLowerCase();

  if (/connection error|econnreset|econnrefused|enotfound|eai_again|epipe|socket hang up|fetch failed|network/.test(e)) {
    return "não consegui falar com o servidor de leitura (queda de conexão). Não é problema da foto nem do lançamento.";
  }
  if (/passou de \d+s|etimedout|timeout/.test(e)) {
    return "a leitura passou do tempo limite.";
  }
  if (/\bstorage\b/.test(e)) {
    return "não consegui baixar a foto do armazenamento.";
  }
  if (/rate.?limit|\b429\b/.test(e)) {
    return "o servidor de leitura recusou por excesso de chamadas seguidas.";
  }
  if (/overloaded|\b(500|502|503|504)\b/.test(e)) {
    return "o servidor de leitura estava fora do ar.";
  }
  if (/fora do formato/.test(e)) {
    return "o modelo respondeu fora do formato esperado.";
  }
  if (/n[ãa]o configurad/.test(e)) {
    return "a leitura automática está sem chave de acesso configurada.";
  }
  return erro;
}

/** Como cada tentativa aparece na linha do tempo da viagem. */
export function rotuloStatusConferencia(status: string, veredito: string | null): string {
  if (status === "CONCLUIDA") {
    if (veredito === "BATE") return "confere com o ticket";
    if (veredito === "DIVERGE") return "não bate com o ticket";
    if (veredito === "ILEGIVEL") return "foto ilegível";
    if (veredito === "INCERTO") return "precisa de olho humano";
    if (veredito === "NAO_APLICAVEL") return "não havia o que conferir";
    return "lida";
  }
  if (status === "FALHOU") return "não deu pra ler";
  if (status === "DESCARTADA") return "descartada";
  if (status === "EXECUTANDO") return "lendo agora";
  return "na fila";
}
