import { memo, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import polyline from "@mapbox/polyline";
import type { RotaOption } from "@/lib/queries";

/**
 * Seletor de rotas alternativas. Desenha as 2-3 rotas do OSRM em cores
 * distintas (combinando com os botões) e a escolha é feita nos botões grandes
 * embaixo do mapa — feito pra dedão de motorista.
 *
 * REGRA: nenhuma opção vem marcada. Quem dirigiu foi ele, e é ele quem aponta
 * qual estrada pegou — o app marcar sozinho já fez o painel afirmar que o
 * motorista "escolheu outra rota" por uma decisão que ele nunca tomou.
 *
 * IMPORTANTE (crash iOS): o mapa fica num componente memoizado (`RotasMapa`)
 * que só depende de `rotas` (estável). Assim ele renderiza UMA vez e não
 * re-renderiza quando o motorista seleciona/edita — o react-native-maps no
 * Apple Maps crasha nativo quando os overlays (Polyline) são re-mutados a cada
 * seleção. As linhas têm cor fixa por rota; nada muda no mapa ao escolher.
 */

// Paleta fixa por índice — casa a linha do mapa com o botão embaixo.
const CORES = ["#ea580c", "#2563eb", "#16a34a"];
const CINZA = "#94a3b8";
// Ref estável do style do mapa — evita churn de props no MapView a cada render.
const MAP_STYLE = { flex: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapMod = any;

type LatLng = { latitude: number; longitude: number };

type Props = {
  rotas: RotaOption[];
  /** -1 = nenhuma escolhida ainda. É assim que a tela abre — sempre. */
  selecionadaIdx: number;
  onSelecionar: (idx: number) => void;
  height?: number;
};

export function corDaRota(idx: number): string {
  return CORES[idx % CORES.length]!;
}

/**
 * Rótulo de uma opção quando há escolha. Só descreve o que a rota É — a do meio
 * fica sem rótulo mesmo, porque não tem nada verdadeiro e útil a dizer sobre ela
 * (e inventar rótulo pra preencher espaço vira ruído ou, pior, conselho).
 */
function rotuloDaRota(idx: number, rapidaIdx: number, curtaIdx: number): string | null {
  const rapida = idx === rapidaIdx;
  const curta = idx === curtaIdx;
  if (rapida && curta) return "Mais rápida e mais curta";
  if (rapida) return "Mais rápida";
  if (curta) return "Mais curta";
  return null;
}

/**
 * Mapa isolado e memoizado. Com `selecionadaIdx = -1` (ninguém escolheu ainda)
 * todas as rotas saem na sua própria cor; depois da escolha, a escolhida fica
 * colorida/grossa e as outras apagam (cinza). Memoizado por
 * `rotas`/`height`/`selecionadaIdx`, então só re-renderiza ao TROCAR de rota —
 * não a cada tecla do km.
 *
 * Segurança iOS: o conjunto de Polylines é FIXO (uma por rota, `key` e
 * `coordinates` estáveis); a seleção muda só `strokeColor`/`strokeWidth`. NÃO
 * adiciona/remove linha nem troca coordenadas (era isso que crashava o Apple
 * Maps). Sem `tappable`/`onPress`/`zIndex`.
 */
export const RotasMapa = memo(function RotasMapa({
  rotas,
  height,
  selecionadaIdx,
}: {
  rotas: RotaOption[];
  height: number;
  selecionadaIdx: number;
}) {
  const [mod, setMod] = useState<MapMod | null>(null);

  useEffect(() => {
    let alive = true;
    void import("react-native-maps").then((m) => {
      if (alive) setMod(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  const rotasCoords = useMemo<LatLng[][]>(
    () =>
      rotas.map((r) => {
        if (!r.geometria) return [];
        try {
          return polyline
            .decode(r.geometria)
            .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
        } catch {
          return [];
        }
      }),
    [rotas],
  );

  const todasCoords = useMemo(() => rotasCoords.flat(), [rotasCoords]);

  const region = useMemo(() => {
    if (todasCoords.length === 0) return null;
    const lats = todasCoords.map((p) => p.latitude);
    const lngs = todasCoords.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.4),
      longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.4),
    };
  }, [todasCoords]);

  // Início/fim compartilhados entre rotas — usa a primeira rota com traçado.
  const principal = rotasCoords.find((c) => c.length >= 2);
  const inicio = principal?.[0];
  const fim = principal?.[principal.length - 1];

  if (!mod || !region) {
    return <View className="rounded-xl bg-muted/40" style={{ height }} />;
  }

  const nenhumaEscolhida = selecionadaIdx < 0;
  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  const provider = Platform.OS === "android" ? mod.PROVIDER_GOOGLE : undefined;

  const mapProps: Record<string, unknown> = {
    style: MAP_STYLE,
    initialRegion: region,
  };
  if (provider) mapProps.provider = provider;

  return (
    <View className="overflow-hidden rounded-xl bg-muted/40" style={{ height }}>
      <MapView {...mapProps}>
        {rotasCoords.map((coords, idx) => {
          if (coords.length < 2) return null;
          const sel = idx === selecionadaIdx;
          // Enquanto o motorista não escolheu, TODAS aparecem na sua cor — é a
          // hora em que ele precisa comparar os caminhos. Apagar as outras só
          // faz sentido depois que ele apontou uma.
          const apagado = !nenhumaEscolhida && !sel;
          return (
            <Polyline
              key={idx}
              coordinates={coords}
              strokeColor={apagado ? CINZA : corDaRota(idx)}
              strokeWidth={sel ? 7 : apagado ? 4 : 5}
            />
          );
        })}
        {inicio && <Marker coordinate={inicio} pinColor="green" title="Carga" />}
        {fim && <Marker coordinate={fim} pinColor="red" title="Descarga" />}
      </MapView>
    </View>
  );
});

export function SeletorRotas({
  rotas,
  selecionadaIdx,
  onSelecionar,
  height = 260,
}: Props) {
  const temEscolha = rotas.length > 1;

  // Rótulo FACTUAL, não conselho. "Sugerida pelo sistema" era pré-seleção
  // disfarçada: empurrava o motorista pra uma opção antes de ele lembrar por
  // onde passou — e como o roteador ordena pela mais RÁPIDA, a sugerida vinha a
  // ser justamente a mais longa. Dizer qual é a mais rápida e qual é a mais
  // curta ajuda ele a reconhecer a estrada dele sem opinar sobre a escolha.
  const rapidaIdx = useMemo(
    () =>
      rotas.reduce(
        (melhor, r, i) =>
          r.duracaoSegundos < rotas[melhor]!.duracaoSegundos ? i : melhor,
        0,
      ),
    [rotas],
  );
  const curtaIdx = useMemo(
    () =>
      rotas.reduce(
        (melhor, r, i) =>
          parseFloat(r.km) < parseFloat(rotas[melhor]!.km) ? i : melhor,
        0,
      ),
    [rotas],
  );

  function selecionar(idx: number) {
    void Haptics.selectionAsync();
    onSelecionar(idx);
  }

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold text-foreground">
        {temEscolha ? "Qual estrada você pegou?" : "Trajeto calculado"}
      </Text>

      <RotasMapa rotas={rotas} height={height} selecionadaIdx={selecionadaIdx} />

      {/* Botões grandes — um por rota, cor-combinando com a linha. */}
      <View className="gap-2">
        {rotas.map((r, idx) => {
          const selecionada = idx === selecionadaIdx;
          const cor = corDaRota(idx);
          const min = Math.round(r.duracaoSegundos / 60);
          return (
            <Pressable
              key={idx}
              onPress={() => selecionar(idx)}
              className="flex-row items-center gap-3 rounded-xl border-2 p-3.5 active:opacity-80"
              style={{
                borderColor: selecionada ? cor : "#e2e8f0",
                backgroundColor: selecionada ? `${cor}12` : "transparent",
              }}
            >
              <View
                className="h-4 w-4 rounded-full"
                style={{ backgroundColor: cor }}
              />
              <View className="flex-1">
                <Text className="text-lg font-bold text-foreground">
                  {r.km} km
                  <Text className="text-base font-normal text-muted-foreground">
                    {"  ·  "}
                    {min} min
                  </Text>
                </Text>
                {!temEscolha ? (
                  <Text className="text-xs font-medium text-muted-foreground">
                    Calculado pelo sistema
                  </Text>
                ) : rotuloDaRota(idx, rapidaIdx, curtaIdx) ? (
                  <Text className="text-xs font-medium text-muted-foreground">
                    {rotuloDaRota(idx, rapidaIdx, curtaIdx)}
                  </Text>
                ) : null}
              </View>
              {selecionada && <Check size={24} color={cor} strokeWidth={3} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
