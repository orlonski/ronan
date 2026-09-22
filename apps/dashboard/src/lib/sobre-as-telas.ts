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
};

export const SOBRE_AS_TELAS: Record<string, SobreATela> = {
  "/torre": {
    oQue:
      "Mostra as viagens que saíram do normal agora, pra alguém do escritório " +
      "ligar pro motorista antes de o cliente ligar pra você.",
    faz: [
      "Ver o que o sistema achou estranho: viagem atrasada, caminhão parado tempo demais, sem sinal de GPS, ou viagem que alguém esqueceu aberta",
      "Falar com o motorista direto do alerta, por telefone ou WhatsApp",
      "Registrar o que era (quebra, fila na pedreira, almoço) e dar o assunto por resolvido",
    ],
    naoEAqui: {
      procurando: "ver onde cada caminhão está no mapa",
      vaEm: "Mapa",
      href: "/mapa",
    },
  },

  "/programacao": {
    oQue:
      "É onde o dia seguinte é montado: quem leva o quê, pra onde, e em qual caminhão.",
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
      "Ver a posição dos caminhões que estão com viagem aberta",
      "Ver o caminho que uma viagem fez",
    ],
    naoEAqui: {
      procurando: "ser avisado quando algo sair do normal",
      vaEm: "Torre de controle",
      href: "/torre",
    },
  },

  "/viagens": {
    oQue:
      "Tudo que os motoristas lançaram pelo app: a viagem, o peso, o ticket da " +
      "balança. É daqui que sai o que se cobra do cliente.",
    faz: [
      "Conferir o que o motorista mandou e corrigir o que veio errado",
      "Achar viagem por motorista, cliente, material ou período",
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
      "Fechar o acerto, que é o momento em que ele vira combinado e para de mudar",
    ],
    naoEAqui: {
      procurando: "quem é registrado em carteira",
      vaEm: "Ponto do dia",
      href: "/ponto",
    },
  },
};

/** A explicação desta rota, se houver. Casamento exato: tela de detalhe é outra tela. */
export function sobreATela(pathname: string): SobreATela | undefined {
  return SOBRE_AS_TELAS[pathname];
}
