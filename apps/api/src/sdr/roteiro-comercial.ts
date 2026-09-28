/**
 * O roteiro da conversa comercial: o que se diz em cada etapa, e como se
 * reconhece em que etapa a conversa está.
 *
 * Nasceu de um teste do dono (28/09/2026) que expôs duas falhas de desenho, e
 * não de frase:
 *
 * 1. A abertura explicava o produto e largava um link. E daí? Quem procurou a
 *    empresa não sabia o que fazer depois, e a conversa morria ali. Agora a
 *    abertura termina numa pergunta fácil sobre a operação DELE, e a resposta
 *    leva aos dois caminhos, cada um explicado.
 *
 * 2. Quem escolhia testar ouvia "comece cadastrando um motorista e lançando uma
 *    viagem". Está errado: quem testa é a TRANSPORTADORA, e ela usa o painel na
 *    internet. O caminho certo é o da lista "Primeiros passos" do painel
 *    (`admin/primeiros-passos/primeiros-passos.service.ts`): criar a conta,
 *    cadastrar caminhão, locais e cliente, e SÓ ENTÃO mandar o app pro
 *    motorista. O robô acompanha esse caminho, sabendo o que já foi feito.
 *
 * Tudo aqui é função pura: texto entra, texto sai. Os testes travam as frases
 * que o dono aprovou.
 */

/** O que a conta de teste já tem. Espelha os passos do painel, na mesma ordem. */
export type ProgressoTeste = {
  veiculo: boolean;
  locais: boolean;
  cliente: boolean;
  motorista: boolean;
  /** Primeira viagem lançada pelo motorista (não conta a importada). */
  viagem: boolean;
};

export type OfertaRoteiro = {
  diasTeste: number | null;
  linkTeste?: string | null;
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NAO_E_NOME =
  /\b(?:transport\w*|trans|logistic\w*|log|ltda|eireli|me|mei|sa|s\/a|comercio|com|industria|ind|frete\w*|carga\w*|minera\w*|construt\w*|constru\w*|areia\w*|pedreira\w*|brita\w*|terraplenagem|empresa|grupo|servicos?|distribui\w*|atacad\w*|cliente|teste|oficina|auto|mecanica|posto|agro\w*|fazenda|madeireira|materiais|deposito)\b/;

/** Primeiro nome, só quando parece nome de gente ("Passe Livre — Diego" → "Diego"). */
export function primeiroNome(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const parte = nome.split(/[—–|-]/).pop()!.trim();
  const primeiro = parte.split(/\s+/)[0] ?? "";
  if (!/^[A-Za-zÀ-ÿ]{2,20}$/.test(primeiro)) return null;
  // Nome de perfil de WhatsApp Business costuma ser o da empresa ("Transportes
  // Silva"): chamar alguém de "Transportes" é pior que não chamar pelo nome.
  if (NAO_E_NOME.test(normalizar(parte)) || NAO_E_NOME.test(normalizar(primeiro))) return null;
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

// ─── 1. A abertura ─────────────────────────────────────────────────────────

/**
 * A primeira resposta. Diz o que é, pra QUEM é, e termina numa pergunta que
 * qualquer dono de transportadora responde sem pensar.
 *
 * Sem link: o link solto na primeira mensagem era o fim da conversa, não o
 * começo. E sem "quantos caminhões?": pergunta de cadastro antes de mostrar
 * qualquer coisa é pedágio (as conversas de setembro morreram nela).
 */
export function abertura(nome: string | null): string {
  const oi = nome ? `Opa, ${nome}! Aqui é o atendimento da Movatruck.` : "Opa! Aqui é o atendimento da Movatruck.";
  return (
    `${oi}\n` +
    "A Movatruck organiza as viagens da transportadora: o motorista lança cada viagem no app " +
    "(ticket, peso, pedágio) e você acompanha tudo num painel na internet, com o fechamento do mês pronto por cliente.\n" +
    "Hoje vocês controlam as viagens como: planilha, caderno ou algum sistema?"
  );
}

/**
 * "Quero conhecer a Movatruck", "me fala mais": pedido de apresentação. Vale
 * a abertura em qualquer ponto da conversa, não só no primeiro contato: no
 * teste do dono (28/09), a frase do anúncio numa conversa antiga foi pro
 * modelo e saiu "Opa." e mais nada.
 */
export function querConhecer(texto: string): boolean {
  const t = normalizar(texto);
  return /\b(?:quero|queria|gostaria\s+de|vim)\s+(?:conhecer|saber\s+mais|entender)\b|\bme\s+(?:fala|conta|explica)\s+(?:mais|sobre|o\s+que)\b|\bo\s+que\s+(?:e|faz)\s+(?:a\s+)?movatruck\b/.test(t);
}

/** A abertura acabou de sair (é a pergunta dela que está esperando resposta)? */
export function ehAbertura(fala: string | null): boolean {
  return /controlam\s+as\s+viagens\s+como\b/i.test(fala ?? "");
}

// ─── 2. Os dois caminhos ───────────────────────────────────────────────────

/** Como ele disse que controla hoje, quando disse. */
export function controleAtual(texto: string): "planilha" | "caderno" | "whatsapp" | "sistema" | "nada" | null {
  const t = normalizar(texto);
  if (/\b(?:planilha|pranila|excel|exel)\b/.test(t)) return "planilha";
  if (/\b(?:caderno|caderninho|papel|anot\w*|bloco|agenda)\b/.test(t)) return "caderno";
  if (/\b(?:whats(?:app)?|zap|wpp)\b/.test(t)) return "whatsapp";
  if (/\b(?:sistema|software|programa|aplicativo|app)\b/.test(t)) return "sistema";
  if (/\b(?:nada|nenhum|de\s+cabeca|na\s+cabeca|na\s+memoria|nao\s+control\w*)\b/.test(t)) return "nada";
  return null;
}

const RECONHECIMENTO: Record<NonNullable<ReturnType<typeof controleAtual>>, string> = {
  planilha:
    "Entendi, planilha. Com a Movatruck a viagem já chega lançada pelo motorista, com a foto do ticket, e o fechamento sai do painel sem digitar nada no fim do mês.",
  caderno:
    "Entendi, no caderno. Com a Movatruck a viagem já chega lançada pelo motorista, com a foto do ticket, e o fechamento sai do painel sem somar nada à mão.",
  whatsapp:
    "Entendi, pelo WhatsApp. Com a Movatruck cada viagem chega organizada no painel, com a foto do ticket, em vez de perdida no meio das conversas.",
  sistema:
    "Entendi. A diferença aqui é que a viagem já chega lançada pelo motorista, direto do celular e com a foto do ticket, e funciona até sem sinal.",
  nada:
    "Entendi. Com a Movatruck cada viagem fica registrada pelo próprio motorista, com a foto do ticket, e o fechamento do mês sai pronto do painel.",
};

/**
 * A escolha, com o que cada caminho É. "Ligação ou teste?" sozinho deixava a
 * pessoa sem saber o que ia acontecer em nenhum dos dois.
 */
export function caminhos(o: OfertaRoteiro, controle: ReturnType<typeof controleAtual> = null): string {
  const inicio = controle ? `${RECONHECIMENTO[controle]}\n\n` : "";
  if (!o.diasTeste) {
    return `${inicio}Quer que um consultor te ligue uns 10 minutos pra mostrar o sistema funcionando?`;
  }
  return (
    `${inicio}Pra você conhecer, tem dois caminhos:\n` +
    "*1.* Um consultor te liga e mostra o sistema funcionando, uns 10 minutos\n" +
    `*2.* Você cria sua conta e testa ${o.diasTeste} dias grátis, sem cartão, e eu te acompanho aqui em cada passo\n` +
    "Qual prefere?"
  );
}

/** A pergunta dos caminhos está esperando resposta? */
export function ehCaminhos(fala: string | null): boolean {
  return /tem\s+dois\s+caminhos/i.test(fala ?? "") || /\bte\s+ligue\s+uns\s+10\s+minutos\b/i.test(fala ?? "");
}

/** Resposta aos caminhos: "1", "a primeira", "ligação" → 1; "2", "testar" → 2. */
export function escolhaDeCaminho(texto: string): 1 | 2 | null {
  const t = normalizar(texto).replace(/[.!?,*]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:o\s+|a\s+|opcao\s+|numero\s+)?(?:1|um|primeir[oa])(?:\s+(?:opcao|caminho))?$/.test(t)) return 1;
  if (/^(?:o\s+|a\s+|opcao\s+|numero\s+)?(?:2|dois|segund[oa])(?:\s+(?:opcao|caminho))?$/.test(t)) return 2;
  // "Não quero ligação", "sem ligar": recusa não é escolha. Quem recusa um
  // caminho e escolhe o outro na mesma frase cai nas regras de sempre.
  if (/\b(?:nao|nem|sem|ninguem|nunca)\b/.test(t)) return null;
  const teste = /\btest\w*|\bcriar?\s+(?:a\s+|minha\s+)?conta\b|\bsozinho\b|\bpor\s+conta\b/.test(t);
  const ligacao = /\bliga(?:cao|r|m)?\b|\bconsultor\b|\bme\s+mostr|\bquero\s+ver\b|\bdemonstra/.test(t);
  if (teste && !ligacao) return 2;
  if (ligacao && !teste) return 1;
  return null;
}

// ─── 3. O teste guiado ─────────────────────────────────────────────────────

/**
 * Primeiro passo do teste: criar a conta. Diz o que o formulário vai pedir
 * (`dashboard/src/app/cadastro/page.tsx`) pra ninguém se assustar com a senha
 * nem com o código no WhatsApp, e promete o que o robô de fato faz: quando a
 * conta nasce com este telefone, ele manda o próximo passo sozinho.
 */
export function testePasso1(o: OfertaRoteiro): string {
  return (
    `Boa! O primeiro passo é criar a conta da sua transportadora, leva uns 2 minutos:\n${o.linkTeste}\n\n` +
    "Ele pede o nome da transportadora, seu nome, WhatsApp, e-mail e uma senha. " +
    "Chega um código no WhatsApp pra confirmar e você já entra no painel.\n\n" +
    `São ${o.diasTeste} dias grátis, sem cartão e sem fidelidade. ` +
    "Use este mesmo número no cadastro que, assim que a conta for criada, eu te mando aqui o que cadastrar primeiro."
  );
}

/** O passo 1 já saiu nesta conversa? */
export function ehTestePasso1(fala: string | null): boolean {
  return /criar\s+a\s+conta\s+da\s+sua\s+transportadora/i.test(fala ?? "");
}

const PASSOS: { chave: keyof ProgressoTeste; texto: string }[] = [
  { chave: "veiculo", texto: "*Caminhões:* só a placa já basta pra começar" },
  { chave: "locais", texto: "*Locais:* onde vocês carregam e onde descarregam (pedreira, obra, usina)" },
  { chave: "cliente", texto: "*Clientes:* quem te contrata e paga o frete" },
  {
    chave: "motorista",
    texto:
      // Os links das lojas ficam no card "Comece por aqui" da home
      // (`dashboard/src/components/chegada.tsx`), não na tela de Motoristas.
      "*Motoristas:* na tela inicial do painel tem o link do app pra mandar pra eles. Cada um cria o cadastro com o CPF, e você convida pelo CPF em *Motoristas*",
  },
];

/**
 * O que cadastrar, na ordem de dependência do painel, pulando o que já foi
 * feito. `null` em `progresso` = não dá pra saber (a conta foi criada com outro
 * telefone): vai a lista inteira.
 */
export function testePasso2(progresso: ProgressoTeste | null, comConta = true): string {
  const faltam = PASSOS.filter((p) => !progresso || !progresso[p.chave]);
  if (faltam.length === 0) return testeProntoParaViajar(progresso!);

  const feitos = progresso ? PASSOS.filter((p) => progresso[p.chave]) : [];
  const cabeca = !comConta
    ? "Boa! Agora é deixar o painel com a cara da sua operação. Nesta ordem:"
    : feitos.length === 0
      ? "Conta criada! Agora é deixar o painel com a cara da sua operação. Nesta ordem:"
      : `Vi que você já cadastrou ${listar(feitos.map((p) => NOME_DO_PASSO[p.chave]))}. Agora falta:`;
  const itens = faltam.map((p, i) => `*${i + 1}.* ${p.texto}`).join("\n");
  const fim =
    feitos.length === 0
      ? "\n\nTudo isso aparece em *Primeiros passos*, na tela inicial do painel. Se já tem esses dados numa planilha, dá pra subir tudo de uma vez em *Importar dados*, no menu.\n" +
        "Travou em algum? Me chama aqui."
      : "\n\nTravou em algum? Me chama aqui.";
  return `${cabeca}\n${itens}${fim}`;
}

const NOME_DO_PASSO: Record<keyof ProgressoTeste, string> = {
  veiculo: "caminhão",
  locais: "os locais",
  cliente: "cliente",
  motorista: "motorista",
  viagem: "viagem",
};

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Os cadastros da empresa estão feitos: agora é o motorista. */
export function testeProntoParaViajar(progresso: ProgressoTeste): string {
  if (progresso.viagem) {
    return "Tudo certo por aí: já tem viagem lançada pelo motorista no seu painel. Se quiser, um consultor te mostra como fechar o mês com elas, é só pedir aqui.";
  }
  return (
    "A sua parte está pronta: caminhão, locais, cliente e motorista cadastrados.\n" +
    "Agora é o motorista abrir o app e lançar a primeira viagem. Ela aparece no seu painel na hora, com o ticket."
  );
}

/** O passo 2 (a lista do que cadastrar) já saiu nesta conversa? */
export function ehTestePasso2(fala: string | null): boolean {
  return /\bnesta\s+ordem:|\bagora\s+falta:|\bsua\s+parte\s+est[aá]\s+pronta\b/i.test(fala ?? "");
}

/**
 * "Onde cadastro a pedreira?", "como coloco o caminhão?": a resposta é o
 * caminho no menu do painel (`dashboard/src/components/sidebar.tsx`). O modelo,
 * aqui, respondeu "ainda não vamos pra pedreira" e cortou a lista no meio
 * (simulador, 28/09).
 */
export function duvidaDeCadastro(texto: string): string | null {
  const t = normalizar(texto);
  if (!/\b(?:onde|como|aonde|qual|cade)\b/.test(t) && !/\?/.test(texto)) return null;
  if (!/\b(?:cadastr\w*|coloc\w*|bot\w*|poe|ponho|adicion\w*|inclu\w*|lanc\w*|registr\w*|crio|criar|acho|fica|convid\w*|mando|mandar)\b/.test(t)) return null;
  if (/\b(?:caminh\w*|placa|veiculo\w*|carreta|truck|bitrem)\b/.test(t)) {
    return "No painel, menu *Veículos*, botão *Novo*. Só a placa já basta pra começar.";
  }
  if (/\b(?:pedreira|obra|local|locais|usina|porto|deposito|descarga|carga|jazida|areal|mina|endereco)\b/.test(t)) {
    return (
      "No painel, menu *Locais*, botão *Novo*. Cadastre onde vocês carregam (a pedreira, por exemplo) " +
      "e onde descarregam (a obra): cada viagem precisa dos dois."
    );
  }
  if (/\b(?:cliente\w*|contratante|quem\s+paga|empresa\s+que)\b/.test(t)) {
    return "No painel, menu *Clientes*, botão *Novo*. É quem te contrata e paga o frete; a obra com o mesmo nome já nasce junto.";
  }
  if (/\b(?:motorista\w*|convid\w*|app|aplicativo)\b/.test(t)) {
    return (
      "Na tela inicial do painel tem o link do app pra mandar pro motorista. Ele baixa e cria o cadastro com o CPF dele; " +
      "depois você vai em *Motoristas* e convida pelo CPF. Ele aceita no celular e já pode lançar viagem."
    );
  }
  return null;
}

/** "Criei", "pronto", "já entrei", "fiz o cadastro" — depois do passo 1. */
export function disseQueCriouConta(texto: string): boolean {
  const t = normalizar(texto);
  if (/\b(?:nao|ainda\s+nao)\s+(?:consegui|criei|entrei|fiz|deu)\b/.test(t)) return false;
  return /\b(?:criei|cadastrei|fiz\s+(?:o\s+)?cadastro|ja\s+entrei|entrei|consegui|pronto|feito|foi|deu\s+certo|ta\s+criad\w*|conta\s+criad\w*)\b/.test(t);
}

/** "Vou almoçar e depois faço", "mais tarde eu vejo": ficou pra depois. */
export function vaiFazerDepois(texto: string): boolean {
  const t = normalizar(texto);
  return /\b(?:depois|mais\s+tarde|amanha|a\s+noite|de\s+noite|outra\s+hora|mais\s+pra\s+frente|volto|voltar)\b/.test(t) &&
    !/\b(?:lig\w*|consultor)\b/.test(t);
}

export function respostaDepois(texto: string): string {
  const almoco = /\balmo[cç]\w*/i.test(texto);
  return `Combinado! Quando criar a conta com este número, eu te mando aqui o próximo passo na hora.${almoco ? " Bom almoço!" : ""}`;
}

/** Depois do link, "não entendi", "o consultor vai me ligar?": como vai ser. */
export function naoEntendeuOTeste(texto: string): boolean {
  const t = normalizar(texto);
  return /\bnao\s+entendi\b|\b(?:consultor|alguem)\s+vai\s+(?:me\s+)?ligar\b|\bvoce\s+me\s+ajuda\b|\bcomo\s+(?:vai\s+ser|funciona\s+isso|e\s+que\s+funciona)\b|\bdepois\s+(?:voce|vc)\s+me\b/.test(t);
}

export const RESPOSTA_COMO_E_O_TESTE =
  "Isso: você cria a conta pelo link e, assim que ela estiver criada, eu te mando aqui o que cadastrar, um passo de cada vez. " +
  "Ninguém te liga sem você pedir. Se em algum momento preferir fazer junto com um consultor, é só falar aqui.";

/** "Não chegou o código", "cadê o código". */
export function codigoNaoChegou(texto: string): boolean {
  const t = normalizar(texto);
  return /\bcodigo\b/.test(t) && /\b(?:nao\s+(?:chegou|veio|recebi|chega)|cade|demor\w*|nada)\b/.test(t);
}

export const RESPOSTA_CODIGO =
  "O código vai pro WhatsApp que você colocou no cadastro. Confere se o número está com DDD. " +
  "Se em 1 minuto não chegar, toque em *Reenviar código* na mesma tela.";

/** Travou no cadastro ("não consegui", "deu erro"): ajuda humana, sem enrolar. */
export function travouNoCadastro(texto: string): boolean {
  const t = normalizar(texto);
  return /\b(?:nao\s+consegui|nao\s+consigo|deu\s+erro|da\s+erro|travou|nao\s+(?:abre|carrega|funciona|entra))\b/.test(t);
}

/**
 * O único lembrete, se ele pegou o link e sumiu sem criar a conta. Um toque
 * só, útil, com saída fácil: nada de "estou aguardando".
 */
export function lembreteDoTeste(nome: string | null): string {
  return `${nome ? `Oi, ${nome}! ` : "Oi! "}Conseguiu criar a conta? Se travou em alguma parte, me conta que eu te ajudo por aqui.`;
}

/** Saudação solta ("oi", "bom dia") no meio do teste: retoma de onde parou. */
export function retomadaDoTeste(nome: string | null, comConta: boolean): string {
  const oi = nome ? `Oi, ${nome}!` : "Oi!";
  return comConta
    ? `${oi} Como está indo o teste? Se travou em algum cadastro, me conta que eu te ajudo.`
    : `${oi} Conseguiu criar a conta? Se travou em alguma parte, me conta que eu te ajudo.`;
}
