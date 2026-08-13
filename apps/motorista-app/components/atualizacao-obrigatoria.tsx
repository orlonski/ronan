import { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowUpCircle } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { getVersaoApp } from "@/lib/versao-app-state";
import { tentarInAppUpdateImediato } from "@/lib/in-app-update";
import { MovatruckLogo } from "./movatruck-logo";

/**
 * Tela que cobre o app inteiro quando esta versão ficou abaixo do piso exigido
 * (decisão do backend em /m/versao-app). Bloqueio "duro": o motorista precisa
 * atualizar pra continuar. No Android tenta o fluxo IMMEDIATE do Google (instala
 * no próprio app, 1 toque); se não rolar (iOS, build sem o módulo, sideload),
 * abre a loja. Some sozinha quando o app volta atualizado (a checagem vira
 * "nenhuma"). Offline nunca chega aqui — a checagem é fail-open.
 */
export function AtualizacaoObrigatoria() {
  const [tentando, setTentando] = useState(false);
  const { storeUrl, storeUrlWeb } = getVersaoApp();

  async function abrirLoja() {
    for (const url of [storeUrl, storeUrlWeb]) {
      if (!url) continue;
      try {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          return;
        }
      } catch {
        /* tenta o próximo */
      }
    }
    // Último recurso: força o web mesmo sem canOpenURL responder.
    if (storeUrlWeb) await Linking.openURL(storeUrlWeb).catch(() => {});
  }

  async function atualizar() {
    setTentando(true);
    try {
      // Android: fluxo nativo do Google (baixa+instala dentro do app). Se
      // indisponível, cai pra abrir a loja.
      const iniciou = await tentarInAppUpdateImediato();
      if (!iniciou) await abrirLoja();
    } finally {
      setTentando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="bg-brand px-6 pb-10 pt-20">
          <MovatruckLogo />
          <Text className="mt-2 text-base font-medium text-white/80">
            Aplicativo do motorista
          </Text>
        </View>

        <View className="flex-1 gap-6 px-6 py-10">
          <View className="gap-3">
            <Text className="text-2xl font-bold text-foreground">
              Atualização necessária
            </Text>
            <Text className="text-base leading-6 text-muted-foreground">
              Saiu uma versão nova do app com melhorias importantes. Pra continuar
              lançando suas viagens sem problema, é preciso atualizar agora.
            </Text>
            <Text className="text-base leading-6 text-muted-foreground">
              É rápido: toque no botão abaixo e a atualização acontece na hora.
            </Text>
          </View>

          <Button
            size="lg"
            variant="success"
            loading={tentando}
            onPress={atualizar}
          >
            <ArrowUpCircle size={22} color="#fff" />
            <Text className="text-lg font-bold text-success-foreground">
              {tentando ? "Atualizando..." : "Atualizar agora"}
            </Text>
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
