import type { CapacidadeApp } from "./capacidades-app";

/**
 * O MENU DO APP DO MOTORISTA — o que o binário conhece e o que cada item exige.
 *
 * ⚠️ Dito com todas as letras, porque o dono pediu "nada chumbado": a ORDEM e
 * os RÓTULOS do menu moram aqui (código, mudam por OTA). O que CADA PESSOA VÊ
 * é dado — as capacidades dela — e muda na hora, sem OTA.
 *
 * Hoje serve ao painel ("ver como ele vê") e, na fase seguinte, ao próprio app,
 * que passa a montar abas e atalhos por esta lista em vez de seis fontes
 * diferentes. Sendo a mesma lista nos dois lados, a prévia não tem como mentir.
 */

export type ItemMenuApp = {
  id: string;
  label: string;
  /** Aparece se tiver TODAS. */
  requer?: CapacidadeApp[];
  /** Aparece se tiver ALGUMA. */
  requerAlgum?: CapacidadeApp[];
  /** Aparece pra todo mundo. */
  sempre?: boolean;
  /** Onde fica: aba, atalho da tela inicial ou item do perfil. */
  onde: "aba" | "inicio" | "perfil";
};

export const MENU_APP: readonly ItemMenuApp[] = [
  // Abas, na ordem da barra de baixo.
  { id: "aba.inicio", label: "Início", onde: "aba", sempre: true },
  {
    id: "aba.historico",
    label: "Histórico",
    onde: "aba",
    requerAlgum: ["app.viagem.lancar", "app.viagem.guiada", "app.pedagio.lancar", "app.abastecimento.lancar"],
  },
  { id: "aba.ponto", label: "Ponto", onde: "aba", requer: ["app.ponto.bater"] },
  { id: "aba.conversas", label: "Conversas", onde: "aba", requer: ["app.chat.usar"] },
  { id: "aba.perfil", label: "Perfil", onde: "aba", sempre: true },

  // Tela inicial, de cima pra baixo.
  { id: "inicio.stories", label: "Stories", onde: "inicio", requer: ["app.stories.ver"] },
  { id: "inicio.bater-ponto", label: "Bater ponto", onde: "inicio", requer: ["app.ponto.bater"] },
  { id: "inicio.obra", label: "Presença na obra", onde: "inicio", requer: ["app.obra.presenca"] },
  { id: "inicio.iniciar-viagem", label: "Iniciar viagem (guiada)", onde: "inicio", requer: ["app.viagem.guiada"] },
  { id: "inicio.nova-viagem", label: "Nova viagem", onde: "inicio", requer: ["app.viagem.lancar"] },
  { id: "inicio.gps", label: "Iniciar viagem com GPS", onde: "inicio", requer: ["app.viagem.gpsClassico"] },
  { id: "inicio.pedagio", label: "Pedágio", onde: "inicio", requer: ["app.pedagio.lancar"] },
  { id: "inicio.abastecimento", label: "Abastecimento", onde: "inicio", requer: ["app.abastecimento.lancar"] },
  { id: "inicio.caderno", label: "Meu caderno", onde: "inicio", sempre: true },

  // Perfil.
  { id: "perfil.espelho", label: "Meu espelho de ponto", onde: "perfil", requer: ["app.ponto.espelho"] },
  { id: "perfil.programacao", label: "Minha programação", onde: "perfil", requer: ["app.programacao.ver"] },
  { id: "perfil.acertos", label: "Meus acertos", onde: "perfil", requer: ["app.acertos.ver"] },
  { id: "perfil.documentos", label: "Meus documentos", onde: "perfil", requer: ["app.documentos.enviar"] },
  { id: "perfil.posicao", label: "Compartilhar posição", onde: "perfil", requer: ["app.posicao.compartilhar"] },
  { id: "perfil.senha", label: "Trocar senha", onde: "perfil", sempre: true },
];

/** Os itens que uma pessoa com estas capacidades vê. */
export function menuDoApp(capacidades: Iterable<string>): ItemMenuApp[] {
  const tem = new Set(capacidades);
  return MENU_APP.filter(
    (i) =>
      i.sempre ||
      (i.requer?.every((c) => tem.has(c)) ?? false) ||
      (i.requerAlgum?.some((c) => tem.has(c)) ?? false),
  );
}
