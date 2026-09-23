/**
 * PARA QUE SERVE CADA TELA — em português de quem nunca abriu o sistema.
 *
 * ⚠️ Nasceu de uma frase do dono sobre a Torre de controle: "vou ser sincero
 * em dizer que nem eu sei pra que essa tela serve". A tela TEM subtítulo desde
 * sempre ("O que está fora do esperado agora") — e é justamente esse o
 * problema: aquilo DESCREVE, não EXPLICA. Quem chega precisa de outra coisa:
 * que problema isto resolve, o que eu vou ver aqui, e o que eu faço quando
 * vir.
 *
 * ⚠️ NADA AQUI PODE SER MAIOR QUE O SISTEMA. Cada frase é uma promessa que a
 * tela tem que cumprir — texto que promete o que o produto não faz é pior que
 * texto nenhum, porque manda a pessoa procurar o que não existe. Toda entrada
 * foi escrita lendo a tela e a regra por trás dela, não o nome do menu.
 *
 * ⚠️ O texto mora LONGE da tela de propósito: é o mesmo catálogo que o teste
 * varre pra cobrar que rota nova nasça explicada. Espalhar em 50 arquivos
 * transformaria "toda tela tem explicação" numa disciplina que depende da
 * memória de quem escreve o código.
 */

export type SobreATela = {
  /** UMA frase, sem jargão: que problema esta tela resolve. */
  oQue: string;
  /** O que a pessoa FAZ aqui. Verbo na frente, uma ação por linha. */
  faz: string[];
  /**
   * O engano mais provável, e a saída.
   *
   * ⚠️ É a parte que mais vale pra quem é leigo, e a que o resto do mercado
   * não faz: quando a pessoa abre o grupo errado, o que ela precisa não é de
   * uma explicação melhor desta tela — é do nome da tela certa.
   */
  naoEAqui?: { procurando: string; vaEm: string; href: string };
  /**
   * Outros endereços que são A MESMA tela.
   *
   * ⚠️ O casamento é EXATO de propósito: por prefixo, `/motoristas/123` herdaria
   * a explicação da lista, e ficha de uma pessoa não é lista de pessoas. O
   * preço disso é que rota que só REDIRECIONA nunca chega a explicar nada —
   * `/relatorios` manda pra `/relatorios/viagens`, então a explicação escrita
   * pra ela seria texto morto. Aqui se diz quais endereços valem também.
   */
  tambemEm?: string[];
};

export const SOBRE_AS_TELAS: Record<string, SobreATela> = {
  "/torre": {
    oQue:
      "Mostra as viagens que saíram do normal agora, pra alguém do escritório " +
      "ligar pro motorista antes de o cliente ligar pra você.",
    faz: [
      "Ver o que o sistema achou estranho nas viagens guiadas: atraso, viagem sem novidade há tempo demais, sem sinal de GPS, ou viagem que ficou aberta",
      "Falar com o motorista direto do alerta, por telefone ou WhatsApp",
      "Dar um alerta por resolvido quando você já sabe o que era",
      "Registrar uma ocorrência na viagem (fila, quebra, carga recusada) e encerrar quando passar",
    ],
    naoEAqui: {
      procurando: "ver onde cada caminhão está no mapa",
      vaEm: "Mapa",
      href: "/mapa",
    },
  },

  "/programacao": {
    oQue:
      "É onde o dia seguinte é montado: quem atende qual pedido, e quantas " +
      "viagens cada um faz.",
    faz: [
      "Montar as viagens do dia antes de elas acontecerem",
      "Publicar pro app, pra cada motorista ver só o que é dele",
      "Acompanhar o que já foi feito do que estava programado",
    ],
    naoEAqui: {
      procurando: "as viagens que já aconteceram",
      vaEm: "Viagens",
      href: "/viagens",
    },
  },

  "/viagens-andamento": {
    oQue:
      "As viagens acontecendo neste momento, uma linha do tempo por viagem — do " +
      "início até a descarga.",
    faz: [
      "Ver em que pé está cada viagem aberta agora",
      "Acompanhar os eventos que o motorista foi registrando pelo caminho",
    ],
    naoEAqui: {
      procurando: "o que deu errado e precisa de alguém",
      vaEm: "Torre de controle",
      href: "/torre",
    },
  },

  "/mapa": {
    oQue: "Onde a frota está agora, no mapa.",
    faz: [
      "Ver a última posição que cada motorista mandou, na janela de tempo que você escolher",
      "Ligar e desligar as camadas: motoristas, locais e praças de pedágio",
    ],
    naoEAqui: {
      procurando: "o caminho que uma viagem fez",
      vaEm: "Viagens",
      href: "/viagens",
    },
  },

  "/viagens": {
    oQue:
      "Tudo que os motoristas lançaram pelo app: a viagem, o peso, o ticket da " +
      "balança. É daqui que sai o que se cobra do cliente.",
    faz: [
      "Conferir o que o motorista mandou e corrigir o que veio errado",
      "Achar viagem por motorista, obra ou período, ou digitar o ticket, a placa ou o material na busca",
      "Abrir uma viagem pra ver a foto do ticket e o caminho que ela fez",
    ],
    naoEAqui: {
      procurando: "montar as viagens de amanhã",
      vaEm: "Programação do dia",
      href: "/programacao",
    },
  },

  "/acertos": {
    oQue:
      "O que a empresa deve a cada motorista parceiro no período — o extrato que " +
      "vocês conferem juntos antes de pagar.",
    faz: [
      "Gerar o acerto do período a partir do que ele rodou",
      "Lançar adiantamento, desconto e o que foi combinado à mão",
      "Fechar o acerto: ele trava no valor e já vira conta a pagar",
      "Marcar como pago quando o dinheiro sair — e pago não reabre",
    ],
    naoEAqui: {
      procurando: "quem é registrado em carteira",
      vaEm: "Ponto do dia",
      href: "/ponto",
    },
  },

  "/": {
    oQue:
      "A primeira olhada do dia: quanto rodou hoje, quanto já deu no mês e o " +
      "que está parado esperando alguém resolver.",
    faz: [
      "Ver o movimento de hoje: viagens, toneladas, motoristas que entraram no app e caminhões que rodaram",
      "Ver a curva de viagens dos últimos 14 dias",
      "Ver o mês até aqui: faturamento, peso carregado e gasto com combustível",
      "Ir direto no que está parado: viagem sem peso, viagem que não bateu, planilha esperando revisão",
      "Ver quem mais rodou no mês — motoristas, obras e materiais",
    ],
    naoEAqui: {
      procurando: "os números de um período fechado, somados por motorista ou por cliente",
      vaEm: "Relatórios",
      href: "/relatorios",
    },
  },

  "/relatorios": {
    oQue:
      "Os números de um período somados do jeito que você precisa olhar — por " +
      "motorista, obra, cliente, material, local de carga ou descarga, " +
      "caminhão ou frota.",
    faz: [
      "Escolher o período e agrupar a produção do jeito que interessa na hora",
      "Ver o gasto com combustível e quantos quilômetros por litro cada caminhão fez",
      "Ver quanto tempo as viagens estão demorando pra ser conferidas",
      "Baixar em Excel ou PDF o que está nas abas Viagens e Abastecimentos",
    ],
    // Era "conferir uma viagem de cada vez → Viagens". Trocado em 23/09/2026:
    // o engano que mais acontece aqui é baixar a produção em Excel achando que
    // é o arquivo que vai pro cliente — e esse sai no layout dele, em outro
    // lugar, com registro de quando foi.
    naoEAqui: {
      procurando: "mandar pro cliente a planilha do fechamento",
      vaEm: "Fechamento com o cliente › Mandar a minha planilha",
      href: "/envios",
    },
    // A rota do menu só redireciona pra primeira aba; as quatro são a mesma
    // tela com o mesmo propósito. Sem isto, este texto nunca apareceria.
    tambemEm: [
      "/relatorios/viagens",
      "/relatorios/abastecimentos",
      "/relatorios/consumo",
      "/relatorios/conferencia",
    ],
  },

  "/pedidos": {
    oQue:
      "O que o cliente combinou receber — quanto, pra onde e até quando — e " +
      "quanto disso já foi entregue.",
    faz: [
      "Cadastrar o combinado: cliente, obra, material, destino, quantidade e prazo",
      "Acompanhar quanto já entregou e quanto falta, somado das viagens que aconteceram de verdade",
      "Ver quais pedidos estão apertados ou já passaram do prazo, e quanto precisa sair por dia",
    ],
    naoEAqui: {
      procurando: "dividir o pedido nas viagens de amanhã",
      vaEm: "Programação do dia",
      href: "/programacao",
    },
  },

  "/abastecimentos": {
    oQue:
      "Todo o combustível que os motoristas registraram pelo app: litros, " +
      "valor, posto e odômetro, com a foto de quando tem.",
    faz: [
      "Ver o que foi abastecido no período, com o total de litros e de dinheiro",
      "Filtrar por tipo de combustível, motorista, cliente e período, ou digitar o posto e a placa na busca",
      "Abrir um abastecimento pra ver a foto e o odômetro que o motorista anotou",
    ],
    naoEAqui: {
      procurando: "quantos quilômetros por litro cada caminhão está fazendo",
      vaEm: "Relatórios",
      href: "/relatorios",
    },
  },

  "/conferencias": {
    oQue:
      "O que a leitura automática enxergou na foto do ticket, lado a lado com " +
      "o que o motorista lançou — pra sobrar pra você só o que não bateu.",
    faz: [
      "Ver, viagem por viagem, onde o ticket e o que foi lançado não bateram",
      "Olhar só o que diverge, só o que ficou em dúvida, ou só o campo que mais dá diferença",
      "Mandar ler as viagens antigas que ainda não passaram pela conferência",
      "Reavaliar o que já foi lido quando a regra melhora, sem gastar nada",
    ],
    naoEAqui: {
      procurando: "corrigir a viagem que não bateu",
      vaEm: "Viagens",
      href: "/viagens",
    },
  },

  "/lancamentos-travados": {
    oQue:
      "A cópia de segurança do que o app do motorista tentou mandar e o " +
      "sistema recusou, pra nada se perder até alguém resolver. Quando o " +
      "envio acaba dando certo, o caso fecha sozinho.",
    faz: [
      "Ver o que travou, de quem é, e o motivo que o motorista leu no celular",
      "Ver qual cadastro sumiu — o caminhão, o local, o material —, que costuma ser a explicação inteira",
      "Encerrar o caso depois de lançar a viagem na mão, ou descartar quando não serve mais",
    ],
    naoEAqui: {
      procurando: "o lançamento que entrou e veio errado",
      vaEm: "Viagens",
      href: "/viagens",
    },
  },

  "/fechamentos": {
    oQue:
      "A planilha que o cliente manda no fim do período, conferida linha a linha " +
      "com o que os motoristas lançaram — só sobra pra você o que não bateu.",
    faz: [
      "Subir o arquivo que o cliente mandou (XLSX, CSV ou PDF) e deixar o sistema casar cada linha com a viagem, o pedágio ou o abastecimento que já está aqui",
      "Decidir só as linhas que ficaram pendentes: aceitar a viagem que o sistema sugeriu, apontar outra, criar a viagem retroativa ou marcar como erro do cliente",
      "Ver quantas linhas casaram sozinhas, quantas a leitura automática sugeriu e quantas sobraram pra você",
      "Exportar a planilha já conferida",
    ],
    naoEAqui: {
      procurando: "a planilha que você manda pro cliente",
      vaEm: "Fechamento com o cliente › Mandar a minha planilha",
      href: "/envios",
    },
  },

  "/envios": {
    oQue:
      "A planilha que você manda pro cliente no fim do período, no formato que ele " +
      "pede, com o registro de quando e por onde foi.",
    faz: [
      "Gerar o arquivo de um período no layout daquele cliente — o que ainda está em conferência ou divergente não entra",
      "Baixar e marcar como enviado, dizendo por onde foi (WhatsApp, e-mail, entregue em mãos)",
      "Achar depois qual arquivo foi mandado, quando e com quantas linhas — quando o cliente disser que não recebeu",
    ],
    naoEAqui: {
      procurando: "conferir a planilha que o cliente mandou pra você",
      vaEm: "Fechamento com o cliente",
      href: "/fechamentos",
    },
  },

  "/tabelas-preco": {
    oQue:
      "Quanto cada cliente paga pelo frete: por tonelada, por quilômetro ou por " +
      "viagem fechada. Sem preço aqui, a viagem não tem valor.",
    faz: [
      "Cadastrar o preço por cliente, material, modo de serviço e faixa de km rodado",
      "Marcar se o pedágio vem por fora do frete",
      "Reajustar sem mexer no que já passou: cada preço vale de uma data até outra, e a viagem usa o preço do dia dela",
      "Escolher o cliente no filtro e refazer o preço de todas as viagens dele depois de corrigir a tabela — valor que alguém alterou à mão não é tocado",
    ],
    naoEAqui: {
      procurando: "o km ou o peso mínimo que se cobra numa viagem curta",
      vaEm: "Preço e mínimo › Mínimo (km e tonelada)",
      href: "/regras-minimo",
    },
  },

  "/regras-minimo": {
    oQue:
      "O piso combinado com o cliente: quando o km (ou o peso) da viagem fica " +
      "abaixo dele, o que se fatura é o mínimo.",
    faz: [
      "Cadastrar o mínimo por cliente, material e faixa de km rodado — o \"de\" entra na faixa, o \"até\" não",
      "Informar km mínimo, toneladas mínimas, ou os dois",
      "Desligar uma regra que não vale mais, sem apagar o histórico",
    ],
    naoEAqui: {
      procurando: "quanto vale o que foi contado",
      vaEm: "Preço e mínimo",
      href: "/tabelas-preco",
    },
  },

  "/cte": {
    oQue:
      "Os CT-e que saíram daqui e o que a SEFAZ respondeu a cada um. A emissão " +
      "em si acontece na tela da viagem.",
    faz: [
      "Ver quais foram autorizados, quais a SEFAZ rejeitou e quais nem chegaram a sair — cada um com o motivo",
      "Abrir um documento e ler o que foi enviado e a resposta crua da SEFAZ",
      "Ir do documento direto pra viagem que o gerou",
      "Abrir o DACTE em PDF pra mandar pro cliente ou pro motorista",
    ],
    naoEAqui: {
      procurando: "emitir ou cancelar o CT-e de uma viagem",
      vaEm: "Viagens",
      href: "/viagens",
    },
  },

  "/financeiro": {
    oQue:
      "O dinheiro que ainda não entrou e o que ainda não saiu — quanto está " +
      "vencido, há quanto tempo e de quem.",
    faz: [
      "Ver o total em aberto, o que já venceu, há quanto tempo o cliente está devendo e quem mais deve",
      "Dar baixa num título, inteira ou em parte — o que faltar continua em aberto",
      "Estornar uma baixa lançada errado, sem apagar o que aconteceu",
      "Lançar uma conta a pagar (oficina, posto, pneu) com vencimento e pra quem é",
    ],
    naoEAqui: {
      procurando: "o que a empresa deve a cada motorista pelas viagens",
      vaEm: "Acertos com motorista",
      href: "/acertos",
    },
  },

  "/configuracoes/cte": {
    oQue:
      "Onde se prepara a emissão do CT-e. O sistema monta, valida e numera o " +
      "documento; quem assina e manda pra SEFAZ é o emissor escolhido aqui.",
    faz: [
      "Escolher por onde o documento sai: simulador, direto na SEFAZ com o seu certificado, ou um provedor que assina por você",
      "Subir o certificado digital A1 e definir a série e se é homologação ou produção — o próximo número o sistema controla sozinho",
      "Preencher o que o contador define: CFOP, natureza da operação e o ICMS",
      "Testar antes de valer, quando a emissão é direto na SEFAZ: ver se o serviço está no ar e emitir um CT-e de teste em homologação, sem gastar número da sua série",
    ],
    naoEAqui: {
      procurando: "corrigir CNPJ, endereço ou inscrição estadual da sua empresa",
      vaEm: "Minha empresa",
      href: "/configuracoes/empresa",
    },
  },

  "/configuracoes/campos-layout": {
    oQue:
      "Como o sistema lê a planilha que o cliente manda: a lista de colunas que a " +
      "leitura automática sabe reconhecer quando alguém sobe o arquivo em Conferir a planilha dele.",
    faz: [
      "Criar uma coluna que os seus clientes usam e o sistema ainda não conhece (ex.: número da NF-e)",
      "Mudar o nome, a descrição e a ordem em que ela aparece na hora de montar a leitura do cliente",
      "Desligar uma coluna que não se usa mais — as de cadeado vêm de fábrica e não podem ser apagadas, e algumas delas são as que o sistema usa pra casar linha com viagem",
    ],
    naoEAqui: {
      procurando: "escolher as colunas da planilha que você manda pro cliente",
      vaEm: "Clientes",
      href: "/empresas",
    },
  },

// ——— FROTA E PESSOAS ———————————————————————————————————————————————

  "/motoristas": {
    oQue:
      "Quem dirige pra você. É por este cadastro que o motorista entra no app — " +
      "sem ele, o painel fica vazio por mais cadastro que você faça.",
    faz: [
      "Convidar pelo WhatsApp e aprovar quem se cadastrou sozinho pelo app",
      "Dizer quais placas são dele e de qual transportadora ele é",
      "Guardar CNH e os outros documentos, e ver na lista quem está vencido ou perto de vencer",
      "Mandar um recado ou o resumo do mês direto pro celular dele",
    ],
    naoEAqui: {
      procurando: "quem é registrado em carteira e bate ponto",
      vaEm: "Quem bate ponto",
      href: "/ponto/funcionarios",
    },
  },

  "/veiculos": {
    oQue:
      "As placas da frota — é o que o motorista escolhe no app na hora de lançar a viagem.",
    faz: [
      "Cadastrar placa e modelo",
      "Dizer de qual transportadora é cada caminhão",
      "Desativar o que parou de rodar, sem apagar o que ele já fez",
    ],
    naoEAqui: {
      procurando: "quando vence o licenciamento ou a próxima revisão",
      vaEm: "Manutenção e vencimentos do caminhão",
      href: "/frota",
    },
  },

  "/frota": {
    oQue:
      "O que some do radar e volta como caminhão parado: revisão vencida, documento " +
      "no fim do prazo, pneu careca e multa esperando a indicação do condutor.",
    faz: [
      "Ver de uma vez só o que já precisa de você, com a placa e quanto falta",
      "Registrar manutenção, o que foi feito e quanto custou em peças e mão de obra, e saber o que está na oficina agora",
      "Ver os pneus por número de fogo e medida do sulco, e quais já passaram do limite",
      "Ver as multas em aberto, o valor e quantos dias faltam pra indicar quem estava dirigindo",
    ],
    naoEAqui: {
      procurando: "a CNH e os documentos do motorista",
      vaEm: "Motoristas",
      href: "/motoristas",
    },
  },

  "/transportadoras": {
    oQue:
      "As frotas donas dos caminhões e dos motoristas — a sua e as que rodam " +
      "pra você, a agregada, a terceira — pra cada caminhão e cada motorista " +
      "terem dono claro.",
    faz: [
      "Cadastrar cada frota com CNPJ e contato",
      "Ver quantos motoristas e quantas placas estão em cada uma",
      "Achar quem ainda ficou sem transportadora definida",
    ],
    naoEAqui: {
      procurando: "os dados da sua própria transportadora",
      vaEm: "Minha empresa",
      href: "/configuracoes/empresa",
    },
  },

  "/documentos-exigidos": {
    oQue:
      "Os documentos que a transportadora pede — do motorista, de quem é registrado " +
      "em carteira, ou porque um cliente exige antes do caminhão entrar na obra. É " +
      "esta lista que o link de coleta mostra pro motorista — lista vazia, link que não pede nada.",
    faz: [
      "Escrever cada exigência com o nome que o cliente usa, não com o nosso",
      "Separar o que vale pra todos os clientes do que só um cliente pede — o que um cliente exige aparece também na página dele",
      "Dizer de quem se pede: de quem é contratado, de todo motorista ou de quem é registrado em carteira",
      "Marcar o que é obrigatório e o que precisa vir assinado",
    ],
    naoEAqui: {
      procurando: "os documentos que já foram entregues",
      vaEm: "Motoristas",
      href: "/motoristas",
    },
  },

  "/pedagios-rodovia": {
    oQue:
      "As praças de pedágio e a tarifa de cada uma, pro sistema saber por quais " +
      "praças a rota passa e quanto aquele trecho custa de pedágio.",
    faz: [
      "Trazer as praças prontas do OpenStreetMap e corrigir o que vier torto",
      "Cadastrar quanto a praça cobra por eixo",
      "Desligar praça que não existe mais, sem apagar",
    ],
    naoEAqui: {
      procurando: "o pedágio que o motorista pagou na estrada e vai ser devolvido",
      vaEm: "Acertos com motorista",
      href: "/acertos",
    },
  },

  "/chat": {
    oQue:
      "O canal de avisos que todo motorista lê no app, e as denúncias quando alguém " +
      "passa do ponto. Conversa de motorista com motorista o painel não abre, de propósito.",
    faz: [
      "Publicar um aviso, que chega como notificação pra quem está com o chat liberado",
      "Mandar uma foto junto e, se quiser, publicá-la também como story, que some em 24 horas",
      "Ler o trecho denunciado, remover a mensagem ou arquivar quando não houve violação",
    ],
    naoEAqui: {
      procurando: "conferir se o aviso chegou no celular",
      vaEm: "Avisos enviados ao app",
      href: "/notificacoes",
    },
  },

  "/notificacoes": {
    oQue:
      "O histórico do que foi mandado pro celular dos motoristas — pra responder " +
      "“ele foi avisado?” com a entrega na tela, não de memória.",
    faz: [
      "Ver o que cada motorista recebeu, e quando a entrega falhou",
      "Filtrar por motorista, por entrega e por lida ou não lida",
      "Abrir a viagem que deu origem ao aviso",
    ],
    naoEAqui: {
      procurando: "escrever um aviso pra todos os motoristas",
      vaEm: "Chat dos motoristas",
      href: "/chat",
    },
  },

  // ——— REGISTRADOS ———————————————————————————————————————————————————

  "/ponto": {
    oQue:
      "Quem bateu ponto hoje e quem não bateu, uma linha por funcionário e os " +
      "horários na ordem em que aconteceram. Não diz “atrasado” nem “faltou”: " +
      "mostra o fato e quem julga é gente.",
    faz: [
      "Escolher o dia e ver as batidas de cada um",
      "Ver onde a batida foi feita, se você tiver permissão pra isso",
      "Abrir o espelho de uma pessoa pelo nome",
    ],
    naoEAqui: {
      procurando: "o motorista parceiro, que recebe por viagem",
      vaEm: "Motoristas",
      href: "/motoristas",
    },
  },

  "/ponto/competencia": {
    oQue:
      "O mês inteiro numa tela, pra responder a única pergunta de quem abre aqui: " +
      "já posso mandar pra folha?",
    faz: [
      "Ver o saldo de horas de cada funcionário no período",
      "Ver o que ainda trava: dia por conferir, correção esperando decisão, gente sem jornada, espelho sem ciência",
      "Fechar a competência, que congela as horas — e reabrir com motivo escrito, se precisar",
    ],
    naoEAqui: {
      procurando: "fechar o mês do cliente pra faturar",
      vaEm: "Fechamento com o cliente",
      href: "/fechamentos",
    },
  },

  "/ponto/correcoes": {
    oQue:
      "Batida esquecida, botão trocado, dia que precisa de uma anotação. Conserta-se " +
      "aqui sem apagar nada: a batida original fica, e a correção entra como linha nova, com autor e motivo.",
    faz: [
      "Decidir o que o funcionário pediu: aprovar ou recusar, dizendo por quê",
      "Lançar você mesmo uma inclusão, uma desconsideração ou uma anotação no dia",
      "Acompanhar o que já foi decidido e o que ainda espera",
    ],
    naoEAqui: {
      procurando: "corrigir o km ou o peso que o motorista lançou",
      vaEm: "Viagens",
      href: "/viagens",
    },
  },

  "/ponto/funcionarios": {
    oQue:
      "O cadastro de quem é registrado em carteira. Motorista parceiro não entra " +
      "aqui — a mesma pessoa não pode estar nas duas situações, e o sistema barra.",
    faz: [
      "Registrar a contratação, com cargo, matrícula e data de admissão",
      "Dizer qual jornada vale pra cada um, e desde quando",
      "Trazer de uma vez, por planilha, quem já está na folha",
      "Registrar o desligamento sem perder o que já foi apurado",
      "Ver quantos documentos a empresa pede de quem é registrado, e ir direto pra essa lista",
    ],
    naoEAqui: {
      procurando: "o motorista parceiro, que recebe por viagem",
      vaEm: "Motoristas",
      href: "/motoristas",
    },
  },

  "/ponto/jornadas": {
    oQue:
      "A carga horária de cada dia. É ela que diz o que era esperado — sem jornada " +
      "não existe previsto, e sem previsto não existe saldo de horas.",
    faz: [
      "Montar a escala: por semana, ou por ciclo de dias pra quem faz turno",
      "Definir entrada, saída e intervalo de cada dia, e o que é folga",
      "Ajustar as tolerâncias que a empresa pratica, por batida e no dia",
    ],
    naoEAqui: {
      procurando: "dizer qual jornada é de qual pessoa",
      vaEm: "Quem bate ponto",
      href: "/ponto/funcionarios",
    },
  },

  "/ponto/configuracoes": {
    oQue:
      "O que faz o ponto desta empresa valer: o acordo coletivo que autoriza registrar " +
      "jornada por aplicativo. Sem declarar isso, as telas de ponto ficam fechadas.",
    faz: [
      "Declarar a convenção ou o acordo coletivo que prevê o registro eletrônico, e qual é",
      "Definir o dia em que o mês fecha e a razão social e o CNPJ que saem no comprovante",
      "Decidir por quanto tempo a localização das batidas fica guardada, e por quanto tempo quem saiu ainda abre o próprio espelho",
      "Ler, antes de prometer internamente, o que este módulo não faz: não é equipamento certificado, não calcula hora extra e não conversa com o eSocial",
    ],
    naoEAqui: {
      procurando: "definir horário de entrada, saída e folga",
      vaEm: "Jornadas e escalas",
      href: "/ponto/jornadas",
    },
  },

  "/empresas": {
    oQue:
      "Quem te contrata e paga o frete — a construtora, a mineradora, o dono da " +
      "carga. Recebe a planilha no fim do mês, tem o preço e o mínimo dele, e é " +
      "dentro dele que ficam as obras.",
    faz: [
      "Cadastrar quem contrata o frete, com CNPJ e quem é o contato lá dentro",
      "Ensinar o sistema a ler a planilha que ele te manda e a montar a planilha que você manda pra ele",
      "Na leitura da planilha dele, dizer quanta diferença de km e de tonelada é aceitável antes de a linha virar divergência",
      "Abrir um cliente pra ver as obras dele, o preço e o mínimo que valem pra ele e os documentos que ele exige",
    ],
    naoEAqui: {
      procurando: "as donas dos caminhões que rodam pra você",
      vaEm: "Transportadoras",
      href: "/transportadoras",
    },
  },

  "/locais": {
    oQue:
      "De onde a carga sai e pra onde ela vai — é a lista que o motorista " +
      "escolhe no app, e é dela que o sistema tira a distância da viagem.",
    faz: [
      "Cadastrar pedreira, usina, obra e pátio com endereço e ponto no mapa; o app baixa a lista pro motorista escolher sem digitar",
      "Conferir os locais que os motoristas criaram na estrada e aprovar os que existem mesmo",
      "Juntar num só o mesmo lugar cadastrado duas vezes, levando as viagens dele junto",
    ],
    naoEAqui: {
      procurando: "mudar a distância que o app aceita pra dizer que o motorista chegou no local",
      vaEm: "Locais › Como o app acha o local",
      href: "/configuracoes/busca-locais",
    },
  },

  "/materiais": {
    oQue:
      "O que o caminhão carrega — e é o que decide se a viagem vai pedir foto " +
      "do ticket de balança ou entrar aprovada sem ninguém conferir.",
    faz: [
      "Cadastrar brita, areia, terra, concreto: é o que o motorista escolhe na hora da carga",
      "Dizer se o material tem número de ticket de balança pra informar — concreto, por exemplo, não tem",
      "Dispensar da conferência o material que não gera papel nenhum, pra a viagem já entrar aprovada",
      "Liberar o bota-fora: quando o motorista volta ao local de carga com a sobra, esse trecho entra no km",
    ],
    naoEAqui: {
      procurando: "o mínimo de tonelada ou de km que se fatura por material",
      vaEm: "Preço e mínimo › Mínimo (km e tonelada)",
      href: "/regras-minimo",
    },
  },

  "/tipos-servico": {
    oQue:
      "O que o lançamento da viagem exige em cada modo de serviço — e é isso " +
      "que muda o que o app pergunta ao motorista.",
    faz: [
      "Escolher o que cada modo exige: material, ticket, local de descarga, km",
      "Ver qual modo vale pras viagens que não escolhem nenhum; com um modo só, o app nem mostra a pergunta",
    ],
    naoEAqui: {
      procurando: "quanto vale a tonelada ou o km",
      vaEm: "Preço e mínimo",
      href: "/tabelas-preco",
    },
  },

  "/modalidades": {
    oQue:
      "Como cada motorista parceiro é pago — percentual do frete, valor por " +
      "viagem, por tonelada ou por km. É a régua que o acerto do mês usa; " +
      "não tem nada a ver com registro em carteira.",
    faz: [
      "Criar os vínculos que você usa (próprio, agregado, terceiro) e dizer quanto cada um recebe",
      "Definir se a empresa devolve o pedágio e o abastecimento que ele pagou do próprio bolso",
      "Escolher que fotos o app pede no abastecimento em cada vínculo: cupom, odômetro, bomba",
    ],
    naoEAqui: {
      procurando: "quem é registrado em carteira e bate ponto",
      vaEm: "Quem bate ponto",
      href: "/ponto/funcionarios",
    },
  },

  "/tipos-evento-viagem": {
    oQue:
      "As paradas e os perrengues do meio da viagem — fila na pedreira, quebra, " +
      "carga recusada — pra a espera ficar registrada em vez de virar discussão depois.",
    faz: [
      "Criar os eventos que o app oferece durante a viagem e a ordem em que aparecem",
      "Escolher o que cada um pede ao motorista: foto, peso, ticket, valor, posição",
      "Marcar o que é ocorrência e o quanto é grave, pra o mais sério subir na fila da torre",
      "Cobrar a espera: evento com hora de início e de fim e valor por hora vira estadia",
    ],
    naoEAqui: {
      procurando: "acompanhar as paradas que estão acontecendo agora",
      vaEm: "Torre de controle",
      href: "/torre",
    },
  },

// ——————————————————————————————————————————————————————————————
  // AJUSTES DA CONTA
  // ——————————————————————————————————————————————————————————————

  "/configuracoes/empresa": {
    oQue:
      "Os dados da sua transportadora: a logo que aparece no painel, o código que " +
      "os motoristas usam pra se cadastrar, o que o app exige de foto e os dados " +
      "que vão no CT-e.",
    faz: [
      "Trocar a logo que aparece no menu do painel",
      "Ver e renovar o código que o motorista digita no app — é por ele que o cadastro chega até você",
      "Exigir (ou não) a foto do ticket e a do cupom de combustível: sem foto, o motorista precisa escrever o motivo e o lançamento entra marcado",
      "Preencher CNPJ, inscrição estadual, RNTRC e endereço, que é de onde sai o emitente do CT-e",
    ],
    naoEAqui: {
      procurando: "o cliente pra quem você presta serviço",
      vaEm: "Clientes",
      href: "/empresas",
    },
  },

  "/configuracoes/contrato": {
    oQue:
      "O que você combinou com a Movatruck: quanto custa, quando vence, e o " +
      "registro de quem aceitou os termos — pra conferir sozinho, sem precisar pedir.",
    faz: [
      "Ver o valor da sua mensalidade, o ciclo e o dia do vencimento",
      "Ver quem aceitou os Termos de Uso e a Política de Privacidade, quando aceitou, e abrir o texto daquela versão",
    ],
    naoEAqui: {
      procurando: "o preço que você cobra dos seus clientes",
      vaEm: "Preço e mínimo",
      href: "/tabelas-preco",
    },
  },

  "/usuarios": {
    oQue:
      "Quem do escritório entra no painel. Cada um entra com um papel, e é o " +
      "papel que decide o que ele enxerga.",
    faz: [
      "Convidar alguém do escritório e escolher o papel dele",
      "Restringir quem só pode ver uma transportadora, em vez de ver tudo",
      "Desligar o acesso de quem saiu, sem apagar nada do que ele já fez",
    ],
    naoEAqui: {
      procurando: "os motoristas que usam o app",
      vaEm: "Motoristas",
      href: "/motoristas",
    },
  },

  "/configuracoes/permissoes": {
    oQue:
      "Os papéis do escritório e o que cada um abre — é aqui que se separa quem " +
      "pode ver dinheiro de quem só confere viagem.",
    faz: [
      "Criar um papel e marcar, item por item, o que ele abre e o que ele deixa editar",
      "Conferir quantas pessoas estão com cada papel antes de mexer nele",
      "Excluir um papel que não se usa mais — quem estiver com ele fica sem nada até receber outro",
    ],
    naoEAqui: {
      procurando: "dar um papel a uma pessoa",
      vaEm: "Usuários",
      href: "/usuarios",
    },
  },

  "/importacao": {
    oQue:
      "Traz pro sistema a base que a empresa já tem em planilha — clientes, " +
      "locais, veículos, motoristas e até o histórico de viagens.",
    faz: [
      "Subir a planilha do jeito que ela está: título, logo e linha em branco no topo não atrapalham",
      "Ver na tela o que entraria antes de gravar, e apontar a coluna certa quando o sistema entender errado",
      "Importar só as linhas certas — as com erro ficam de fora, com o número da linha pra você achar e corrigir",
      "Baixar uma planilha modelo, se você não tem arquivo nenhum pra começar",
    ],
    naoEAqui: {
      procurando: "a planilha que o cliente te manda no fim do mês",
      vaEm: "Fechamento com o cliente",
      href: "/fechamentos",
    },
  },

  // ——————————————————————————————————————————————————————————————
  // COMO O SISTEMA SE COMPORTA
  // ——————————————————————————————————————————————————————————————

  "/configuracoes/tracking": {
    oQue:
      "O quanto o app grava a posição do caminhão durante a viagem — é o que " +
      "decide entre um trajeto bem desenhado e a bateria do motorista durar o dia.",
    faz: [
      "Dizer de quantos em quantos metros (e segundos) o app grava um ponto: mais pontos desenham melhor o caminho e gastam mais bateria",
      "Jogar fora leitura ruim: ponto com erro grande, ou com velocidade que caminhão nenhum faz, não entra no trajeto",
      "Avisar o motorista que ficou viagem aberta depois de tantas horas sem posição nova — o sistema não encerra nada sozinho por aqui",
      "Ligar o lembrete que percebe que o caminhão já está rodando e avisa o motorista de começar a viagem",
    ],
    naoEAqui: {
      procurando: "ver onde os caminhões estão agora",
      vaEm: "Mapa",
      href: "/mapa",
    },
  },

  "/configuracoes/busca-locais": {
    oQue:
      "O quão perto o motorista precisa estar pra o app reconhecer o local de " +
      "descarga: apertado demais ele não acha e cadastra o mesmo local de novo, " +
      "largo demais ele acaba marcando o vizinho.",
    faz: [
      "Ajustar o raio da primeira busca, a apertada — se achar um local só aqui, o app já seleciona sem perguntar",
      "Ajustar o raio da segunda, que só roda quando a primeira não achou nada: o que ela encontra vira sugestão, e o motorista confirma",
      "Regular quantos segundos o app espera por um sinal de GPS bom antes de usar a melhor leitura que conseguiu",
      "Definir de quanto o erro do GPS já conta como sinal fraco — aí o app avisa o motorista e a coordenada fica marcada pra revisão",
    ],
    naoEAqui: {
      procurando: "juntar dois locais que foram cadastrados duas vezes",
      vaEm: "Locais",
      href: "/locais",
    },
  },

  "/configuracoes/km-atipico": {
    oQue:
      "Marca a viagem cujo km fugiu do que a frota costuma rodar naquele mesmo " +
      "trajeto, pra ninguém faturar 130 km onde sempre foram 100.",
    faz: [
      "Regular o quanto o km pode fugir da referência antes de virar aviso",
      "Dizer quantas viagens o trajeto precisa ter pra o histórico valer como referência, e de quantos dias pra trás",
      "Deixar as viagens curtas de fora, onde qualquer diferencinha vira percentual grande e não quer dizer nada",
      "Rodar a avaliação no histórico inteiro de uma vez, em vez de só nas viagens novas",
    ],
    naoEAqui: {
      procurando: "corrigir o km de uma viagem",
      vaEm: "Viagens",
      href: "/viagens",
    },
  },

  "/configuracoes/torre": {
    oQue:
      "Quando uma viagem em curso vira alerta, e quando o alerta merece te " +
      "interromper — 2h parado na fila da pedreira é terça-feira, numa entrega " +
      "urbana é problema.",
    faz: [
      "Dizer quantos minutos sem novidade viram aviso na torre, e quantos viram urgente — só o urgente manda notificação",
      "Escolher a faixa de horário em que pode notificar e se domingo entra: o alerta aparece na torre de qualquer jeito, a janela segura só o aviso",
      "Fechar sozinho a viagem que ficou aberta tempo demais — ela vai pra Viagens incompleta, com as fotos e os eventos, pro conferente terminar",
    ],
    naoEAqui: {
      procurando: "os alertas que estão abertos agora",
      vaEm: "Torre de controle",
      href: "/torre",
    },
  },

  // ——————————————————————————————————————————————————————————————
  // FERRAMENTAS DA MOVATRUCK (equipe interna)
  // ——————————————————————————————————————————————————————————————

  "/whatsapp": {
    oQue:
      "O estado do WhatsApp da plataforma: se o número está pareado, quem está " +
      "vinculado a ele e o que já foi trocado com cada um — sem as credenciais da " +
      "Evolution no servidor, a tela só avisa que falta configurar.",
    faz: [
      "Ver se a sessão está online e, quando cair, reconectar lendo o QR",
      "Escolher o grupo que recebe o aviso automático quando um motorista se cadastra, e testar a régua desse aviso por CPF",
      "Ler mensagem por mensagem o que o número trocou com cada motorista ou usuário",
      "Escolher por onde sai cada tipo de mensagem — Evolution ou Meta — e conferir na Meta os templates que o código declara",
    ],
    naoEAqui: {
      procurando: "qual IA responde as mensagens que chegam",
      vaEm: "Agente WhatsApp",
      href: "/configuracoes/agente-whatsapp",
    },
  },

  "/configuracoes/ia": {
    oQue:
      "Qual modelo lê o ticket e casa a viagem com a planilha do cliente, e o " +
      "quanto ele pode decidir sozinho antes de mandar pra revisão humana (as " +
      "chaves de API ficam no servidor, fora desta tela).",
    faz: [
      "Escolher o modelo do casamento com a planilha e o que lê a foto do ticket, com o custo por chamada à vista",
      "Subir ou baixar a certeza mínima pra fechar sozinho: mais alta, menos erro e mais coisa pra revisar na mão",
      "Ampliar ou apertar a janela de dias em que ele procura a viagem correspondente",
      "Ver, nas últimas sugestões reais, quantas cada escolha teria fechado sozinha",
    ],
    naoEAqui: {
      procurando: "ligar ou desligar a IA de uma empresa específica",
      vaEm: "Assinantes",
      href: "/contas",
    },
  },

  "/configuracoes/agente-whatsapp": {
    oQue:
      "Se a IA responde ou não quem escreve no WhatsApp da plataforma, e com qual " +
      "modelo — é o interruptor que decide se esse número gasta com IA.",
    faz: [
      "Desligar o agente: quem escrever recebe um aviso automático e nada de IA é gasto; o envio de código de cadastro continua normal",
      "Trocar o provedor e o modelo, com o custo estimado de cada um do lado",
      "Conferir se a chave do provedor escolhido existe no servidor — sem ela o agente não responde, e a chave se acrescenta no servidor, não aqui",
    ],
    naoEAqui: {
      procurando: "conectar o número ou ler as conversas",
      vaEm: "WhatsApp",
      href: "/whatsapp",
    },
  },

  "/contas": {
    oQue:
      "As transportadoras que assinam a Movatruck — o que cada uma contratou, o " +
      "que ela paga e o que ela está gastando de IA.",
    faz: [
      "Criar uma empresa nova já pronta pra usar, com o primeiro acesso dela",
      "Acompanhar a assinatura de cada uma: valor, vencimento, quem está em atraso e a régua de cobrança",
      "Ligar e desligar, por empresa, os recursos de IA que cobram por uso — a leitura do ticket no app e a conferência automática",
      "Definir os módulos contratados e o teto de permissões de cada uma, e suspender ou excluir quem sair",
    ],
    naoEAqui: {
      procurando: "os clientes de uma transportadora, que pagam o frete",
      vaEm: "Clientes",
      href: "/empresas",
    },
  },

  "/demandas": {
    oQue:
      "A fila do agente que mexe no código: você escreve o que precisa e ele " +
      "trabalha numa branch própria, sem tocar no que está no ar.",
    faz: [
      "Escrever um pedido de melhoria e acompanhar enquanto o agente trabalha nele",
      "Abrir a demanda pronta pra ler o relato do agente e os arquivos que ele mexeu",
      "Ver se o agente está vivo, quanto tempo ele costuma levar e quanto custou nas últimas 24h",
    ],
    naoEAqui: {
      procurando: "os erros que os usuários estão batendo agora",
      vaEm: "Erros",
      href: "/erros",
    },
  },

  "/prospeccao": {
    oQue:
      "As transportadoras do registro público da ANTT, com uma nota de quanto o " +
      "Movatruck serve pra cada uma. É a lista de quem ligar hoje.",
    faz: [
      "Filtrar por nota, estado e situação, ligar direto da linha e abrir a ficha pra falar no WhatsApp",
      "Ver quem escreveu e ainda não foi respondido — é o único filtro que custa venda agora",
      "Importar a base do RNTRC e rodar o enriquecimento pra achar os telefones que faltam",
      "Marcar quem pediu pra não ser contatado: some de toda lista, em todo canal",
    ],
    naoEAqui: {
      procurando: "quem já virou cliente",
      vaEm: "Assinantes",
      href: "/contas",
    },
  },

  "/marketing": {
    oQue:
      "A fila de posts do @movatruck. É a plataforma divulgando a si mesma, e " +
      "nada vai pro feed antes de alguém olhar e mandar publicar.",
    faz: [
      "Pedir ao agente um post ou um carrossel e receber a arte com a legenda aqui na fila",
      "Subir uma arte já com data, e publicar ou cancelar o que está na fila",
      "Acompanhar o que cada peça rendeu — compartilhamentos, salvamentos e alcance",
      "Ligar e desligar a publicação — parada, ou sem a credencial da Meta no servidor, os posts ficam esperando na fila sem se perder",
    ],
    naoEAqui: {
      procurando: "pedir uma mudança no sistema",
      vaEm: "Pedidos de melhoria",
      href: "/demandas",
    },
  },

  "/erros": {
    oQue:
      "Os erros que estouraram de verdade no app, no painel e no servidor, " +
      "juntados por tipo — pra saber se é um caso isolado ou todo mundo batendo " +
      "no mesmo lugar.",
    faz: [
      "Filtrar o que ainda está pendente e por onde aconteceu: app do motorista, painel ou servidor",
      "Abrir um grupo pra ver quantas vezes aconteceu, com quem, e o rastro do erro",
      "Marcar como resolvido o que já foi corrigido, e reabrir se voltar",
    ],
    naoEAqui: {
      procurando: "lançamento do motorista que não subiu",
      vaEm: "Viagens › Não chegaram",
      href: "/lancamentos-travados",
    },
  },

  "/diagnosticos": {
    oQue:
      "O rastro do que o app do motorista fez em campo, pra descobrir por que a " +
      "rota não calculou, o GPS não pegou ou a viagem demorou a subir.",
    faz: [
      "Filtrar por tipo de acontecimento e separar o que foi registrado sem internet",
      "Abrir um evento pra ver os detalhes crus e pular direto pra viagem dele",
    ],
    naoEAqui: {
      procurando: "o app que travou e fechou",
      vaEm: "Erros",
      href: "/erros",
    },
  },

  "/configuracoes/forca-atualizacao": {
    oQue:
      "Obriga — ou só avisa — o motorista de app velho a atualizar pela loja, pra " +
      "ninguém ficar dando suporte a uma versão que já foi corrigida.",
    faz: [
      "Escolher entre não agir, avisar de um jeito que dá pra dispensar, ou travar o app numa tela de atualização",
      "Definir a versão mínima na mão, em vez de deixar o sistema usar a maior que ele viu circulando",
      "Testar mirando só a sua conta antes de valer pra todos — quem não está na lista nunca é afetado, e celular sem internet nunca é travado",
    ],
    naoEAqui: {
      procurando: "mandar um aviso pros motoristas",
      vaEm: "Avisos enviados ao app",
      href: "/notificacoes",
    },
  },
};

/**
 * A explicação desta rota, se houver.
 *
 * Casamento EXATO — tela de detalhe é outra tela —, mais os apelidos que a
 * própria entrada declarar em `tambemEm`.
 */
export function sobreATela(pathname: string): SobreATela | undefined {
  const direta = SOBRE_AS_TELAS[pathname];
  if (direta) return direta;
  return Object.values(SOBRE_AS_TELAS).find((t) => t.tambemEm?.includes(pathname));
}
