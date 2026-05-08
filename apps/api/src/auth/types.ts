import type { PerfilUsuario } from "@prisma/client";

export type AuthAdminUser = {
  kind: "ADMIN_USER";
  id: string;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
};

export type AuthMotorista = {
  kind: "MOTORISTA";
  id: string;
  nome: string;
  cpf: string;
};

export type AuthUser = AuthAdminUser | AuthMotorista;

export type JwtPayload = {
  sub: string;
  kind: "ADMIN_USER" | "MOTORISTA";
  type: "access" | "refresh";
};
