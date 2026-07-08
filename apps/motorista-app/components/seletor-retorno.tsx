import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check, Pencil } from "lucide-react-native";
import type { RotaOption } from "@/lib/queries";
import { RotasMapa, corDaRota } from "./seletor-rotas";

/**
 * Escolha do trajeto até a descarga quando o roteador detecta retorno em rodovia:
 * "Cheguei direto" (X km) vs "Precisei voltar no retorno" (Y km) vs "Foi outro
 * valor" (o motorista informa o km ali mesmo). NENHUMA opção vem marcada — ele tem
 * que escolher conscientemente (o sistema não empurra pro km maior e não deixa o
 * preguiçoso passar batido). A 3ª opção É o campo de km (sem campo duplicado).
 *
 * Reusa o mapa iOS-safe do seletor de rotas. Opções vêm de /m/rotas/opcoes na
 * ordem [sem_retorno, com_retorno]; só renderiza quando há 2 variantes.
 */

const COR_MANUAL = "#0f172a";

type Props = {
  opcoes: RotaOption[];
  /** Índice da variante selecionada (0/1); -1 = nenhuma. */
  selecionadaIdx: number;
  /** true = "Foi outro valor" escolhido (mostra o campo de km dentro do card). */
  manualAtivo: boolean;
  onSelecionar: (idx: number) => void;
  onManual: () => void;
  /** Mensagem de validação (ex: nada escolhido no salvar). */
  erro?: string | null;
  height?: number;
  /** Campo de km, renderizado dentro da opção "Foi outro valor". */
  children?: ReactNode;
};

export function SeletorRetorno({
  opcoes,
  selecionadaIdx,
  manualAtivo,
  onSelecionar,
  onManual,
  erro,
  height = 200,
  children,
}: Props) {
  if (opcoes.length < 2) return null;

  function selecionarVariante(idx: number) {
    void Haptics.selectionAsync();
    onSelecionar(idx);
  }
  function selecionarManual() {
    void Haptics.selectionAsync();
    onManual();
  }

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold text-foreground">
        Como foi até a descarga?
      </Text>
      <Text className="-mt-1 text-sm text-muted-foreground">
        Toque no que aconteceu. Se não foi nenhum dos dois, informe o km que você rodou.
      </Text>

      <RotasMapa
        rotas={opcoes}
        height={height}
        selecionadaIdx={manualAtivo ? -1 : selecionadaIdx}
      />

      <View className="gap-2">
        {opcoes.map((r, idx) => {
          const sel = !manualAtivo && idx === selecionadaIdx;
          const cor = corDaRota(idx);
          return (
            <Pressable
              key={idx}
              onPress={() => selecionarVariante(idx)}
              className="flex-row items-center gap-3 rounded-xl border-2 p-3.5 active:opacity-80"
              style={{
                borderColor: sel ? cor : "#e2e8f0",
                backgroundColor: sel ? `${cor}12` : "transparent",
              }}
            >
              <View className="h-4 w-4 rounded-full" style={{ backgroundColor: cor }} />
              <Text className="flex-1 text-base font-bold text-foreground">
                {r.retorno ? "Precisei voltar no retorno" : "Cheguei direto"}
              </Text>
              <Text className="text-lg font-extrabold text-foreground">
                {r.km.replace(".", ",")} km
              </Text>
              {sel && <Check size={22} color={cor} strokeWidth={3} />}
            </Pressable>
          );
        })}

        {/* 3ª opção: informar o valor — o próprio campo de km (sem duplicar) */}
        <View
          className="rounded-xl border-2"
          style={{
            borderColor: manualAtivo ? COR_MANUAL : "#e2e8f0",
            backgroundColor: manualAtivo ? "#0f172a0d" : "transparent",
          }}
        >
          <Pressable
            onPress={selecionarManual}
            className="flex-row items-center gap-3 p-3.5 active:opacity-80"
          >
            <Pencil size={18} color={COR_MANUAL} />
            <Text className="flex-1 text-base font-bold text-foreground">
              Foi outro valor
            </Text>
            {manualAtivo && <Check size={22} color={COR_MANUAL} strokeWidth={3} />}
          </Pressable>
          {manualAtivo && (
            <View className="gap-1 px-3.5 pb-3.5">
              <Text className="text-sm font-medium text-muted-foreground">
                Quantos km você rodou?
              </Text>
              {children}
            </View>
          )}
        </View>
      </View>

      {erro ? (
        <Text className="text-sm font-semibold text-destructive">{erro}</Text>
      ) : null}
    </View>
  );
}
