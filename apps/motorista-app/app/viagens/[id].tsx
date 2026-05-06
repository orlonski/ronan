import { useEffect, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Camera,
  ExternalLink,
  MapPin,
  Route,
  Trash2,
} from "lucide-react-native";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { humanizeApiError } from "@/lib/api";
import { API_URL } from "@/lib/api-url";
import { loadTokens } from "@/lib/auth";
import { useExcluirViagem, useViagemDetalhe } from "@/lib/queries";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  AJUSTADA: "secondary",
};

const STATUS_LABEL: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
};

export default function ViagemDetalheScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detalhe = useViagemDetalhe(id ?? "");
  const excluir = useExcluirViagem();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    void loadTokens().then((t) => setToken(t?.accessToken ?? null));
  }, []);

  function abrirMapa(lat: number, lng: number) {
    void Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}`).catch(() => {
      // Fallback se o Android nao tiver app de mapas
      void Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`);
    });
  }

  function confirmarExcluir() {
    if (!detalhe.data) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Excluir esta viagem?",
      `Apagar viagem ticket ${detalhe.data.ticket}?\nIsso só pode ser feito enquanto a operadora não conferiu.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              await excluir.mutateAsync(detalhe.data!.id);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.back();
            } catch (err) {
              Alert.alert("Não foi possível excluir", humanizeApiError(err));
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Detalhe da viagem" />

      {detalhe.isLoading && (
        <View className="items-center py-12">
          <ActivityIndicator />
        </View>
      )}

      {detalhe.error && (
        <View className="m-4 rounded-lg border border-destructive bg-destructive/10 p-4">
          <Text className="font-semibold text-destructive">
            {humanizeApiError(detalhe.error)}
          </Text>
        </View>
      )}

      {detalhe.data && (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        >
          {/* Header card: obra + status */}
          <Card>
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Obra
                </Text>
                <Text className="mt-0.5 text-xl font-bold text-foreground">
                  {detalhe.data.obra.nome}
                </Text>
                {detalhe.data.obra.empresaCliente && (
                  <View className="mt-1 flex-row items-center gap-1.5">
                    <Building2 size={14} color="#64748b" />
                    <Text className="text-sm text-muted-foreground">
                      {detalhe.data.obra.empresaCliente.nome}
                    </Text>
                  </View>
                )}
              </View>
              <Badge variant={STATUS_VARIANT[detalhe.data.status] ?? "outline"}>
                {STATUS_LABEL[detalhe.data.status] ?? detalhe.data.status}
              </Badge>
            </View>

            <View className="mt-4 flex-row gap-6 border-t-2 border-border pt-3">
              <Info label="Data" value={fmtDataBR(detalhe.data.data)} />
              <Info label="Placa" value={detalhe.data.veiculo.placa} mono />
              <Info label="Material" value={detalhe.data.material.nome} />
            </View>
          </Card>

          {/* Trajeto */}
          <Card>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Trajeto
            </Text>
            <View className="gap-2">
              <View className="flex-row items-start gap-3">
                <ArrowUp size={20} color="#16a34a" />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">
                    {detalhe.data.localCarga.nome}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {detalhe.data.localCarga.logradouro} —{" "}
                    {detalhe.data.localCarga.cidade}/{detalhe.data.localCarga.uf}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-start gap-3">
                <ArrowDown size={20} color="#dc2626" />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">
                    {detalhe.data.localDescarga.nome}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {detalhe.data.localDescarga.logradouro} —{" "}
                    {detalhe.data.localDescarga.cidade}/{detalhe.data.localDescarga.uf}
                  </Text>
                </View>
              </View>
            </View>
          </Card>

          {/* Stats */}
          <Card>
            <View className="flex-row gap-6">
              <Stat label="Toneladas" value={fmtNum(detalhe.data.toneladas, 3)} />
              <Stat label="Km" value={fmtNum(detalhe.data.km, 2)} />
              <Stat label="Ticket" value={detalhe.data.ticket} mono />
            </View>
            {detalhe.data.valorPedagioTotal && (
              <View className="mt-3 border-t-2 border-border pt-3">
                <Stat
                  label="Pedágio"
                  value={`R$ ${fmtNum(detalhe.data.valorPedagioTotal, 2)}`}
                />
              </View>
            )}
            {detalhe.data.observacao && (
              <View className="mt-3 border-t-2 border-border pt-3">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Observação
                </Text>
                <Text className="mt-1 text-base text-foreground">
                  {detalhe.data.observacao}
                </Text>
              </View>
            )}
          </Card>

          {/* Mapa do trajeto (so se foi capturado por GPS) */}
          {detalhe.data.pontos.length >= 2 && (
            <Card>
              <View className="mb-2 flex-row items-center gap-2">
                <Route size={16} color="#0f172a" />
                <Text className="text-base font-bold text-foreground">
                  Trajeto capturado
                </Text>
              </View>
              {detalhe.data.kmReal && (
                <View className="mb-3 flex-row gap-6">
                  <Stat label="km ideal" value={fmtNum(detalhe.data.km, 1)} />
                  <Stat label="km real" value={fmtNum(detalhe.data.kmReal, 1)} />
                  {(() => {
                    const ideal = parseFloat(detalhe.data.km);
                    const real = parseFloat(detalhe.data.kmReal);
                    const dif = real - ideal;
                    if (Math.abs(dif) < 0.5) return null;
                    const sinal = dif > 0 ? "+" : "";
                    return (
                      <Stat
                        label="desvio"
                        value={`${sinal}${dif.toFixed(1)} km`}
                      />
                    );
                  })()}
                </View>
              )}
              <View
                className="overflow-hidden rounded-xl"
                style={{ height: 240 }}
              >
                <MapView
                  provider={PROVIDER_GOOGLE}
                  style={{ flex: 1 }}
                  initialRegion={regionPara(detalhe.data.pontos)}
                  scrollEnabled
                  zoomEnabled
                >
                  <Polyline
                    coordinates={detalhe.data.pontos.map((p) => ({
                      latitude: p.lat,
                      longitude: p.lng,
                    }))}
                    strokeColor="#ea580c"
                    strokeWidth={4}
                  />
                  <Marker
                    coordinate={{
                      latitude: detalhe.data.pontos[0].lat,
                      longitude: detalhe.data.pontos[0].lng,
                    }}
                    pinColor="green"
                    title="Início"
                  />
                  <Marker
                    coordinate={{
                      latitude:
                        detalhe.data.pontos[detalhe.data.pontos.length - 1].lat,
                      longitude:
                        detalhe.data.pontos[detalhe.data.pontos.length - 1].lng,
                    }}
                    pinColor="red"
                    title="Fim"
                  />
                </MapView>
              </View>
            </Card>
          )}

          {/* Foto */}
          {detalhe.data.fotos.length > 0 && token && (
            <Card>
              <View className="mb-2 flex-row items-center gap-2">
                <Camera size={16} color="#0f172a" />
                <Text className="text-base font-bold text-foreground">
                  Foto do ticket
                </Text>
              </View>
              {detalhe.data.fotos.map((f) => (
                <Image
                  key={f.id}
                  source={{
                    uri: `${API_URL}/m/viagens/${detalhe.data!.id}/fotos/${f.id}`,
                    headers: { Authorization: `Bearer ${token}` },
                  }}
                  style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12 }}
                  resizeMode="cover"
                />
              ))}
            </Card>
          )}

          {/* Localização */}
          {detalhe.data.lat != null && detalhe.data.lng != null && (
            <Card>
              <View className="mb-2 flex-row items-center gap-2">
                <MapPin size={16} color="#0f172a" />
                <Text className="text-base font-bold text-foreground">
                  Onde foi lançada
                </Text>
              </View>
              <Text
                className="mb-3 text-sm font-medium text-muted-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {detalhe.data.lat.toFixed(6)}, {detalhe.data.lng.toFixed(6)}
              </Text>
              <Button
                variant="outline"
                onPress={() =>
                  abrirMapa(detalhe.data!.lat as number, detalhe.data!.lng as number)
                }
              >
                <ExternalLink size={18} color="#0f172a" />
                <Text className="text-base font-medium text-foreground">
                  Abrir no Google Maps
                </Text>
              </Button>
            </Card>
          )}

          {/* Excluir (só se ENVIADA) */}
          {detalhe.data.status === "ENVIADA" && (
            <Button
              variant="destructive"
              size="lg"
              className="mt-2"
              onPress={confirmarExcluir}
              loading={excluir.isPending}
            >
              <Trash2 size={20} color="white" />
              <Text className="text-base font-bold text-destructive-foreground">
                Excluir viagem
              </Text>
            </Button>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text
        className="mt-0.5 text-base font-medium text-foreground"
        style={mono ? { fontVariant: ["tabular-nums"] } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

function Stat({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text
        className="text-lg font-bold text-foreground"
        style={mono ? { fontVariant: ["tabular-nums"] } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

function regionPara(pontos: { lat: number; lng: number }[]) {
  const lats = pontos.map((p) => p.lat);
  const lngs = pontos.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latitudeDelta = Math.max(0.02, (maxLat - minLat) * 1.4);
  const longitudeDelta = Math.max(0.02, (maxLng - minLng) * 1.4);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

function fmtDataBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

function fmtNum(v: string, casas: number): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
