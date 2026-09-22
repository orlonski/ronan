import { redirect } from "next/navigation";

/**
 * A tela antiga dos perfis (as 13 colunas) virou "Acesso ao app", que fala em
 * capacidades, regras e exceções. O endereço antigo continua levando pra lá.
 */
export default function PerfisAcessoPage() {
  redirect("/acesso-app");
}
