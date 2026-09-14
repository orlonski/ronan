import { redirect } from "next/navigation";

/**
 * Hub dos relatórios.
 *
 * O item do menu apontava direto pra `/relatorios/viagens`, uma das quatro
 * abas — então em Consumo, Abastecimentos e Conferência o menu lateral ficava
 * sem NADA aceso: o usuário estava numa tela válida e o sistema fingia que ele
 * não estava em lugar nenhum. Agora o menu aponta pra cá (e acende em
 * `/relatorios/*`), e quem chega aqui cai na primeira aba.
 */
export default function RelatoriosPage() {
  redirect("/relatorios/viagens");
}
