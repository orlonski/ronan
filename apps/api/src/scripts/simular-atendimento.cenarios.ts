import type { Cenario } from "./simular-atendimento";

/**
 * As conversas do simulador.
 *
 * "real" são as mensagens do Chatwoot de setembro/2026, na ordem em que
 * chegaram. "adversarial" é o que tenta quebrar as regras fixas — negação,
 * futuro, ironia, erro de digitação — porque foi exatamente aí que o teste do
 * dono pegou o que os testes de unidade não pegaram.
 */
export const CENARIOS: Cenario[] = [
  // ---------------------------------------------------------------- reais ---
  {
    nome: "Anúncio, e some",
    canal: "comercial",
    origem: "real",
    passos: [{ cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." }],
  },
  {
    nome: "Anúncio com digitação torta",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conuuuhecer a Movatruck." },
      { cliente: "Xdddd" },
    ],
  },
  {
    nome: "IVY: não sabe o que é, pergunta se é robô, quer gente",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "Ou" },
      { cliente: "Eu nem sei do que é a impresa" },
      { cliente: "Vc é um robo" },
      { cliente: "Pode ser" },
      { cliente: "Ta bom" },
      { cliente: "👍" },
      { cliente: "QUEM VAI ME ATENDER" },
      { cliente: "Mas quem" },
    ],
  },
  {
    nome: "Passe Livre: 3 caminhões, planilha, medo de golpe, quer o link",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "Opa" },
      { cliente: "Eu controlo usando pranila" },
      { cliente: "3" },
      { cliente: "Quero saber mais sim Me explique mais sobre esse sistema" },
      { cliente: "E esse ticket é viagem ficam salvos aonde ?" },
      { cliente: "E tem o risco de isso se perder ? Ou um racker roubar tudo ?" },
      { cliente: "Eu tenho medo de você querer me passar a perna" },
      { cliente: "Ninguém vai me cobrar certeza ?" },
      { cliente: "Manda logo essa porra" },
      { cliente: "Valeu aí Troxa" },
    ],
  },
  {
    nome: "Botão do site: agendar demonstração",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "Oi! Vi o site do Movatruck e quero agendar uma demonstração." },
      { cliente: "amanhã de manhã" },
      { cliente: "o primeiro" },
    ],
  },
  {
    nome: "Pede valores e como funciona, várias vezes",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "Oi! Vi o site do Movatruck e quero agendar uma demonstração." },
      { cliente: "quero saber os valores" },
      { cliente: "como funciona?" },
    ],
  },
  {
    nome: "Aviso automático de ausência de outra empresa",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "S A carlesso Transportes Ltda agradece seu contato. Em breve retornaremos o contato... obrigado" },
      { cliente: "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível." },
    ],
  },
  {
    nome: "Bloquear",
    canal: "comercial",
    origem: "real",
    passos: [{ cliente: "Bloquear" }],
  },
  {
    nome: "Motorista no número de operação: ticket com divergência",
    canal: "operacao",
    origem: "real",
    passos: [
      { cliente: "A viagem q está divergente o balanceiro me entregou o ticket errado na saída mais na hora eu voltei e já corrigi" },
      { cliente: "Só se no sistema dele estiver com outra placa" },
      { cliente: "Eu sou só motorista" },
    ],
  },
  {
    nome: "Motorista no número de operação: quer atualizar o app",
    canal: "operacao",
    origem: "real",
    passos: [{ audio: true }, { cliente: "Gostaria de atualizar o app" }],
  },
  {
    nome: "Motorista no número de operação: viagem sumiu",
    canal: "operacao",
    origem: "real",
    passos: [{ cliente: "Fiz 2 viajem hoje kade a outra" }, { cliente: "Ok" }],
  },
  {
    nome: "Aviso de ausência no número de operação",
    canal: "operacao",
    origem: "real",
    passos: [
      { cliente: "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível." },
    ],
  },

  // --------------------------------------------------------- teste do dono ---
  {
    nome: "Dono: não quero falar com Fernando",
    canal: "comercial",
    origem: "teste-do-dono",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "👍🏻" },
      { cliente: "Não quero falar com Fernando Nem sei quem é ele" },
    ],
  },
  {
    nome: "Dono: qual é melhor, testar primeiro e ligar depois",
    canal: "comercial",
    origem: "teste-do-dono",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "Qual é melhor ?" },
      { cliente: "Posso testar primeiro Depois eu posso pedir pra me ligar ?" },
    ],
  },

  // ----------------------------------------------------------- adversarial ---
  {
    nome: "Negação: não quero ligação, só o preço",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "oi" },
      { cliente: "não quero que ninguém me ligue, só quero saber o preço" },
      { cliente: "tenho 5 caminhões" },
    ],
  },
  {
    nome: "Pede ligação de verdade",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "me liga agora" },
      { cliente: "?" },
    ],
  },
  {
    nome: "Aceita a ligação com 'pode ser'",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "pode ser a ligação" },
      { cliente: "de tarde" },
    ],
  },
  {
    nome: "Quer testar e pergunta como",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "qro testar" },
      { cliente: "precisa de cartão?" },
      { cliente: "obrigado" },
    ],
  },
  {
    nome: "Desconfiado: é golpe?",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "quem é vc? onde conseguiu meu numero" },
      { cliente: "isso é golpe?" },
    ],
  },
  {
    nome: "Pergunta se é robô e diz que não quer gente",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "vc é robô?" },
      { cliente: "não precisa, pode continuar vc mesmo. quanto custa pra 2 caminhões?" },
    ],
  },
  {
    nome: "Negocia desconto",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "quanto custa pra 12 caminhões?" },
      { cliente: "consegue fazer por 1200?" },
      { cliente: "e aí?" },
    ],
  },
  {
    nome: "Integração e concorrente",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "vcs integram com o Sankhya?" },
      { cliente: "e qual a diferença pro Frota Control?" },
    ],
  },
  {
    nome: "Só emoji e 'ok' de primeira",
    canal: "comercial",
    origem: "adversarial",
    passos: [{ cliente: "👍" }, { cliente: "ok" }],
  },
  {
    nome: "Pede pra parar por extenso",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "não tenho interesse, não me mande mais mensagem" },
    ],
  },
  {
    nome: "Áudio no comercial",
    canal: "comercial",
    origem: "adversarial",
    passos: [{ audio: true }, { cliente: "mandei um áudio ali" }],
  },
  {
    nome: "Frota pequena: 1 caminhão, dono dirige",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "tenho um caminhão só, eu mesmo dirijo. serve pra mim?" },
      { cliente: "e quanto fica?" },
    ],
  },

  // -------------------------------------------- gente no Chatwoot, robô fora ---
  {
    nome: "Consultor responde pelo Chatwoot, cliente continua",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { equipe: "Olá, tudo bem? Sou consultor da Movatruck, posso te ligar agora?" },
      { cliente: "pode sim" },
      { cliente: "quanto custa?" },
    ],
  },
  {
    nome: "Consultor só deixa nota interna",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { nota: "vou ligar pra ele às 14h" },
      { cliente: "e aí, como funciona?" },
    ],
  },
  {
    nome: "Consultor só atribui a conversa",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { atribuir: true },
      { cliente: "oi?" },
    ],
  },
  {
    nome: "Consultor etiqueta e depois resolve",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "oi, quero conhecer" },
      { etiquetar: "quente" },
      { cliente: "tô esperando" },
      { resolver: true },
      { cliente: "alguém aí?" },
    ],
  },
];
