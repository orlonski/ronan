/**
 * Assuntos do resumo diário do WhatsApp. É PREFERÊNCIA POR USUÁRIO (cada um
 * escolhe o que recebe), não uma permissão de papel. Guardado em
 * `User.resumoAssuntos` (string[] de ids). O resumo.service mapeia cada bloco
 * da mensagem pra um destes ids.
 */
export type AssuntoResumo = { id: string; titulo: string };

export const ASSUNTOS_RESUMO: AssuntoResumo[] = [
  { id: "motoristas", titulo: "Motoristas" },
  { id: "locais", titulo: "Locais ativos" },
  { id: "viagens", titulo: "Viagens" },
  { id: "producao", titulo: "Produção" },
  { id: "abastecimentos", titulo: "Abastecimentos" },
  { id: "custos", titulo: "Custos" },
  { id: "pendencias", titulo: "Pendências" },
  { id: "conferencia", titulo: "Conferência" },
  { id: "saude", titulo: "Saúde" },
  { id: "ranking", titulo: "Top 5 do mês" },
  { id: "motoristas_hoje", titulo: "Viagens por motorista (hoje)" },
  { id: "materiais_hoje", titulo: "Materiais (hoje)" },
];

/** Todos os ids — default pra quem ainda não personalizou (recebe tudo). */
export const ASSUNTOS_RESUMO_IDS: string[] = ASSUNTOS_RESUMO.map((a) => a.id);
