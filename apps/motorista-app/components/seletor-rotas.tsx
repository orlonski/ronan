import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import polyline from "@mapbox/polyline";
import type { RotaOption } from "@/lib/queries";

/**
 * Seletor de rotas alternativas no mapa. Desenha as 2-3 rotas do OSRM em cores
 * distintas e deixa o motorista TOCAR na estrada que ele pegou — ou num botão
 * grande embaixo (caminho primário pra dedão). Reusa o padrão de dynamic import
 * de react-native-maps de `map-trajeto.tsx` (top-level import quebra o boot do
 * expo-router).
 */

// Paleta fixa por índice — casa a linha do mapa com o botão embaixo.
const CORES = ["#ea580c", "#2563eb", "#16a34a"];
const CINZA = "#94a3b8";

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

export function SeletorRotas({
  rotas,
  selecionadaIdx,
  onSelecionar,
  height = 260,
}: Props) {
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

  // Decodifica a polyline de cada rota (formato Google, precision 5) → coords.
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

  function selecionar(idx: number) {
    void Haptics.selectionAsync();
    onSelecionar(idx);
  }

  // Pontos de início/fim (compartilhados entre rotas) — usa a rota selecionada.
  const coordsSel = rotasCoords[selecionadaIdx] ?? [];
  const inicio = coordsSel[0];
  const fim = coordsSel[coordsSel.length - 1];

  const MapView = mod?.default;
  const Marker = mod?.Marker;
  const Polyline = mod?.Polyline;
  const provider =
    Platform.OS === "android" ? mod?.PROVIDER_GOOGLE : undefined;

  const mapProps: Record<string, unknown> = {
    style: { flex: 1 },
  };
  if (region) mapProps.initialRegion = region;
  if (provider) mapProps.provider = provider;

  const temEscolha = rotas.length > 1;

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold text-foreground">
        {temEscolha ? "Qual estrada você pegou?" : "Trajeto calculado"}
      </Text>

      <View
        className="overflow-hidden rounded-xl bg-muted/40"
        style={{ height }}
      >
        {MapView && region ? (
          <MapView {...mapProps}>
            {/* Desenha as não-selecionadas primeiro (ficam por baixo).
                Sem `tappable`/`onPress`/`zIndex`: no Apple Maps (iOS) essas
                props em Polyline crasham nativo. A escolha é pelos botões. */}
            {rotasCoords.map((coords, idx) =>
              idx === selecionadaIdx || coords.length < 2 ? null : (
                <Polyline
                  key={`bg-${idx}`}
                  coordinates={coords}
                  strokeColor={CINZA}
                  strokeWidth={4}
                />
              ),
            )}
            {/* A selecionada por cima, grossa e colorida. */}
            {coordsSel.length >= 2 && (
              <Polyline
                coordinates={coordsSel}
                strokeColor={corDaRota(selecionadaIdx)}
                strokeWidth={7}
              />
            )}
            {inicio && (
              <Marker
                coordinate={inicio}
                pinColor="green"
                title="Carga"
              />
            )}
            {fim && (
              <Marker coordinate={fim} pinColor="red" title="Descarga" />
            )}
          </MapView>
        ) : null}
      </View>

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
