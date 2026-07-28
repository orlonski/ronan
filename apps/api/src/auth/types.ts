import type { StatusMotorista } from "@prisma/client";
import type { EscopoAdmin } from "../common/escopo/escopo";

export type AuthAdminUser = {
  kind: "ADMIN_USER";
  id: string;
  nome: string;
  email: string;
  /** Permissões efetivas (chaves do papel). Vazio = nenhum papel atribuído. */
  permissoes: string[];
  /**
   * QUAIS registros ele enxerga. `null` = acesso global (todo usuário da
   * Schaba). Objeto = restrito às transportadoras vinculadas — e restrito sem
   * vínculo nenhum enxerga NADA, nunca tudo. Ver common/escopo/escopo.ts.
   */
  escopo: EscopoAdmin;
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
