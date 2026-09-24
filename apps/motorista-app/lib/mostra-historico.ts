import { useMe, useViagens } from "./queries";
import { useVisao } from "./visao";

/**
 * O Histórico (aba) e as "viagens recentes" + resumo do mês (Início) valem pra
 * quem TEM o que mostrar ali.
 *
 * Não são uma capacidade que a empresa liga e desliga, de propósito: o
 * motorista é parceiro, e ver o que ele mesmo lançou é o que ele usa pra
 * conferir o que tem a receber. Mas quem não pode lançar nada e nunca lançou
 * (o mecânico que só bate ponto, o teste com tudo desligado) via uma aba
 * vazia e um "Toque em Lançar viagem feita" pra um botão que não existe
 * (decidido com o dono em 23/09/2026).
 *
 * ⚠️ "Não sei" nunca vira "some" (mesma regra de `lib/acessos-app.ts`): sem o
 * perfil ou sem a lista no aparelho — primeiro boot sem sinal —, mostra como
 * sempre mostrou. Quem tem viagem antiga continua vendo, mesmo sem poder
 * lançar mais nada.
 */
export function useMostraHistorico(): boolean {
  const visao = useVisao();
  const me = useMe();
  // `/m/viagens` é rota de quem tem cadastro de motorista: fora da visão da
  // empresa ela só falharia.
  const viagens = useViagens({ enabled: visao === "empresa" });

  // Só a visão da empresa: o autônomo e o registrado têm regras próprias.
  if (visao !== "empresa") return true;
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
