import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Location from "expo-location";
import { Check, MapPin } from "lucide-react-native";
import { useObraDeHoje } from "@/lib/queries";
import { enqueuePresencaObra } from "@/lib/sync";

/**
 * A tela de quem está numa obra: um nome e um botão. Mais nada.
 *
 * ISTO NÃO É UM BANNER NA HOME. Quando há obra hoje, este componente OCUPA a
 * tela — a home normal empilha catorze blocos e um botão a mais ali é um
 * botão invisível. O público deste fluxo tem pouquíssima familiaridade com
 * tecnologia e, muitas vezes, dificuldade de leitura: o contrato é que ele
 * abre o app e o que precisa fazer está debaixo do dedo, sem ler nada.
 *
 * Regras que não podem cair numa refatoração:
 * - UM toque. Sem diálogo de confirmação antes (dobra o toque, e este público
 *   lê diálogo como erro). O desfazer vem depois.
 * - Nenhuma escolha, nenhuma lista, nenhum campo. A obra e o caminhão vêm da
 *   alocação, que só permite uma por vez exatamente pra isso.
 * - Tocar de novo devolve a mesma tela verde. Nunca alerta, nunca duplicata.
 * - Sem GPS e sem rede funciona igual: entra no outbox e sobe depois.
 * - NÃO é ponto. Não existe horário esperado, não existe atraso, não existe
 *   falta. O que se registra é o caminhão presente na obra num dia.
 */

/** Alvo gigante de propósito: dedão grosso, dentro do caminhão, no sol. */
const ALTURA_BOTAO = 260;

export function HomeObra() {
  const { data } = useObraDeHoje();
  const [tocado, setTocado] = useState(false);
  const [desfazerAte, setDesfazerAte] = useState<number | null>(null);

  const registradoHoje = data?.hoje?.registrado === true || tocado;

  // A janela de desfazer fecha sozinha. Dez minutos porque o arrependimento
  // acontece em segundos e o botão não pode ficar na tela o dia inteiro
  // convidando a desmarcar um dia legítimo.
  useEffect(() => {
    if (!desfazerAte) return;
    const t = setTimeout(() => setDesfazerAte(null), 10 * 60 * 1000);
    return () => clearTimeout(t);
  }, [desfazerAte]);

  if (!data?.alocacao || !data.hoje) return null;

  async function marcar() {
    if (!data?.alocacao || !data.hoje) return;
    // Otimista: o verde aparece no toque, não quando a rede responde. É o app
    // inteiro funcionando offline-first — esperar confirmação do servidor
    // deixaria o motorista olhando um spinner no pátio.
    setTocado(true);
    setDesfazerAte(Date.now() + 10 * 60 * 1000);

    // GPS é EVIDÊNCIA, nunca porteiro: se não vier, registra igual. Nada de
    // pedir permissão aqui se ele já negou — obra tem sinal ruim e a falta de
    // coordenada não pode custar o dia dele.
    let coords: { latitude: number; longitude: number; precisao?: number } | undefined;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          precisao: pos.coords.accuracy ?? undefined,
        };
      }
    } catch {
      /* sem GPS o registro vale do mesmo jeito */
    }

    await enqueuePresencaObra({
      alocacaoId: data.alocacao.id,
      data: data.hoje.data,
      ...coords,
    });
  }

  return (
    <View className="flex-1 justify-between px-4 py-6">
      <View>
        <Text className="text-2xl font-bold text-foreground" numberOfLines={1}>
          {data.alocacao.obra}
        </Text>
        <Text className="mt-1 text-lg text-muted-foreground">{data.alocacao.placa}</Text>
      </View>

      {registradoHoje ? (
        <View
          className="items-center justify-center rounded-3xl bg-emerald-600"
          style={{ height: ALTURA_BOTAO }}
        >
          <Check size={96} color="#fff" strokeWidth={3} />
          <Text className="mt-2 text-4xl font-bold text-white">HOJE OK</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cheguei na obra"
          onPress={() => void marcar()}
          className="items-center justify-center rounded-3xl bg-[#DF7234] active:opacity-80"
          style={{ height: ALTURA_BOTAO }}
        >
          <MapPin size={96} color="#fff" strokeWidth={2.5} />
          <Text className="mt-2 text-5xl font-bold text-white">CHEGUEI</Text>
        </Pressable>
      )}

      {/* Os dias em branco. Não se chamam falta e não acusam ninguém: são dias
          que ninguém marcou, e só ele pode dizer se esteve lá. */}
      {data.pendentes.length > 0 ? (
        <View className="rounded-2xl border-2 border-amber-500/40 bg-card p-4">
          <Text className="text-lg font-bold text-foreground">
            {data.pendentes.length === 1
              ? "1 dia sem marcar"
              : `${data.pendentes.length} dias sem marcar`}
          </Text>
          <Text className="mt-1 text-base text-muted-foreground">
            Se você esteve na obra nesses dias, toque pra marcar.
          </Text>
        </View>
      ) : (
        <View />
      )}
    </View>
  );
}
