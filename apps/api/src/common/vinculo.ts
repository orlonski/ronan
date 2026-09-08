import { Prisma } from "@prisma/client";
import type { AceiteVinculo, StatusMotorista } from "@prisma/client";

/**
 * Quando um vínculo entre motorista e empresa vale.
 *
 * São TRÊS condições, e cada uma é de um dono diferente:
 *  - `ativo`: a empresa desligou o motorista (ou nunca ligou).
 *  - `status`: a empresa recusou o cadastro. `PENDENTE_APROVACAO` continua
 *    valendo — ele entra e vê a tela "em análise", que é de propósito.
 *  - `aceite`: ELE ainda não respondeu ao convite, ou recusou.
 *
 * Mora aqui num lugar só porque esquecer uma das três em qualquer ponto que
 * emite token é dar acesso indevido: uma empresa que puxou um CPF passaria a
 * enxergar alguém que nunca disse sim. Os pontos que precisam obedecer são
 * `abrirSessao`, `cadastrosDoMotorista`, `trocarEmpresa` e o `JwtStrategy`.
 */
export const VINCULO_VIVO = {
  ativo: true,
  status: { not: "REJEITADO" },
  aceite: "ACEITO",
} satisfies Prisma.MotoristaWhereInput;

/** Convite que a empresa mandou e o motorista ainda não respondeu. */
export const VINCULO_CONVITE_PENDENTE = {
  ativo: true,
  status: { not: "REJEITADO" },
  aceite: "PENDENTE",
} satisfies Prisma.MotoristaWhereInput;

/** A mesma regra do `VINCULO_VIVO`, pra decidir sobre uma linha já carregada. */
export function vinculoVivo(v: {
  ativo: boolean;
  status: StatusMotorista;
  aceite: AceiteVinculo;
}): boolean {
  return v.ativo && v.status !== "REJEITADO" && v.aceite === "ACEITO";
}

/**
 * A empresa está ADICIONANDO alguém, ou CONVIDANDO?
 *
 * É a mesma ação do ponto de vista dela — digitar um CPF —, e por isso não pode
 * depender de qual botão ela usou: "Novo motorista" e "Convidar por CPF"
 * resolvem no mesmo lugar. Quem decide é o outro lado:
 *
 * - A pessoa **usa o app** → é convite. Ela está com o telefone na mão e tem
 *   como dizer sim ou não; colocá-la na equipe sem perguntar seria decidir por
 *   ela.
 * - A pessoa **nunca entrou no app** (ou nem existe ainda) → é cadastro. Não há
 *   ninguém pra responder, e um convite ficaria pendurado pra sempre; ela assume
 *   o cadastro quando baixar o app (a reivindicação, em
 *   `CadastroMotoristaService`).
 *
 * O corte é o mesmo dos dois lados — `ultimoLoginEm` — de propósito: uma regra
 * só, lida do mesmo jeito no cadastro e no convite.
 */
export function nasceComoConvite(identidade: { ultimoLoginEm: Date | null } | null): boolean {
  return identidade?.ultimoLoginEm != null;
}
