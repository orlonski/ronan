/**
 * O lead de quem chegou sozinho.
 *
 * A base de captação nasceu virada pra fora: RNTRC, Receita, `origemDado`
 * obrigatório dizendo de qual arquivo e de que data o telefone saiu. Aquela
 * régua existe porque somos NÓS que chegamos primeiro, e a pergunta "como
 * vocês conseguiram meu número?" precisa de resposta.
 *
 * Quem escreve no WhatsApp da Movatruck inverteu a direção: o titular
 * procurou a gente. Não há procedência a justificar — ele mesmo deu o número,
 * no ato de escrever. Tratar esse caso com a régua de prospecção ativa deixava
 * o SDR mais preparado pra falar com quem nunca pediu nada do que com quem
 * levantou a mão, e mandava pra fila humana justamente o melhor lead que
 * existe: o que veio do Instagram, do site ou de indicação.
 */

/** Quem entrou por aqui. Separa do `PROSPECCAO_ATIVA` e do `SITE_FORMULARIO`. */
export const ORIGEM_INBOUND = "WHATSAPP_INBOUND";

/**
 * O nome da empresa, enquanto ninguém disse qual é.
 *
 * `Lead.empresa` é obrigatório — a prospecção sempre conhece a empresa antes
 * da pessoa, e o formulário do site pede o nome. Aqui é o contrário: chega uma
 * mensagem de um número, e só. Em vez de afrouxar a coluna (um `null` que
 * todas as telas do CRM teriam que aprender a desenhar), o lead nasce com este
 * carimbo e o SDR o substitui pelo nome de verdade assim que ele disser.
 */
export const EMPRESA_A_DESCOBRIR = "Contato pelo WhatsApp";

/**
 * A empresa deste lead, ou `null` quando ainda é o carimbo.
 *
 * O prompt do SDR trata os dois casos de forma diferente, e "Empresa: Contato
 * pelo WhatsApp" dito ao modelo seria pior que não dizer nada: ele acharia que
 * é o nome dela.
 */
export function empresaConhecida(empresa: string | null | undefined): string | null {
  const limpo = (empresa ?? "").trim();
  return !limpo || limpo === EMPRESA_A_DESCOBRIR ? null : limpo;
}

/**
 * O telefone no formato da casa: só dígitos e sem o DDI.
 *
 * O lead vindo da Receita guarda "4335353078"; o WhatsApp entrega
 * "+554335353078". Gravar como o WhatsApp manda faria o opt-out passar ao
 * lado: `registrarOptOut` compara o telefone por igualdade exata, e "55" na
 * frente é suficiente pra marcar zero leads e a pessoa seguir recebendo
 * mensagem depois de pedir pra parar.
 */
export function telefoneDaCasa(bruto: string): string {
  return bruto.replace(/\D/g, "").replace(/^55/, "");
}

/**
 * O nome da pessoa, quando o WhatsApp entrega um de verdade.
 *
 * O Chatwoot preenche `sender.name` com o próprio número quando o contato não
 * tem nome no perfil. Gravar isso em `Lead.nome` faria o CRM mostrar um
 * telefone no lugar da pessoa — e o prompt do SDR chamaria alguém de
 * "+554299998888".
 */
export function nomeDePessoa(bruto: string | null | undefined, numero: string): string | null {
  const limpo = (bruto ?? "").trim();
  if (!limpo) return null;
  const digitos = limpo.replace(/\D/g, "");
  if (digitos && digitos.endsWith(numero.slice(-8))) return null;
  return limpo;
}
