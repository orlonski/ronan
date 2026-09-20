import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Check, CloudOff, TriangleAlert } from "lucide-react-native";
import { usePendingPonto } from "@/hooks/use-pending-ponto";
import { usePontoHoje } from "@/lib/queries";
import { enqueuePonto } from "@/lib/sync";
import { hojeISO } from "@/lib/datetime";

/**
 * O BLOCO DE PONTO de quem é registrado em carteira.
 *
 * ⚠️ O botão grava UM INSTANTE. Não pergunta se é entrada, se é almoço, se é
 * saída. Três motivos, e os três são o mesmo motivo:
 *
 * - A lei (art. 82, IV da Portaria 671) proíbe alterar o dado registrado pelo
 *   trabalhador. Se o tipo morasse no registro, errar o botão obrigaria a
 *   corrigir o original.
 * - O público. Um alvo só, sem escolha, sem menu.
 * - A regra da casa de nunca pré-selecionar opção pro motorista — o app que
 *   marcou sozinho uma vez acabou acusando um motorista.
 *
 * O que é entrada e o que é saída sai da ordem cronológica, na apuração. A
 * tela mostra a lista do que foi batido e quem interpreta é ele.
 *
 * ⚠️ E NUNCA recusa. Sem sinal, com o cadastro em qualquer estado, fora da
 * escala, de madrugada: grava local e sobe depois. App que impede o registro
 * de jornada vira, numa reclamatória, a prova de que a empresa impediu.
 */

/** Alvo grande: o dedão com luva, no sol, e o gesto é diário. */
const ALTURA_BOTAO = 112;

const COR_OK = "#1DA54F";
const COR_AVISO = "#B4501A";
const COR_ERRO = "#EB1414";

export function BlocoPonto() {
  const router = useRouter();
  const qc = useQueryClient();
  const dia = hojeISO();
  const { data } = usePontoHoje(dia);
  const [batendo, setBatendo] = useState(false);

  const naFila = usePendingPonto();
  const doDia = naFila.filter((i) => i.payload.dia === dia);
  const falhou = doDia.some((i) => i.status === "error");

  if (!data?.funcionario) return null;
  if (data.funcionario.desligado) return null;

  const batidas = [
    ...data.marcacoes.map((m) => ({ hora: horaBR(m.marcadoEm), enviada: true })),
    ...doDia.map((i) => ({ hora: horaBR(i.payload.marcadoEm), enviada: false })),
  ].sort((a, b) => a.hora.localeCompare(b.hora));

  async function bater() {
    setBatendo(true);
    // O instante é AGORA, carimbado aqui. O envio pode acontecer horas depois.
    const marcadoEm = new Date().toISOString();

    // GPS é EVIDÊNCIA, nunca porteiro: lê a permissão que já existe, nunca
    // pede na hora, e sem coordenada registra igual.
    let coords: { latitude: number; longitude: number; precisao?: number } | undefined;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          precisao: pos.coords.accuracy ?? undefined,
        };
      }
    } catch {
      /* sem GPS o registro vale do mesmo jeito */
    }

    await enqueuePonto({ marcadoEm, dia, ...coords });
    void qc.invalidateQueries({ queryKey: ["ponto-hoje"] });
    setBatendo(false);
  }

  return (
    <View className="gap-3 rounded-2xl border-2 border-brand/30 bg-card p-4">
      <View>
        <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
          {data.funcionario.empresa ?? "Meu ponto"}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {data.funcionario.cargo ?? "Registro de ponto"}
        </Text>
      </View>

      {/* O que foi batido hoje, na ordem. Sem rótulo de entrada/saída: a tela
          não decide o que cada batida é. */}
      {batidas.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {batidas.map((b, i) => (
            <View
              key={i}
              className={`rounded-lg border-2 px-3 py-2 ${
                b.enviada ? "border-success/50 bg-success/10" : "border-warning/60 bg-warning/10"
              }`}
            >
              <Text className="text-lg font-bold text-foreground">{b.hora}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Registrar ponto agora"
        disabled={batendo}
        onPress={() => void bater()}
        className="items-center justify-center rounded-2xl bg-brand active:opacity-80"
        style={{ height: ALTURA_BOTAO }}
      >
        <Text className="text-3xl font-bold text-brand-foreground">
          {batendo ? "Registrando…" : "Registrar ponto"}
        </Text>
        <Text className="mt-1 text-base text-brand-foreground/80">
          {batidas.length === 0 ? "primeira batida de hoje" : `${batidas.length + 1}ª batida de hoje`}
        </Text>
      </Pressable>

      {falhou ? (
        <View className="gap-2 rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-3">
          <View className="flex-row items-center gap-2">
            <TriangleAlert size={22} color={COR_ERRO} />
            <Text className="flex-1 text-base font-bold text-destructive">
              Uma batida não chegou no escritório
            </Text>
          </View>
          <Text className="text-sm text-foreground">
            Ela está guardada aqui no celular e não se perde. Veja o que travou.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/pendentes")}
            className="items-center rounded-xl border-2 border-destructive/50 py-2"
          >
            <Text className="text-base font-semibold text-destructive">Resolver agora</Text>
          </Pressable>
        </View>
      ) : doDia.length > 0 ? (
        <View className="flex-row items-center gap-2">
          <CloudOff size={20} color={COR_AVISO} />
          <Text className="flex-1 text-sm text-foreground">
            {doDia.length === 1 ? "1 batida" : `${doDia.length} batidas`} guardada(s) aqui. Chega no
            escritório quando o sinal voltar.
          </Text>
        </View>
      ) : batidas.length > 0 ? (
        <View className="flex-row items-center gap-2">
          <Check size={20} color={COR_OK} strokeWidth={3} />
          <Text className="flex-1 text-sm text-foreground">
            Tudo registrado no escritório.
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/meu-espelho")}
        className="items-center rounded-xl border-2 border-border py-3"
      >
        <Text className="text-base font-semibold text-foreground">Ver meu espelho do mês</Text>
      </Pressable>
    </View>
  );
}

/** "07:12" no relógio de Brasília — não no fuso que o aparelho acha que tem. */
function horaBR(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
