import type { StatusMotorista } from "@prisma/client";
import type { EscopoAdmin } from "../common/escopo/escopo";

export type AuthAdminUser = {
  kind: "ADMIN_USER";
  id: string;
  nome: string;
  email: string;
  /**
   * A empresa (tenant) desta requisição — a MESMA que a trava está usando pra
   * filtrar. Normalmente é a empresa do usuário; quando um operador da
   * plataforma está visitando outra, é a visitada.
   *
   * Não precisa ser usado em `where`: quem filtra é a trava, a partir do
   * contexto que o JwtStrategy preencheu. Está aqui pra exibição e pras
   * decisões que dependem da conta — e é por isso que carrega a efetiva, e não
   * a de origem: decidir por uma empresa e ler dados de outra é o pior dos
   * mundos.
   */
  contaId: string;
  contaNome: string;
  /** A empresa DELE, a que não muda. Igual a `contaId` quando não há visita. */
  contaOrigemId: string;
  contaOrigemNome: string;
  /**
   * True = está dentro de uma empresa que não é a dele. A UI precisa dizer isso
   * o tempo todo, em lugar visível: sem esse aviso, uma exclusão feita achando
   * que se está em casa acontece no dado de um cliente.
   */
  assumida: boolean;
  /**
   * Operador da PLATAFORMA (o dono do sistema), não da empresa. É quem enxerga
   * a tela de contas e o único que pode visitar outra. Ver `User.plataforma`.
   */
  plataforma: boolean;
  /**
   * Permissões efetivas (chaves do papel). Vazio = nenhum papel atribuído.
   * Visitando, continuam sendo as do papel na conta de ORIGEM: entrar numa
   * empresa não promove ninguém.
   */
  permissoes: string[];
  /**
   * QUAIS registros ele enxerga. `null` = acesso global. Objeto = restrito às
   * transportadoras vinculadas — e restrito sem vínculo nenhum enxerga NADA,
   * nunca tudo. Ver common/escopo/escopo.ts.
   *
   * Sempre `null` durante uma visita: os vínculos são da conta de origem e não
   * significam nada na empresa visitada.
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

/**
 * A PESSOA, sem empresa nenhuma — quem se cadastrou pelo app e ainda não foi
 * vinculado (ou recusou todos os convites).
 *
 * Não tem `contaId` de propósito: o `JwtStrategy` não define conta pra este
 * tipo, então a trava recusa qualquer leitura de dado de negócio. É o
 * comportamento certo — quem não está em empresa nenhuma não tem dado de
 * empresa nenhuma. Ver docs/identidade-motorista.md.
 */
export type AuthIdentidade = {
  kind: "IDENTIDADE";
  id: string;
  nome: string;
  cpf: string;
};

export type AuthUser = AuthAdminUser | AuthMotorista | AuthIdentidade;

export type JwtPayload = {
  sub: string;
  kind: "ADMIN_USER" | "MOTORISTA" | "IDENTIDADE";
  type: "access" | "refresh";
};
