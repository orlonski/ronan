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

/**
 * O começo do resumo da interação que o webhook grava quando ELE escreve.
 *
 * É a única linha de `InteracaoLead` que significa "o lead falou". As outras
 * de canal WHATSAPP são nossas — recado deixado pelo vendedor, qualificação do
 * robô, repasse — e contar essas como fala dele pôs a LAGUNA, nota 100, em
 * "esperando resposta há 11 dias" por causa de um áudio que NÓS mandamos.
 */
export const RESUMO_MENSAGEM_RECEBIDA = "Mandou mensagem no WhatsApp";

/** O filtro Prisma de "ele escreveu". Um lugar só, pros três que perguntam. */
export const ONDE_ELE_ESCREVEU = {
  canal: "WHATSAPP",
  autor: null,
  resumo: { startsWith: RESUMO_MENSAGEM_RECEBIDA },
};

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
  "bloquear",
  "bloqueia",
  "bloqueado",
  "spam",
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
  // "contato" só com "mais" ou fechando a frase: "não quero contato por
  // telefone, me manda aqui" é preferência de canal, não opt-out.
  /\bn(?:ao)?\s+(?:quero|queria|desejo)\s+(?:mais\s+)?(?:receber|ser\s+contatad|ser\s+incomodad|mensage|nada)/,
  /\bn(?:ao)?\s+(?:quero|queria|desejo)\s+mais\s+contato/,
  /\bn(?:ao)?\s+(?:quero|queria|desejo)\s+contato\s*$/,
  /\b(?:para|pare|parem|parar|pra?r)\s+de\s+(?:me\s+)?(?:mandar|enviar|escrever|ligar|encher|perturbar)/,
  /\bme\s+(?:tira|tire|tirem|remova|remove|removam|exclua|exclui|apaga|apague|deleta|delete)\s+(?:da|dessa|desta|de\s+sua|do)\s+(?:lista|base|cadastro)/,
  /\bdescadastr/,
  // Sem "liga/ligue": "não me liga, manda o preço aqui" é pedido de canal —
  // e virava supressão global (achado da QA em 28/09).
  /\bnao\s+me\s+(?:mande|manda|mandem|envie|envia|escreva|escreve|procure|procura|perturbe|perturba)/,
  /\bsair?\s+d(?:a|essa|esta)\s+lista/,
  /\bnao\s+tenho\s+interesse(?!\s+(?:na|em|no|de)\s+(?:ligacao|telefone|chamada|ligar|falar))/,
  /\b(?:vou|vo)\s+(?:te\s+|lhe\s+)?bloque|\bme\s+bloqueia\b|\be\s+spam\b/,
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
  if (PEDIDOS_DE_PARAR.has(limpo)) return true;
  // Quem pergunta preço ou quer testar na mesma frase está conversando, não
  // saindo — por mais que tenha um "não" no meio.
  if (/\b(?:quero\s+testar|quanto|preco|valor|me\s+manda\s+o)\b/.test(limpo)) return false;
  return PADROES_DE_PARAR.some((p) => p.test(limpo));
}

/** O texto sem acento, minúsculo e com espaço simples — a base das réguas abaixo. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * É a mensagem de ausência automática do WhatsApp Business de outra empresa?
 *
 * Existe porque o robô respondia essas mensagens — e numa delas mandou o
 * próprio raciocínio pro cliente. Uma transportadora que recebe nosso contato
 * devolve "S A Carlesso Transportes agradece seu contato. Em breve
 * retornaremos", e isso não é conversa: é a secretária eletrônica dela.
 * Responder faz dois robôs conversarem e queima a primeira impressão.
 */
const PADROES_AUSENCIA: RegExp[] = [
  /\bagradece(?:mos)?\s+(?:o\s+|seu\s+|sua\s+|pelo\s+|pela\s+)?(?:seu\s+|sua\s+)?(?:contato|mensagem)/,
  /\bnao\s+estamos\s+disponiveis\b/,
  /\bno\s+momento\s+(?:nao\s+)?(?:estamos|podemos|nos\s+encontramos)/,
  /\bem\s+breve\s+(?:retornaremos|responderemos|entraremos)/,
  /\bresponderemos\s+(?:assim\s+que|o\s+mais\s+breve|em\s+breve)/,
  /\bmensagem\s+automatica\b/,
  /\bresposta\s+automatica\b/,
  /\bnosso\s+horario\s+de\s+atendimento\b/,
  /\bfora\s+do\s+(?:nosso\s+)?horario\s+de\s+atendimento\b/,
];

export function ehRespostaAutomatica(texto: string): boolean {
  const limpo = normalizar(texto);
  return PADROES_AUSENCIA.some((p) => p.test(limpo));
}

/**
 * A mensagem só fecha a conversa — emoji, "ok", "valeu", "👍"?
 *
 * O robô respondia 👍 com 👍, 😊 com 😊, e assim por diante, até a pessoa
 * parar. Quem manda "ok" depois de receber a resposta não está pedindo nada.
 * Quem chama decide se vale: é encerramento DEPOIS de uma fala nossa; como
 * primeira mensagem da conversa, "oi" continua merecendo resposta.
 */
const ENCERRAMENTOS = new Set([
  "ok",
  "okay",
  "blz",
  "beleza",
  "valeu",
  "vlw",
  "obrigado",
  "obrigada",
  "obg",
  "brigado",
  "brigada",
  "ta bom",
  "tabom",
  "ta",
  "certo",
  "show",
  "top",
  "tmj",
  "tamo junto",
  "ate",
  "ate mais",
  "falou",
  "flw",
  "kkk",
  "kkkk",
  "kkkkk",
  "rs",
  "rsrs",
  "haha",
  "hahaha",
  "nada kkk",
  "nada kakakak",
]);

export function ehSoEncerramento(texto: string): boolean {
  const semEmoji = texto
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, "")
    .trim();
  if (!semEmoji) return texto.trim().length > 0; // só emoji
  const limpo = normalizar(semEmoji).replace(/[.!,;:?]+/g, "").trim();
  return (
    ENCERRAMENTOS.has(limpo) ||
    /^k{3,}$/.test(limpo) ||
    /^(?:ha){2,}$/.test(limpo) ||
    /^x+d+$/.test(limpo)
  );
}

/**
 * A pessoa está pedindo pra falar com gente?
 *
 * Regra fixa, ANTES do modelo, pela mesma razão do opt-out: promessa que
 * depende de a IA entender é promessa que falha. "QUEM VAI ME ATENDER", em caixa
 * alta, chegou depois de o robô já ter dito que chamava alguém — e ele
 * respondeu "Não tenho essa informação" e cumprimentou de novo.
 *
 * `nomesEquipe` vem da configuração: citar o Fernando pelo nome é pedido de
 * falar com o Fernando.
 */
const PADROES_HUMANO: RegExp[] = [
  /\b(?:falar|conversar|atendimento)\s+com\s+(?:um|uma|alguem|algum|uma\s+pessoa|um\s+humano|gente|atendente|vendedor|consultor|responsavel)\b/,
  // A palavra solta não basta ("o atendente de ontem me falou o preço", "sou
  // humano sim kkk"): tem que vir com verbo de pedido.
  /\b(?:quero|queria|preciso|prefiro|tem|teria|chama|chame|me\s+passa|me\s+passe|cade)\s+(?:um\s+|uma\s+|o\s+|a\s+|algum\s+)?(?:atendente|humano|pessoa(?:\s+de\s+verdade|\s+real)?|vendedor|consultor)\b/,
  /\batendimento\s+humano\b/,
  /\bquem\s+(?:vai|vem|que\s+vai)\s+(?:me\s+)?atender\b/,
  // "quero falar com o Diego": nome de quem ele já conhece é pedido de gente,
  // mesmo sem o nome estar configurado em lugar nenhum.
  /\b(?:quero|queria|preciso|posso|gostaria\s+de)\s+falar\s+com\s+(?:o|a)\s+\w{3,}/,
  // Imperativo — pedido de AGORA. "Depois eu posso pedir pra me ligar?" é
  // pergunta sobre o futuro, e virou repasse no teste do dono (28/09).
  /\bme\s+(?:liga|ligue|chama|chame)\b/,
  /\b(?:pode|podem|quero\s+que)\s+me\s+ligar\b/,
];

/**
 * Negação do PEDIDO, não da frase: "Não quero falar com Fernando" não é
 * pedido; "Não consigo cadastrar, preciso falar com alguém" é. A primeira
 * versão negava a frase inteira e perdia o segundo caso (achado da QA, 28/09).
 */
const NEGACAO_DO_PEDIDO =
  /\b(?:nao|nem|nunca)\s+(?:quero|queria|preciso|precisa|precisam|vou)\s+(?:\w+\s+){0,2}(?:falar|conversar|ligacao|ligar|lig|ninguem|atendente|pessoa|consultor)|\bnem\s+sei\s+quem\b|\bninguem\s+(?:me\s+)?(?:lig|lique|precisa)|\b(?:nao|nem)\s+me\s+(?:liga|ligue|ligar|chama|chame)\b/;

export function ehPedidoDeHumano(texto: string, nomesEquipe: readonly string[] = []): boolean {
  const limpo = normalizar(texto);
  if (NEGACAO_DO_PEDIDO.test(limpo)) return false;
  if (PADROES_HUMANO.some((p) => p.test(limpo))) return true;
  // Nome só conta como PEDIDO ("falar com o Diego", "chama o Diego"), nunca
  // solto na frase.
  return nomesEquipe
    .map((n) => normalizar(n))
    .filter((n) => n.length >= 3)
    .some((n) => {
      const nome = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `\\b(?:falar|conversar|fala|chama|chame|chamar|liga|ligue|passa|passe)\\s+(?:com\\s+)?(?:o|a|pro|pra)?\\s*${nome}\\b`,
      ).test(limpo);
    });
}

/**
 * Ele RECUSOU ligação ou pessoa ("não quero falar com Fulano", "não me liga")?
 * Resposta fixa: o modelo, nesse caso, respondia "não tem nenhum Fulano aqui"
 * — nome de pessoa, e ainda por cima falso (simulador, 28/09).
 */
export function recusouContato(texto: string): boolean {
  const limpo = normalizar(texto);
  return NEGACAO_DO_PEDIDO.test(limpo) && !/\?|\b(?:quanto|preco|valor|como)\b/.test(limpo);
}

/**
 * Negociação de preço ("consegue fazer por 1200?", "tem desconto?"). Não é com
 * o robô: numa rodada do simulador o modelo ignorou o pedido e repetiu o preço.
 */
export function ehNegociacaoDePreco(texto: string): boolean {
  const limpo = normalizar(texto);
  return /\b(?:desconto|abatimento|mais\s+barato|abaixa|abaixar|baixar\s+o\s+preco|melhorar\s+o\s+preco|consegue\s+(?:fazer|deixar)\s+(?:por|a)|faz\s+por|fazer\s+por|sai\s+por\s+\d|negociar|chorinho)\b/.test(
    limpo,
  );
}

/**
 * "Quero agendar uma demonstração" (o botão do site manda isso). Resposta fixa
 * com os horários: o modelo, às vezes, pedia "um dia e período" em vez de
 * oferecer — e quem pediu demonstração quer data, não formulário.
 */
export function ehPedidoDeDemonstracao(texto: string): boolean {
  return /\b(?:agendar|marcar|ver|quero)\s+(?:uma\s+)?(?:demo|demonstracao|apresentacao)\b/.test(
    normalizar(texto),
  );
}

/** O pedido é de LIGAÇÃO (e não de conversa por aqui)? Muda a frase do repasse. */
export function pedeLigacao(texto: string): boolean {
  return /\b(?:me\s+(?:liga|ligue)|(?:pode|podem|quero\s+que)\s+me\s+ligar|ligacao|telefonema)\b/.test(
    normalizar(texto),
  );
}

/** "Quem vai me atender?" — a frase do repasse responde o QUEM. */
export function perguntaQuem(texto: string): boolean {
  return /\bquem\b/.test(normalizar(texto));
}

/**
 * "Pode ser", "sim", "quero" — logo depois de o robô oferecer chamar alguém.
 *
 * O caso real: "Vc é um robo" → robô oferece uma pessoa → "Pode ser". Sozinho,
 * "pode ser" não é pedido de nada; depois da oferta, é o pedido mais claro que
 * existe.
 */
/** Um "sim" curto, com complemento opcional ("pode ser a ligação", "ta bom"). */
const SIM =
  /^(?:sim|s|pode|pode\s+ser|pode\s+sim|quero|quero\s+sim|claro|isso|ok|okay|beleza|blz|fechado|ta\s+bom|tabom|bora|por\s+favor|pf|pfv|aceito|prefiro|manda|liga\s+sim)(?:\s+(?:sim|a\s+ligacao|ligacao|o\s+consultor|com\s+ele|pode|por\s+favor|obrigado))?[.! ]*$/;
/**
 * A oferta de PESSOA que o próprio prompt ensina ("Quer que um consultor fale
 * com você?"). A de ligação com horário ("prefere que um consultor te ligue
 * 10 min, ou testar?") NÃO entra: aceitar essa é com o robô, que marca.
 */
const OFERTA_DE_HUMANO =
  /\bquer\s+que\s+(?:um\s+consultor|alguem|uma\s+pessoa|o\s+consultor)(?:\s+da\s+movatruck)?\s+(?:fale|falar|te\s+chame|chame|atenda|te\s+atenda)\b|\b(?:posso|quer\s+que\s+eu)\s+chame?(?:r)?\s+(?:um\s+consultor|alguem|uma\s+pessoa)\b/;

export function aceitouOfertaDeHumano(texto: string, ultimaFalaNossa: string | null): boolean {
  if (!ultimaFalaNossa) return false;
  const limpo = normalizar(texto).replace(/[.!?,]+/g, "").trim();
  return SIM.test(limpo) && OFERTA_DE_HUMANO.test(normalizar(ultimaFalaNossa));
}

/**
 * A nossa última fala esperava resposta (terminou em pergunta, ou ofereceu
 * horário)? Então "ok", "ta bom" e 👍 são RESPOSTA, não despedida — e engolir
 * como encerramento deixou uma ligação aceita sem marcar.
 */
export function esperavaResposta(ultimaFalaNossa: string | null): boolean {
  if (!ultimaFalaNossa) return false;
  return /\?\s*$/.test(ultimaFalaNossa.trim()) || /\b\d{1,2}:\d{2}\b/.test(ultimaFalaNossa);
}
