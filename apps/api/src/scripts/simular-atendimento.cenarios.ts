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
    espera: { repasses: 0, ultimaSemResposta: false },
  },
  {
    nome: "Anúncio com digitação torta",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conuuuhecer a Movatruck." },
      { cliente: "Xdddd" },
    ],
    espera: { repasses: 0 },
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
    espera: { repasses: 1, alertas: 2, roboAtivo: false },
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
    espera: { repasses: 0, contem: "app.movatruck.com.br/cadastro" },
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
    espera: { repasses: 1, alertas: 1, contem: "te liga" },
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
    espera: { ultimaSemResposta: false },
  },
  {
    nome: "Aviso automático de ausência de outra empresa",
    canal: "comercial",
    origem: "real",
    passos: [
      { cliente: "S A carlesso Transportes Ltda agradece seu contato. Em breve retornaremos o contato... obrigado" },
      { cliente: "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível." },
    ],
    espera: { repasses: 0, ultimaSemResposta: true },
  },
  {
    nome: "Bloquear",
    canal: "comercial",
    origem: "real",
    passos: [{ cliente: "Bloquear" }],
    espera: { optOut: true, repasses: 0 },
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
    espera: { repasses: 1, alertas: 0, contem: "suporte" },
  },
  {
    nome: "Motorista no número de operação: quer atualizar o app",
    canal: "operacao",
    origem: "real",
    passos: [{ audio: true }, { cliente: "Gostaria de atualizar o app" }],
    espera: { repasses: 1, alertas: 0 },
  },
  {
    nome: "Motorista no número de operação: viagem sumiu",
    canal: "operacao",
    origem: "real",
    passos: [{ cliente: "Fiz 2 viajem hoje kade a outra" }, { cliente: "Ok" }],
    espera: { repasses: 1, alertas: 0, ultimaSemResposta: true },
  },
  {
    nome: "Aviso de ausência no número de operação",
    canal: "operacao",
    origem: "real",
    passos: [
      { cliente: "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível." },
    ],
    espera: { repasses: 0, ultimaSemResposta: true },
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
    espera: { repasses: 0, ultimaSemResposta: false },
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
    espera: { repasses: 0, contem: "cadastro" },
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
    espera: { repasses: 0, ultimaSemResposta: false },
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
    espera: { repasses: 1, alertas: 2, contem: "te liga" },
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
    espera: { contem: "14:00" },
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
    espera: { repasses: 0 },
  },
  {
    nome: "Desconfiado: é golpe?",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "quem é vc? onde conseguiu meu numero" },
      { cliente: "isso é golpe?" },
    ],
    espera: { repasses: 0 },
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
    espera: { repasses: 0, ultimaSemResposta: false },
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
    espera: { repasses: 1, alertas: 2 },
  },
  {
    nome: "Integração e concorrente",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "vcs integram com o Sankhya?" },
      { cliente: "e qual a diferença pro Frota Control?" },
    ],
    espera: { repasses: 1 },
  },
  {
    nome: "Só emoji e 'ok' de primeira",
    canal: "comercial",
    origem: "adversarial",
    passos: [{ cliente: "👍" }, { cliente: "ok" }],
    // A primeira mensagem ("👍") TEM que ter resposta; o "ok" depois dela pode
    // ficar em silêncio, porque a abertura terminou em pergunta… e aí o "ok"
    // é resposta: o robô segue.
    espera: { repasses: 0 },
  },
  {
    nome: "Pede pra parar por extenso",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "não tenho interesse, não me mande mais mensagem" },
    ],
    espera: { optOut: true, repasses: 0 },
  },
  {
    nome: "Áudio no comercial",
    canal: "comercial",
    origem: "adversarial",
    passos: [{ audio: true }, { cliente: "mandei um áudio ali" }],
    espera: { repasses: 0, contem: "ouvir áudio", ultimaSemResposta: false },
  },
  {
    nome: "Frota pequena: 1 caminhão, dono dirige",
    canal: "comercial",
    origem: "adversarial",
    passos: [
      { cliente: "tenho um caminhão só, eu mesmo dirijo. serve pra mim?" },
      { cliente: "e quanto fica?" },
    ],
    espera: { repasses: 0 },
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
    espera: { repasses: 0, alertas: 0, ultimaSemResposta: true, roboAtivo: false },
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
    espera: { repasses: 0, alertas: 1, ultimaSemResposta: true, roboAtivo: false },
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
    espera: { repasses: 0, alertas: 1, ultimaSemResposta: true, roboAtivo: false },
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
    espera: { roboAtivo: true, ultimaSemResposta: false },
  },
  // ------------------------------------------------ casos que a QA listou ---
  {
    nome: "QA: '?' como primeira mensagem",
    canal: "comercial",
    origem: "qa",
    passos: [{ cliente: "?" }],
    espera: { repasses: 0, ultimaSemResposta: false },
  },
  {
    nome: "QA: não consegue cadastrar e pede alguém",
    canal: "comercial",
    origem: "qa",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "Não consigo cadastrar, preciso falar com alguém" },
    ],
    espera: { repasses: 1, alertas: 1, roboAtivo: false },
  },
  {
    nome: "QA: quer falar com alguém antes de testar",
    canal: "comercial",
    origem: "qa",
    passos: [{ cliente: "quero falar com alguém antes de testar" }],
    espera: { repasses: 1, alertas: 1 },
  },
  {
    nome: "QA: não me liga, manda o preço aqui",
    canal: "comercial",
    origem: "qa",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "não me liga, me manda o preço aqui" },
    ],
    espera: { optOut: false, repasses: 0, ultimaSemResposta: false },
  },
  {
    nome: "QA: cita o atendente de ontem",
    canal: "comercial",
    origem: "qa",
    passos: [{ cliente: "o atendente de ontem disse que era 500 por mês, confere?" }],
    // Não é pedido de gente pela regra fixa; o que o modelo faz com o preço
    // (perguntar a frota ou passar) fica pra leitura da transcrição.
    espera: { ultimaSemResposta: false },
  },
  {
    nome: "QA: 'vc é robô?' e aceita com 'sim'",
    canal: "comercial",
    origem: "qa",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { cliente: "vc é robô?" },
      { cliente: "sim" },
    ],
    espera: { repasses: 1, alertas: 1, roboAtivo: false },
  },
  {
    nome: "QA: vou te bloquear",
    canal: "comercial",
    origem: "qa",
    passos: [{ cliente: "para de me mandar isso, vou te bloquear" }],
    espera: { optOut: true, repasses: 0 },
  },
  {
    nome: "QA: opt-out e depois 'ok'",
    canal: "comercial",
    origem: "qa",
    passos: [{ cliente: "sair" }, { cliente: "ok" }],
    espera: { optOut: true, repasses: 0, ultimaSemResposta: true },
  },
  {
    nome: "QA: consultor atribui e cliente pede pra sair",
    canal: "comercial",
    origem: "qa",
    passos: [
      { cliente: "Tenho transportadora a granel e quero conhecer a Movatruck." },
      { atribuir: true },
      { cliente: "sair" },
    ],
    espera: { optOut: true, ultimaSemResposta: true },
  },
  {
    nome: "QA: repasse, cliente cobra duas vezes",
    canal: "comercial",
    origem: "qa",
    passos: [
      { cliente: "quero falar com uma pessoa" },
      { cliente: "?" },
      { cliente: "e aí??" },
    ],
    espera: { repasses: 1, alertas: 2, ultimaSemResposta: true, contem: "Já avisei" },
  },
  {
    nome: "QA: resolvida e o cliente volta",
    canal: "comercial",
    origem: "qa",
    passos: [
      { cliente: "quero falar com uma pessoa" },
      { equipe: "Oi! Aqui é consultor da Movatruck, te liguei agora." },
      { resolver: true },
      { cliente: "oi, voltei, quanto custa pra 4 caminhões?" },
    ],
    espera: { ultimaSemResposta: false, roboAtivo: true },
  },
  {
    nome: "QA: aceita ligação e pede de tarde",
    canal: "comercial",
    origem: "qa",
    passos: [
      { cliente: "Oi! Vi o site do Movatruck e quero agendar uma demonstração." },
      { cliente: "de tarde" },
      { cliente: "ok" },
      // "ok" pra dois horários pede confirmação ("Fica hoje às 14:00, então?").
      { cliente: "sim" },
    ],
    espera: { repasses: 1, alertas: 1, contem: "te liga" },
  },
];
