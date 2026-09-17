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

/**
 * Os últimos 8 dígitos — o pedaço do telefone que sobrevive a tudo.
 *
 * O mesmo número aparece de três formas na casa: "4399912345" (Receita, celular
 * velho sem o nono dígito), "43999912345" (com o nono) e "554399912345" (como
 * o WhatsApp manda). Comparar por igualdade faz o MESMO telefone parecer três
 * pessoas — e o caso em que isso dói é o opt-out: a pessoa pede pra parar, o
 * `updateMany` não casa nenhum lead, e ela continua na lista.
 *
 * Oito dígitos porque é o que existe em todas as formas. Colisão entre DDDs
 * diferentes é teoricamente possível; na prática o custo de errar pra MENOS
 * (não marcar quem pediu pra sair) é muito maior que o de errar pra mais.
 */
export function sufixoTelefone(bruto: string): string {
  return telefoneDaCasa(bruto).slice(-8);
}

/**
 * A pessoa está pedindo pra não receber mais nada?
 *
 * Régua curta de propósito. "não quero" no meio de uma frase ("não quero
 * pagar caro") é conversa, não opt-out — tirar da lista quem estava
 * negociando é tão ruim quanto continuar mandando pra quem pediu pra sair.
 * Só conta a mensagem que é ISSO e nada mais.
 */
const PEDIDOS_DE_PARAR = new Set([
  "sair",
  "parar",
  "pare",
  "stop",
  "remover",
  "descadastrar",
  "cancelar",
  "nao quero",
  "nao quero mais",
  "nao tenho interesse",
  "parar de receber",
  "nao me mande mais mensagens",
  "nao envie mais mensagens",
]);

/**
 * Pedidos de parar escritos por extenso.
 *
 * A lista acima é de frase INTEIRA, e por isso só pega quem responde exatamente
 * "SAIR". Quem escreve "não quero mais receber mensagem de vocês" escapava dela
 * e sobrava pro modelo chamar `registrar_opt_out` — que é justamente o que o
 * `MiniMax-M3` não fez na bateria: respondeu "entendido, não escrevo mais" e
 * não registrou nada. A pessoa se despede achando que saiu, e continua na base.
 *
 * Promessa de opt-out não pode depender de um modelo lembrar de chamar uma
 * ferramenta. Estes padrões exigem verbo de parar MAIS o objeto certo
 * (mensagem, contato, lista) — "não quero pagar mais que R$ 1.200" e "quero
 * parar de usar planilha" continuam sendo conversa de venda, não opt-out.
 */
const PADROES_DE_PARAR: RegExp[] = [
  /\bn(?:ao)?\s+(?:quero|queria|desejo)\s+(?:mais\s+)?(?:receber|ser\s+contatad|ser\s+incomodad|mensage|contato|nada)/,
  /\b(?:para|pare|parem|parar|pra?r)\s+de\s+(?:me\s+)?(?:mandar|enviar|escrever|ligar|encher|perturbar)/,
  /\bme\s+(?:tira|tire|tirem|remova|remove|removam|exclua|exclui|apaga|apague|deleta|delete)\s+(?:da|dessa|desta|de\s+sua|do)\s+(?:lista|base|cadastro)/,
  /\bdescadastr/,
  /\bnao\s+me\s+(?:mande|manda|mandem|envie|envia|escreva|escreve|procure|procura|perturbe|perturba|liga|ligue)/,
  /\bsair?\s+d(?:a|essa|esta)\s+lista/,
  /\bnao\s+tenho\s+interesse/,
  /\bpara\s+com\s+(?:isso|essas?\s+mensagens?)/,
];

export function ehPedidoDeParar(texto: string): boolean {
  const limpo = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.!,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return PEDIDOS_DE_PARAR.has(limpo) || PADROES_DE_PARAR.some((p) => p.test(limpo));
}
