import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { CheckCircle2, MapPin, Settings } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { usePermite } from "@/lib/acessos-app";
import { JANELA_SUGERIDA, useAplicarPosicaoConfig } from "@/lib/posicao-ativar";
import { usePosicaoConfig } from "@/lib/queries";

type Estado = "convite" | "ativou" | "negou" | "sem-sinal";

/**
 * Convite discreto pra compartilhar a posição, no "Começar viagem".
 *
 * Saiu da home (decisão do dono, 06/10/2026: a home estava poluída) e veio pra
 * cá porque é na hora de sair com carga que faz sentido. A configuração
 * completa continua no Perfil › Compartilhar posição.
 *
 * - Só aparece com a função liberada e enquanto ele NÃO compartilha.
 * - Ignorar não custa nada: não trava o "Confirmar carga".
 * - A permissão do celular só é pedida no toque do botão (nunca em foco).
 * - Ao ativar, o cartão fica verde até ele sair da tela; na próxima, some.
 */
export function ConvitePosicao() {
  const verPosicao = usePermite("app.posicao.compartilhar");
  const cfg = usePosicaoConfig({ enabled: verPosicao });
  const { aplicar, salvando } = useAplicarPosicaoConfig();
  const [estado, setEstado] = useState<Estado>("convite");
  // Tocou no botão: o cartão fica até ele sair da tela. A config vira `true`
  // no servidor ANTES da pergunta do celular — sem isto o cartão sumia no
  // meio da pergunta e, se ele negasse, voltava do nada.
  const [tocou, setTocou] = useState(false);

  if (!verPosicao) return null;
  if (!tocou && cfg.data?.ativada !== false) return null;

  async function ativar() {
    setTocou(true);
    try {
      const r = await aplicar({
        ativada: true,
        horarioInicio: JANELA_SUGERIDA.inicio,
        horarioFim: JANELA_SUGERIDA.fim,
      });
      setEstado(r === "ok" ? "ativou" : "negou");
    } catch {
      setEstado("sem-sinal");
    }
  }

  if (estado === "ativou") {
    return (
      <View className="flex-row items-center gap-3 rounded-xl border-2 border-success bg-success/10 p-3">
        <CheckCircle2 size={22} color="#16a34a" />
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">Posição compartilhada</Text>
          <Text className="text-sm text-muted-foreground">
            Das {JANELA_SUGERIDA.inicio}h às {JANELA_SUGERIDA.fim}h. Pra mudar ou desligar, é no Perfil.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-3 rounded-xl border-2 border-border bg-card p-3">
      <View className="flex-row items-start gap-3">
        <MapPin size={22} color="#13316b" />
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">
            Compartilhar minha posição durante a viagem
          </Text>
          <Text className="text-sm text-muted-foreground">
            {estado === "negou"
              ? "O celular não liberou a localização. Se mudar de ideia, libere nos ajustes do celular."
              : estado === "sem-sinal"
                ? "Sem sinal agora. Tente de novo daqui a pouco."
                : "Ajuda quando o cliente liga perguntando onde tá o material."}
          </Text>
        </View>
      </View>
      {estado === "negou" ? (
        <Button variant="outline" size="sm" onPress={() => void Linking.openSettings()}>
          <Settings size={18} color="#0f172a" />
          <Text className="text-sm font-semibold text-foreground">Abrir ajustes do celular</Text>
        </Button>
      ) : (
        <Button variant="outline" size="sm" loading={salvando} onPress={() => void ativar()}>
          {!salvando && <MapPin size={18} color="#0f172a" />}
          <Text className="text-sm font-semibold text-foreground">Compartilhar posição</Text>
        </Button>
      )}
    </View>
  );
}
