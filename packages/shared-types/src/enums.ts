export const StatusViagem = {
  RASCUNHO_OFFLINE: "RASCUNHO_OFFLINE",
  ENVIADA: "ENVIADA",
  EM_CONFERENCIA: "EM_CONFERENCIA",
  DIVERGENTE: "DIVERGENTE",
  OK: "OK",
} as const;
export type StatusViagem = (typeof StatusViagem)[keyof typeof StatusViagem];

export const TipoLocal = {
  CARGA: "CARGA",
  DESCARGA: "DESCARGA",
  AMBOS: "AMBOS",
} as const;
export type TipoLocal = (typeof TipoLocal)[keyof typeof TipoLocal];

export const PapelEmpresa = {
  RECEBE_PLANILHA: "RECEBE_PLANILHA",
  MANDA_FECHAMENTO: "MANDA_FECHAMENTO",
  AMBOS: "AMBOS",
} as const;
export type PapelEmpresa = (typeof PapelEmpresa)[keyof typeof PapelEmpresa];

export const PerfilUsuario = {
  ADMIN: "ADMIN",
  OPERADOR: "OPERADOR",
} as const;
export type PerfilUsuario = (typeof PerfilUsuario)[keyof typeof PerfilUsuario];

/**
 * Ciclo de aprovação do cadastro do motorista.
 * PENDENTE_APROVACAO: auto-cadastro recém-criado, aguardando admin validar.
 * APROVADO: usa o app normalmente (criados pelo admin nascem aqui).
 * REJEITADO: cadastro recusado — não consegue logar.
 */
export const StatusMotorista = {
  PENDENTE_APROVACAO: "PENDENTE_APROVACAO",
  APROVADO: "APROVADO",
  REJEITADO: "REJEITADO",
} as const;
export type StatusMotorista = (typeof StatusMotorista)[keyof typeof StatusMotorista];
