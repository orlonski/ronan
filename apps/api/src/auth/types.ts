import type { StatusMotorista } from "@prisma/client";
import type { EscopoAdmin } from "../common/escopo/escopo";

export type AuthAdminUser = {
  kind: "ADMIN_USER";
  id: string;
  nome: string;
  email: string;
  /**
   * A empresa (tenant) a que ele pertence. Não precisa ser usado em `where`:
   * quem filtra é a trava, a partir do contexto que o JwtStrategy preencheu.
   * Está aqui pra exibição e pras decisões que dependem da conta.
   */
  contaId: string;
  contaNome: string;
  /**
   * Operador da PLATAFORMA (o dono do sistema), não da empresa. É quem enxerga
   * a tela de contas. Ver `User.plataforma` no schema.
   */
  plataforma: boolean;
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
  /** A empresa dele. O CPF é único DENTRO dela, não no sistema todo. */
  contaId: string;
};

export type AuthUser = AuthAdminUser | AuthMotorista;

export type JwtPayload = {
  sub: string;
  kind: "ADMIN_USER" | "MOTORISTA";
  type: "access" | "refresh";
};
