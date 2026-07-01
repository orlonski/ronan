import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WifiOff } from "lucide-react-native";
import { useConnectivity } from "@/lib/connectivity";

/**
 * Tarja âmbar fina no topo, visível SÓ quando o celular está sem internet.
 * Monte uma vez em _layout.tsx (junto do TutorialHost/AlertHost). É apenas
 * sinalização — o cadastro segue funcionando offline (local-first) e sincroniza
 * sozinho quando o sinal volta; por isso o texto tranquiliza em vez de alarmar.
 *
 * View absoluta na MESMA janela (sem <Modal>) pra não brigar com o edge-to-edge
 * do Android (SDK54); respeita o notch via insets.top. `pointerEvents="none"`
 * pra nunca bloquear toques no conteúdo por baixo.
 */
export function ConnectivityBanner() {
  const online = useConnectivity();
  const insets = useSafeAreaInsets();

  if (online) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: insets.top,
        zIndex: 40,
        elevation: 40,
      }}
      className="bg-warning"
    >
      <View className="flex-row items-center gap-2 px-4 py-2">
        <WifiOff size={16} color="#0f172a" />
        <Text className="flex-1 text-sm font-semibold text-warning-foreground">
          Sem internet agora — pode cadastrar normal, envia sozinho quando o sinal voltar
        </Text>
      </View>
    </View>
  );
}
