import type { ReactNode } from "react";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Receipt, Truck } from "lucide-react-native";
import { AvisoCadernoSoSeu } from "@/components/gastos";
import { HistoricoPessoal } from "@/components/historico-pessoal";

/**
 * MEU CADERNO: o que ele ganha e gasta por conta própria, fora da empresa.
 *
 * Mora em dois lugares com o MESMO código:
 * - a aba "Caderno" (empresa sem o módulo "Gasto de viagem");
 * - a rota `/caderno-pessoal`, aberta pelo Perfil ("Meu caderno pessoal"),
 *   quando a aba Gastos ocupa o lugar dela (empresa com o módulo).
 *
 * Nos dois casos é o mesmo histórico pessoal — nada se perde na troca.
 */
export function CadernoPessoal({
  titulo = "Meu caderno",
  cabecalho,
}: {
  titulo?: string;
  cabecalho?: ReactNode;
}) {
  return (
    <HistoricoPessoal
      titulo={titulo}
      cabecalho={cabecalho}
      acoes={
        <View className="gap-3">
          <AvisoCadernoSoSeu />
          <View className="flex-row gap-3">
            <Anotar
              icone={<Receipt size={22} color="#13316b" strokeWidth={2.5} />}
              titulo="Anotar gasto"
              onPress={() => router.push("/meus-gastos")}
            />
            <Anotar
              icone={<Truck size={22} color="#13316b" strokeWidth={2.5} />}
              titulo="Anotar frete"
              onPress={() => router.push("/novo-frete")}
            />
          </View>
        </View>
      }
    />
  );
}

function Anotar({ icone, titulo, onPress }: { icone: ReactNode; titulo: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary">{icone}</View>
      <Text className="flex-1 text-base font-bold text-foreground">{titulo}</Text>
    </Pressable>
  );
}
