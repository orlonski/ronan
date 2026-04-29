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
