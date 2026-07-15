import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check, RotateCcw } from "lucide-react-native";

/**
 * Pergunta "voltou pro bota-fora?" (limpeza). Aparece só quando o material
 * permite (Material.permiteBotaFora). Na última carga o motorista às vezes volta
 * pro local de carga pra descarregar a sobra — essa perna descarga→carga entra
 * no km faturável. Marcar Sim soma a volta; o total aparece ali mesmo.
 *
 * Default é Não (viagem normal). Amarelo no Sim porque muda o km (semáforo:
 * cuidado). Reusado no fluxo guiado (finalizar) e no "Nova viagem" avulso.
 */

const COR_SIM = "#d97706"; // amber-600 — muda o km, então "cuidado"
const COR_NAO = "#0f172a"; // slate-900 — rotina

function fmt(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

type Props = {
  valor: boolean;
  onMudar: (v: boolean) => void;
  /** Km da ida (carga→descarga), pra montar o total. */
  kmBase: number;
  /** Km da volta (descarga→carga); null enquanto calcula ou sem sinal. */
  kmVolta: number | null;
  /** true = ainda buscando a rota de volta. */
  carregando: boolean;
};

export function PerguntaBotaFora({ valor, onMudar, kmBase, kmVolta, carregando }: Props) {
  function escolher(v: boolean) {
    void Haptics.selectionAsync();
    onMudar(v);
  }

  return (
    <View className="gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
      <View className="flex-row items-center gap-2">
        <RotateCcw size={18} color={COR_SIM} />
        <Text className="flex-1 text-base font-semibold text-foreground">
          Voltou pro bota-fora?
        </Text>
      </View>
      <Text className="-mt-1 text-sm text-muted-foreground">
        Se precisou voltar pro local de carga pra descarregar a sobra (limpeza),
        marque Sim. A volta entra no km.
      </Text>

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => escolher(false)}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border-2 p-3.5 active:opacity-80"
          style={{
            borderColor: !valor ? COR_NAO : "#e2e8f0",
            backgroundColor: !valor ? "#0f172a0d" : "transparent",
          }}
        >
          <Text className="text-base font-bold text-foreground">Não</Text>
          {!valor && <Check size={20} color={COR_NAO} strokeWidth={3} />}
        </Pressable>
        <Pressable
          onPress={() => escolher(true)}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border-2 p-3.5 active:opacity-80"
          style={{
            borderColor: valor ? COR_SIM : "#e2e8f0",
            backgroundColor: valor ? `${COR_SIM}14` : "transparent",
          }}
        >
          <Text className="text-base font-bold text-foreground">Sim, voltei</Text>
          {valor && <Check size={20} color={COR_SIM} strokeWidth={3} />}
        </Pressable>
      </View>

      {valor ? (
        <View className="rounded-lg bg-amber-50 px-3 py-2.5">
          {carregando ? (
            <Text className="text-sm text-amber-800">Calculando a volta…</Text>
          ) : kmVolta != null ? (
            <Text className="text-sm text-amber-900">
              Ida {fmt(kmBase)} + volta {fmt(kmVolta)} ={" "}
              <Text className="font-extrabold">{fmt(kmBase + kmVolta)} km</Text>
            </Text>
          ) : (
            <Text className="text-sm text-amber-800">
              Sem sinal agora — a volta entra no km quando a internet voltar.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
