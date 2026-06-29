import type { StatusMotorista } from "@prisma/client";

export type AuthAdminUser = {
  kind: "ADMIN_USER";
  id: string;
  nome: string;
  email: string;
  /** Permissões efetivas (chaves do papel). Vazio = nenhum papel atribuído. */
  permissoes: string[];
};

export type AuthMotorista = {
  kind: "MOTORISTA";
  id: string;
  nome: string;
  cpf: string;
  status: StatusMotorista;
};

export type AuthUser = AuthAdminUser | AuthMotorista;

export type JwtPayload = {
  sub: string;
  kind: "ADMIN_USER" | "MOTORISTA";
  type: "access" | "refresh";
};
