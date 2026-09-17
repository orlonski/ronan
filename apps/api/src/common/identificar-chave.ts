/**
 * O apelido de uma chave de API: o bastante pra reconhecer, nunca pra usar.
 *
 * A chave mora em variável de ambiente e é assim que continua — segredo em
 * tabela lida por quem tem permissão de leitura é segredo a mais, e o mesmo
 * vale pra segredo que atravessa um endpoint. Mas "tem chave: sim" não responde
 * a pergunta que quem paga a conta faz: *qual* chave está rodando ali, de qual
 * conta, se é a mesma que eu troquei semana passada.
 *
 * Prefixo e quatro dígitos finais identificam sem reconstruir: dão pra conferir
 * contra o que está no painel do provedor, e não dão pra assinar uma chamada.
 */

/** Quanto do começo aparece. Seis pega `sk-ant` e `AIzaSy` inteiros. */
const PREFIXO = 6;
const SUFIXO = 4;

/**
 * Devolve algo como `sk-ant…K9fA`, ou `••••` quando a chave é curta demais
 * pra mostrar pedaço sem entregar quase tudo.
 */
export function identificarChave(chave: string | null | undefined): string | null {
  const limpa = (chave ?? "").trim();
  if (!limpa) return null;
  // Abaixo disso, prefixo + sufixo já seriam metade da chave.
  if (limpa.length < (PREFIXO + SUFIXO) * 2) return "••••";
  return `${limpa.slice(0, PREFIXO)}…${limpa.slice(-SUFIXO)}`;
}
