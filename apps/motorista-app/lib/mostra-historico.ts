import { usePermite } from "./acessos-app";
import { useMe, useViagens } from "./queries";
import { useVisao } from "./visao";

/**
 * O Histórico (aba) e as "viagens recentes" + resumo do mês (Início) valem pra
 * quem TEM o que mostrar ali.
 *
 Duas regras, nesta ordem (decididas com o dono em 23/09/2026):
 *
 * 1. A empresa manda: `app.historico.ver` desligado tira tudo, com ou sem
 *    viagem antiga ("eu que mando no app").
 * 2. Ligado, some sozinho pra quem não pode lançar nada e nunca lançou (o
 *    mecânico que só bate ponto): era uma aba vazia e um "Toque em Lançar
 *    viagem feita" pra um botão que não existe.
 *
 * ⚠️ "Não sei" nunca vira "some" (mesma regra de `lib/acessos-app.ts`): sem o
 * perfil ou sem a lista no aparelho — primeiro boot sem sinal —, mostra como
 * sempre mostrou. Com o acesso ligado, quem tem viagem antiga continua vendo, mesmo sem poder
 * lançar mais nada.
 */
export function useMostraHistorico(): boolean {
  const visao = useVisao();
  const me = useMe();
  // `/m/viagens` é rota de quem tem cadastro de motorista: fora da visão da
  // empresa ela só falharia.
  const viagens = useViagens({ enabled: visao === "empresa" });
  // `usePermite` devolve true quando o servidor ainda não disse nada.
  const permitido = usePermite("app.historico.ver");

  // Só a visão da empresa: o autônomo e o registrado têm regras próprias.
  if (visao !== "empresa") return true;
  if (!permitido) return false;
  const m = me.data;
  if (!m) return true;
  if (
    m.podeLancarViagem ||
    m.podeIniciarViagem ||
    m.podeViagemLifecycle ||
    m.podeLancarPedagio ||
    m.podeLancarAbastecimento
  ) {
    return true;
  }
  if (viagens.data === undefined) return true;
  return viagens.data.length > 0;
}
