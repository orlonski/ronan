import { CadernoPessoal } from "@/components/caderno-pessoal";

/**
 * ABA CADERNO: o dinheiro dele por fora, que a empresa não vê.
 *
 * Aba, não botão na home (decisão do dono, 22/09/2026): coisa que se usa todo
 * dia merece lugar próprio, como o Ponto. Quem não tem empresa não vê esta
 * aba: pra ele o Histórico já É o caderno.
 *
 * Em empresa com o módulo "Gasto de viagem" a aba Gastos ocupa este lugar
 * (06/10/2026) e o caderno vai pro Perfil — ver app/caderno-pessoal.tsx.
 */
export default function CadernoScreen() {
  return <CadernoPessoal />;
}
