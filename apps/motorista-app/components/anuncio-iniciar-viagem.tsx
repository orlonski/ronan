import { useEffect, useState } from "react";
import { Modal, Text, View } from "react-native";
import { router } from "expo-router";
import { Check, Route, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/tutorial-state";

const CHAVE = "anuncio.iniciar-viagem.v1";

/**
 * Aviso único (1x) de lançamento do fluxo guiado "Iniciar viagem". Só aparece
 * pra quem tem a flag (podeLifecycle) e depois que o tutorial de coach da home
 * já foi visto (pra não empilhar dois popups em quem acabou de instalar).
 * Modal central simples (não mede elementos) — sem o gotcha de Modal no Android.
 */
export function AnuncioIniciarViagem({ podeLifecycle }: { podeLifecycle: boolean }) {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!podeLifecycle) return;
    void (async () => {
      const jaViu = await hasSeenTutorial(CHAVE);
      const viuHome = await hasSeenTutorial("home.v1");
      if (alive && !jaViu && viuHome) setVisivel(true);
    })();
    return () => {
      alive = false;
    };
  }, [podeLifecycle]);

  function fechar() {
    void markTutorialSeen(CHAVE);
    setVisivel(false);
  }

  function comecar() {
    fechar();
    router.push("/iniciar-viagem");
  }

  return (
    <Modal
      visible={visivel}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={fechar}
    >
      <View className="flex-1 items-center justify-center bg-black/50 p-6">
        <View className="w-full max-w-md rounded-3xl bg-card p-6">
          <View className="mb-4 items-center">
            <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-primary/15">
              <Route size={34} color="#ea580c" strokeWidth={2.5} />
            </View>
            <Text className="text-center text-2xl font-extrabold text-foreground">
              Chegou um jeito mais fácil! 🎉
            </Text>
            <Text className="mt-1 text-center text-base text-muted-foreground">
              Agora tem o <Text className="font-bold text-foreground">Iniciar viagem</Text>
            </Text>
          </View>

          <View className="gap-3">
            {[
              "O app te guia passo a passo",
              "Marca a carga e a descarga na hora certa",
              "Menos chance de errar no lançamento",
            ].map((txt) => (
              <View key={txt} className="flex-row items-center gap-3">
                <View className="h-7 w-7 items-center justify-center rounded-full bg-success/15">
                  <Check size={18} color="#16a34a" strokeWidth={3} />
                </View>
                <Text className="flex-1 text-base font-medium text-foreground">{txt}</Text>
              </View>
            ))}
          </View>

          <Text className="mt-4 text-sm text-muted-foreground">
            O <Text className="font-semibold text-foreground">Nova viagem</Text> continua aí
            por enquanto, mas vai sair em breve.
          </Text>

          <View className="mt-6 gap-2">
            <Button size="lg" onPress={comecar}>
              <Route size={22} color="#fff" />
              <Text className="text-lg font-bold text-primary-foreground">Bora começar</Text>
            </Button>
            <Button variant="ghost" onPress={fechar}>
              <X size={18} color="#0f172a" />
              <Text className="font-semibold text-foreground">Agora não</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
