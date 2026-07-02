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
 * IMPORTANTE (crash iOS): o mapa fica num componente memoizado (`RotasMapa`)
 * que só depende de `rotas` (estável). Assim ele renderiza UMA vez e não
 * re-renderiza quando o motorista seleciona/edita — o react-native-maps no
 * Apple Maps crasha nativo quando os overlays (Polyline) são re-mutados a cada
 * seleção. As linhas têm cor fixa por rota; nada muda no mapa ao escolher.
 */

// Paleta fixa por índice — casa a linha do mapa com o botão embaixo.
const CORES = ["#ea580c", "#2563eb", "#16a34a"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapMod = any;

type LatLng = { latitude: number; longitude: number };

type Props = {
  rotas: RotaOption[];
  selecionadaIdx: number;
  onSelecionar: (idx: number) => void;
  height?: number;
};

function corDaRota(idx: number): string {
  return CORES[idx % CORES.length]!;
}

/**
 * Mapa isolado e memoizado. Só recebe `rotas` (referência estável do
 * react-query) + `height`, então NÃO re-renderiza quando o pai muda estado de
 * seleção/km. Overlays estáticos = sem mutação nativa = sem crash no iOS.
 */
const RotasMapa = memo(function RotasMapa({
  rotas,
  height,
}: {
  rotas: RotaOption[];
  height: number;
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

  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  const provider = Platform.OS === "android" ? mod.PROVIDER_GOOGLE : undefined;

  const mapProps: Record<string, unknown> = {
    style: { flex: 1 },
    initialRegion: region,
  };
  if (provider) mapProps.provider = provider;

  return (
    <View className="overflow-hidden rounded-xl bg-muted/40" style={{ height }}>
      <MapView {...mapProps}>
        {rotasCoords.map((coords, idx) =>
          coords.length < 2 ? null : (
            <Polyline
              key={idx}
              coordinates={coords}
              strokeColor={corDaRota(idx)}
              strokeWidth={5}
            />
          ),
        )}
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

  function selecionar(idx: number) {
    void Haptics.selectionAsync();
    onSelecionar(idx);
  }

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold text-foreground">
        {temEscolha ? "Qual estrada você pegou?" : "Trajeto calculado"}
      </Text>

      <RotasMapa rotas={rotas} height={height} />

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
                ) : r.recomendada ? (
                  <Text className="text-xs font-medium text-muted-foreground">
                    Sugerida pelo sistema
                  </Text>
                ) : (
                  <Text className="text-xs font-medium text-muted-foreground">
                    Outro caminho
                  </Text>
                )}
              </View>
              {selecionada && <Check size={24} color={cor} strokeWidth={3} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
