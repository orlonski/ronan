// Monta os passos do tutorial de primeiro uso da Home, filtrando pelos
// botões que o motorista realmente vê (permissões do /m/me). Os ids de alvo
// batem com os <CoachTarget id="..."> da tela.

import {
  startTutorial,
  startTutorialIfUnseen,
  type TutorialStep,
} from "./tutorial-state";

export const HOME_TUTORIAL_KEY = "home.v1";

// só os campos que usamos — aceita o Me completo por tipagem estrutural
type TutorialMe = {
  nome: string;
  podeLancarViagem: boolean;
  podeIniciarViagem: boolean;
  podeLancarPedagio: boolean;
  podeLancarAbastecimento: boolean;
};

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

function buildSteps(me: TutorialMe): TutorialStep[] {
  const steps: TutorialStep[] = [
    {
      id: "boas-vindas",
      title: `Bem-vindo, ${primeiroNome(me.nome)}!`,
      body: "Deixa eu te mostrar rapidinho onde fica cada coisa. Leva menos de um minuto.",
    },
  ];

  if (me.podeLancarViagem) {
    steps.push({
      id: "nova-viagem",
      targetId: "coach-nova-viagem",
      title: "Lançar uma viagem",
      body: "Toque aqui pra registrar carga, descarga e a foto do ticket. Funciona até sem internet — depois sincroniza sozinho.",
    });
  }
  if (me.podeIniciarViagem) {
    steps.push({
      id: "iniciar-viagem",
      targetId: "coach-iniciar-viagem",
      title: "GPS do trajeto",
      body: "Antes de pegar a estrada, ligue o GPS por aqui. Ele acompanha o trajeto e calcula o KM real sozinho.",
    });
  }
  if (me.podeLancarPedagio) {
    steps.push({
      id: "pedagio",
      targetId: "coach-pedagio",
      title: "Pedágio",
      body: "Passou numa praça de pedágio? Registre a passagem aqui, é rapidinho.",
    });
  }
  if (me.podeLancarAbastecimento) {
    steps.push({
      id: "abastecimento",
      targetId: "coach-abastecimento",
      title: "Abastecimento",
      body: "Abasteceu? Lance o combustível e o odômetro por aqui.",
    });
  }

  steps.push({
    id: "sino",
    targetId: "coach-sino",
    shape: "circle",
    title: "Avisos do escritório",
    body: "Quando o escritório precisar falar com você, o aviso chega aqui no sininho.",
  });

  steps.push({
    id: "fim",
    title: "Pronto, é só isso!",
    body: "Pode lançar tudo mesmo offline que sincroniza quando o sinal voltar. Quiser rever este passo a passo depois, é só ir no Perfil.",
  });

  return steps;
}

/** Dispara no primeiro uso (se ainda não viu). */
export function startHomeTutorialIfNeeded(me: TutorialMe): void {
  void startTutorialIfUnseen(HOME_TUTORIAL_KEY, buildSteps(me));
}

/** Força o replay (botão "Rever tutorial" no Perfil). */
export function replayHomeTutorial(me: TutorialMe): void {
  startTutorial(HOME_TUTORIAL_KEY, buildSteps(me));
}
