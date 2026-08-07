import { useEffect, useState } from "react";
import { Modal, Text, View } from "react-native";
import { router } from "expo-router";
import { Check, MessageCircle, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { hasSeenTutorial, markTutorialSeen } from "@/lib/tutorial-state";

const CHAVE = "anuncio.chat.v1";

/**
 * Aviso único (1x) de lançamento da aba Conversas.
 *
 * Existe porque o chat não se anuncia sozinho: quem nunca tocar na aba nova
 * simplesmente não descobre que ela existe, e um chat sem ninguém dentro morre
 * na primeira semana. Mesmo padrão do anúncio do "Iniciar viagem" — modal
 * central simples (não mede elemento, então escapa do gotcha de Modal no
 * Android) e só depois do coach da home, pra não empilhar dois popups em quem
 * acabou de instalar.
 */
export function AnuncioChat({
  podeChat,
  podeLifecycle,
}: {
  podeChat: boolean;
  podeLifecycle: boolean;
}) {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!podeChat) return;
    void (async () => {
      const jaViu = await hasSeenTutorial(CHAVE);
      const viuHome = await hasSeenTutorial("home.v1");
      // Não empilha com o anúncio do Iniciar viagem — mas só espera quando ele
      // está mesmo pra aparecer. Sem o `podeLifecycle` aqui, quem não tem
      // aquela flag jamais marca a chave dele como vista e este anúncio nunca
      // apareceria — que é a maioria dos motoristas hoje.
      const outroPendente =
        podeLifecycle && !(await hasSeenTutorial("anuncio.iniciar-viagem.v1"));
      if (alive && !jaViu && viuHome && !outroPendente) setVisivel(true);
    })();
    return () => {
      alive = false;
    };
  }, [podeChat, podeLifecycle]);

  function fechar() {
    void markTutorialSeen(CHAVE);
    setVisivel(false);
  }

  function abrir() {
    fechar();
    router.push("/conversas");
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
              <MessageCircle size={34} color="#ea580c" strokeWidth={2.5} />
            </View>
            <Text className="text-center text-2xl font-extrabold text-foreground">
              Agora dá pra conversar 💬
            </Text>
            <Text className="mt-1 text-center text-base text-muted-foreground">
              Tem uma aba nova aqui embaixo: <Text className="font-bold text-foreground">Conversas</Text>
            </Text>
          </View>

          <View className="gap-3">
            {[
              "Fale direto com os outros motoristas",
              "Escreva sem sinal — envia sozinho depois",
              "Avisos da Schaba chegam por aqui também",
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
            Seu telefone não aparece pra ninguém — só o seu nome. E dá pra
            bloquear quem incomodar.
          </Text>

          <View className="mt-6 gap-2">
            <Button size="lg" onPress={abrir}>
              <MessageCircle size={22} color="#fff" />
              <Text className="text-lg font-bold text-primary-foreground">Ver as conversas</Text>
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
