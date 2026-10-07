/**
 * De onde a viagem veio decide quais EFEITOS a criação dispara — e só isso.
 *
 * A regra de negócio é a mesma pra toda origem: status (STATUS_FORA_FECHAMENTO),
 * mínimo e preço, conferência humana, "o km do motorista é lei". O que muda são
 * os efeitos em volta, que fazem sentido pra quem está na estrada e viram
 * estrago pra máquina ou pra planilha:
 *
 *  - planilha de histórico com 800 viagens sem peso mandava 800 WhatsApps do
 *    nosso número e 800 pushes "Nova viagem" pros administradores;
 *  - viagem de dois anos atrás casava com a programação de HOJE;
 *  - o robô de km trocava o km que o sistema da empresa mandou pelo da rota e
 *    avisava o motorista de uma viagem que ele nunca lançou.
 *
 * Tabela declarada, e não `if` espalhado: origem nova (a API de integração)
 * entra escolhendo uma linha aqui, à vista. Ver docs/api-publica/05-qa.md (B2, B4).
 */

export type OrigemViagem = "APP" | "IMPORTACAO" | "INTEGRACAO" | "PAINEL";

export type PoliticaDaOrigem = {
  /** Conferir a foto do ticket por IA (custo da plataforma; só faz sentido com foto). */
  conferirTicketComIa: boolean;
  /** Preço da tabela na hora (senão o robô da madrugada precifica). */
  precificar: boolean;
  /** Carimbo de km fora do padrão do trajeto. */
  avaliarKmAtipico: boolean;
  /** Recalcular o km pela rota e avisar o motorista se mudar (viagem lançada sem sinal). */
  reprocessarKm: boolean;
  /** Casar com a programação do painel: sempre, só viagem recente (até ontem) ou nunca. */
  casarProgramacao: "sempre" | "so-recentes" | "nunca";
  /** Push pros administradores: um por viagem, um resumo, ou nenhum. */
  avisarAdministradores: "cada-viagem" | "resumo" | "nunca";
  /** Push + WhatsApp pro motorista (ex.: "complete o peso"). Só quem usa o app. */
  avisarMotorista: boolean;
  /** Calcular a rota do par carga→descarga já (mapa e pedágios na rota). */
  calcularRota: boolean;
};

export const POLITICA_DA_ORIGEM: Record<OrigemViagem, PoliticaDaOrigem> = {
  // O motorista lançou agora, na estrada: tudo o que sempre aconteceu.
  APP: {
    conferirTicketComIa: true,
    precificar: true,
    avaliarKmAtipico: true,
    reprocessarKm: true,
    casarProgramacao: "sempre",
    avisarAdministradores: "cada-viagem",
    avisarMotorista: true,
    calcularRota: true,
  },
  // Histórico trazido pelo escritório: preço sim, e mais nada que fale com gente.
  IMPORTACAO: {
    conferirTicketComIa: false,
    precificar: true,
    avaliarKmAtipico: false,
    reprocessarKm: true, // o robô já respeita o km da planilha e não avisa ninguém (clientId "import:")
    casarProgramacao: "nunca",
    avisarAdministradores: "nunca",
    avisarMotorista: false,
    calcularRota: false,
  },
  // O sistema da empresa mandou (API pública, Onda 1): o km dele não é refeito
  // pela rota, o motorista não é avisado de viagem que não lançou, e o
  // administrador recebe um resumo, não uma enxurrada.
  INTEGRACAO: {
    conferirTicketComIa: true,
    precificar: true,
    avaliarKmAtipico: false,
    reprocessarKm: false,
    casarProgramacao: "so-recentes",
    avisarAdministradores: "resumo",
    avisarMotorista: false,
    calcularRota: true,
  },
  // Criada por alguém do escritório no painel: quem criou já está olhando.
  PAINEL: {
    conferirTicketComIa: false,
    precificar: true,
    avaliarKmAtipico: true,
    reprocessarKm: true,
    casarProgramacao: "nunca",
    avisarAdministradores: "nunca",
    avisarMotorista: false,
    calcularRota: true,
  },
};

/** "Recente" pra casar com programação: de ontem pra cá (dia civil de São Paulo, AAAA-MM-DD). */
export function ehRecenteParaProgramacao(dataYmd: string, hojeYmd: string): boolean {
  const ontem = new Date(`${hojeYmd}T00:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  return dataYmd >= ontem.toISOString().slice(0, 10);
}
