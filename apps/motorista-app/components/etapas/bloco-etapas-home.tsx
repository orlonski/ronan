import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, FileText } from "lucide-react-native";
import { useCapacidadeNova } from "@/lib/acessos-app";
import { CAP_ETAPAS } from "@/lib/etapas";
import { limparEtapasVencidas, useFaltandoHome } from "@/lib/etapas-local";
import { useModelosEtapa } from "@/lib/queries";

const ALTURA = 96;

/**
 * "2 documentos pra completar" na home — no molde do `BlocoDocumentos`:
 * mostra um NÚMERO (responde "falta alguma coisa minha?" antes do toque),
 * altura fixa, some quando zera, nunca vermelho. É por aqui que o acerto do
 * frete é achado: a viagem já saiu da tela guiada quando ele vai no escritório
 * da agenciadora.
 */
export function BlocoEtapasHome() {
  const router = useRouter();
  const ligado = useCapacidadeNova(CAP_ETAPAS);
  const { total, nomes } = useFaltandoHome();
  // Deixa os formulários no bolso desde a home: "Começar viagem" sem sinal
  // precisa deles (a função pode ter sido ligada depois do login).
  useModelosEtapa(ligado);

  // Faxina das viagens que já saíram da janela (30 dias, por padrão).
  useEffect(() => {
    if (ligado) void limparEtapasVencidas();
  }, [ligado]);

  if (!ligado || total <= 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${total} ${total === 1 ? "documento" : "documentos"} pra completar. Toque pra ver.`}
      onPress={() => router.push("/documentos-pra-completar")}
      className="mb-3 flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card px-4 active:opacity-80"
      style={{ height: ALTURA }}
    >
      <View className="h-14 w-14 items-center justify-center rounded-full bg-muted">
        <FileText size={28} color="#6b7280" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-end gap-1.5">
          <Text className="text-3xl font-bold leading-none text-foreground">{total}</Text>
          <Text className="pb-0.5 text-lg text-muted-foreground">
            {total === 1 ? "documento pra completar" : "documentos pra completar"}
          </Text>
        </View>
        <Text className="mt-1 text-base text-muted-foreground" numberOfLines={1}>
          {nomes.join(" · ")}
        </Text>
      </View>
      <ChevronRight size={24} color="#9ca3af" />
    </Pressable>
  );
}
