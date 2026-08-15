import { useEffect, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Camera,
  ExternalLink,
  MapPin,
  RefreshCw,
  RotateCcw,
  Route,
  Scale,
  Trash2,
} from "lucide-react-native";
import { MapTrajeto } from "@/components/map-trajeto";
import { MapaCargaDescarga } from "@/components/mapa-carga-descarga";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { usePendingFotosViagem } from "@/hooks/use-pending-fotos-viagem";
import { showAlert, showConfirm } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { API_URL } from "@/lib/api-url";
import { loadTokens } from "@/lib/auth";
import { fmtDataBR, fmtPeriodoBR } from "@/lib/datetime";
import { formatarDuracao } from "@ronan/shared-types";
import {
  useExcluirViagem,
  useInformarValorPedagio,
  usePedagiosNaRota,
  useResponderFotoDivergente,
  useResponderKmDivergente,
  useViagemDetalhe,
} from "@/lib/queries";
import { enqueueFoto } from "@/lib/sync";
import { ConversaViagem } from "@/components/conversa-viagem";

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
  const pedagiosNaRota = usePedagiosNaRota(
    detalhe.data?.localCarga.id,
    detalhe.data?.localDescarga?.id,
  );
  const excluir = useExcluirViagem();
  const informarPedagio = useInformarValorPedagio();
  const responderFoto = useResponderFotoDivergente();
  const responderKm = useResponderKmDivergente();
  const [valorPedagioStr, setValorPedagioStr] = useState("");
  const [novaFotoDivergente, setNovaFotoDivergente] =
    useState<CapturedPhoto | null>(null);
  const [kmDivergenteStr, setKmDivergenteStr] = useState("");
  const [justificativaKmStr, setJustificativaKmStr] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const pendingFotos = usePendingFotosViagem(detalhe.data?.id);

  useEffect(() => {
    void loadTokens().then((t) => setToken(t?.accessToken ?? null));
  }, []);

  // Pré-preenche o km da divergência com o valor atual, uma vez.
  const kmAtualDivergente =
    detalhe.data?.tipoDivergencia === "KM_DIVERGENTE" ? detalhe.data.km : null;
  useEffect(() => {
    if (kmAtualDivergente != null && kmDivergenteStr === "") {
      setKmDivergenteStr(String(kmAtualDivergente).replace(".", ","));
    }
  }, [kmAtualDivergente, kmDivergenteStr]);

  async function onFotoCapturada(foto: CapturedPhoto | null) {
    // Motorista cancelou (descartou no PhotoCapture). Ignora.
    if (!foto || !detalhe.data) return;
    try {
      // Enfileira direto no outbox — feedback visual vem via usePendingFotosViagem
      // (foto aparece na lista imediatamente com badge "enviando").
      await enqueueFoto({
        viagemId: detalhe.data.id,
        fotoUri: foto.uri,
        fotoMime: foto.mime,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void showAlert({
        title: "Erro ao anexar foto",
        message: humanizeApiError(err),
        variant: "destructive",
      });
    }
  }

  function abrirMapa(lat: number, lng: number) {
    void Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}`).catch(() => {
      // Fallback se o Android nao tiver app de mapas
      void Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`);
    });
  }

  async function confirmarExcluir() {
    if (!detalhe.data) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await showConfirm({
      title: "Excluir esta viagem?",
      message: `Apagar viagem ticket ${detalhe.data.ticket}? Isso só pode ser feito enquanto a operadora não conferiu.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await excluir.mutateAsync(detalhe.data!.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      void showAlert({
        title: "Não foi possível excluir",
        message: humanizeApiError(err),
        variant: "destructive",
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
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
          {/* Header card: cliente + status */}
          <Card>
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cliente
                </Text>
                <Text className="mt-0.5 text-xl font-bold text-foreground">
                  {detalhe.data.cliente.nome}
                </Text>
                {detalhe.data.cliente.empresa && (
                  <View className="mt-1 flex-row items-center gap-1.5">
                    <Building2 size={14} color="#64748b" />
                    <Text className="text-sm text-muted-foreground">
                      {detalhe.data.cliente.empresa.nome}
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
              {detalhe.data.material ? (
                <Info label="Material" value={detalhe.data.material.nome} />
              ) : null}
            </View>
          </Card>

          {/* Card de divergência — motivo do admin pra motorista saber o que ajustar.
              Quando tipo=PEDAGIO_SEM_VALOR, vira fluxo dedicado: input do valor +
              botão "Informar valor" em vez de exigir edição completa da viagem. */}
          {detalhe.data.status === "DIVERGENTE" &&
            detalhe.data.tipoDivergencia === "PEDAGIO_SEM_VALOR" && (
              <Card className="border-2 border-orange-500 bg-orange-50">
                <View className="flex-row items-start gap-3">
                  <AlertTriangle size={20} color="#ea580c" />
                  <View className="flex-1">
                    <Text className="text-base font-bold text-orange-900">
                      Falta informar o valor do pedágio
                    </Text>
                    <View className="mt-3 flex-row items-center gap-2">
                      <Text className="text-sm text-foreground">R$</Text>
                      <TextInput
                        value={valorPedagioStr}
                        onChangeText={setValorPedagioStr}
                        keyboardType="decimal-pad"
                        placeholder="0,00"
                        className="h-11 flex-1 rounded-md border border-input bg-white px-3 text-base text-foreground"
                      />
                    </View>
                    <Button
                      className="mt-3"
                      loading={informarPedagio.isPending}
                      disabled={!valorPedagioStr.trim()}
                      onPress={async () => {
                        const v = parseFloat(valorPedagioStr.replace(",", "."));
                        if (isNaN(v) || v <= 0) {
                          void showAlert({
                            title: "Valor inválido",
                            message: "Informe um valor maior que zero.",
                          });
                          return;
                        }
                        try {
                          await informarPedagio.mutateAsync({
                            viagemId: detalhe.data!.id,
                            valor: v,
                          });
                          setValorPedagioStr("");
                          void showAlert({
                            title: "Obrigado!",
                            message: "Valor informado — viagem foi marcada como ajustada.",
                          });
                        } catch (err) {
                          void showAlert({
                            title: "Erro",
                            message: humanizeApiError(err),
                          });
                        }
                      }}
                    >
                      Informar valor
                    </Button>
                  </View>
                </View>
              </Card>
            )}

          {detalhe.data.status === "DIVERGENTE" &&
            detalhe.data.tipoDivergencia === "FOTO_ILEGIVEL" && (
              <Card className="border-2 border-orange-500 bg-orange-50">
                <View className="flex-row items-start gap-3">
                  <AlertTriangle size={20} color="#ea580c" />
                  <View className="flex-1">
                    <Text className="text-base font-bold text-orange-900">
                      Foto do ticket precisa ser refeita
                    </Text>
                    <View className="mt-3">
                      <PhotoCapture
                        value={novaFotoDivergente}
                        onChange={setNovaFotoDivergente}
                      />
                    </View>
                    <Button
                      className="mt-3"
                      loading={responderFoto.isPending}
                      disabled={!novaFotoDivergente}
                      onPress={async () => {
                        if (!novaFotoDivergente) return;
                        try {
                          await responderFoto.mutateAsync({
                            viagemId: detalhe.data!.id,
                            fotoUri: novaFotoDivergente.uri,
                            fotoMime: novaFotoDivergente.mime,
                          });
                          setNovaFotoDivergente(null);
                          void showAlert({
                            title: "Obrigado!",
                            message:
                              "Foto enviada — viagem foi marcada como ajustada.",
                          });
                        } catch (err) {
                          void showAlert({
                            title: "Erro",
                            message: humanizeApiError(err),
                          });
                        }
                      }}
                    >
                      Enviar foto nova
                    </Button>
                  </View>
                </View>
              </Card>
            )}

          {detalhe.data.status === "DIVERGENTE" &&
            detalhe.data.tipoDivergencia === "KM_DIVERGENTE" && (
              <Card className="border-2 border-orange-500 bg-orange-50">
                <View className="flex-row items-start gap-3">
                  <AlertTriangle size={20} color="#ea580c" />
                  <View className="flex-1">
                    <Text className="text-base font-bold text-orange-900">
                      Confira o km da viagem
                    </Text>
                    <Text className="mt-3 text-sm font-medium text-foreground">
                      Km rodados
                    </Text>
                    <TextInput
                      value={kmDivergenteStr}
                      onChangeText={setKmDivergenteStr}
                      keyboardType="decimal-pad"
                      placeholder="0,00"
                      className="mt-1 h-11 rounded-md border border-input bg-white px-3 text-base text-foreground"
                    />
                    <Text className="mt-3 text-sm font-medium text-foreground">
                      Por que esse km? (obrigatório)
                    </Text>
                    <TextInput
                      value={justificativaKmStr}
                      onChangeText={setJustificativaKmStr}
                      placeholder="Ex.: desvio por obra na rodovia"
                      multiline
                      maxLength={500}
                      className="mt-1 min-h-[72px] rounded-md border border-input bg-white px-3 py-2 text-base text-foreground"
                    />
                    <Button
                      className="mt-3"
                      loading={responderKm.isPending}
                      disabled={justificativaKmStr.trim().length < 5}
                      onPress={async () => {
                        if (justificativaKmStr.trim().length < 5) {
                          void showAlert({
                            title: "Falta explicar",
                            message: "Escreva por que o km é esse.",
                          });
                          return;
                        }
                        const kmNum = parseFloat(
                          kmDivergenteStr.replace(",", "."),
                        );
                        try {
                          await responderKm.mutateAsync({
                            viagemId: detalhe.data!.id,
                            km: Number.isFinite(kmNum) ? kmNum : undefined,
                            justificativa: justificativaKmStr.trim(),
                          });
                          setJustificativaKmStr("");
                          void showAlert({
                            title: "Obrigado!",
                            message:
                              "Resposta enviada — viagem foi marcada como ajustada.",
                          });
                        } catch (err) {
                          void showAlert({
                            title: "Erro",
                            message: humanizeApiError(err),
                          });
                        }
                      }}
                    >
                      Responder
                    </Button>
                  </View>
                </View>
              </Card>
            )}

          {/* Conversa (chat) com a operação — o pedido da divergência aparece
              aqui, e o motorista responde por aqui ou pelos cards acima. */}
          <ConversaViagem viagemId={detalhe.data.id} />

          {/* Aguardando peso: viagem lançada sem o peso/romaneio. CTA grande
              pro motorista completar quando o romaneio sair. */}
          {detalhe.data.status === "AGUARDANDO_PESO" && (
            <Card className="border-2 border-amber-500 bg-amber-500/10">
              <View className="flex-row items-start gap-3">
                <Scale size={22} color="#d97706" />
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    Falta o peso dessa viagem
                  </Text>
                  <Text className="mt-1 text-sm text-muted-foreground">
                    Você lançou sem o peso. Quando sair o romaneio, complete o
                    peso e o ticket.
                  </Text>
                  <Button
                    className="mt-3"
                    onPress={() =>
                      router.push(`/completar-peso?viagemId=${detalhe.data!.id}`)
                    }
                  >
                    Completar peso e romaneio
                  </Button>
                </View>
              </View>
            </Card>
          )}

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
              {/* Diária à disposição pode não ter descarga. */}
              {detalhe.data.localDescarga ? (
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
              ) : null}
              {/* Trechos adicionais (retorno do bota-fora): voltou pra carga */}
              {(detalhe.data.trechos ?? []).map((t) => (
                <View key={t.id} className="flex-row items-start gap-3">
                  <RotateCcw size={20} color="#d97706" />
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-foreground">
                      Voltou pra {detalhe.data.localCarga.nome}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      {detalhe.data.localCarga.logradouro} —{" "}
                      {detalhe.data.localCarga.cidade}/{detalhe.data.localCarga.uf}
                    </Text>
                    <Text className="mt-0.5 text-xs font-semibold text-amber-700">
                      Bota-fora (limpeza) · +
                      {Number(t.km).toFixed(1).replace(".", ",")} km
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </Card>

          {/* Stats */}
          <Card>
            <View className="flex-row gap-6">
              {detalhe.data.tipoServico?.medicao === "PERIODO" ? (
                <Stat
                  label="Permanência"
                  value={
                    detalhe.data.saidaEm
                      ? formatarDuracao(detalhe.data.duracaoMinutos)
                      : "—"
                  }
                  subValue={fmtPeriodoBR(detalhe.data.entradaEm, detalhe.data.saidaEm)}
                />
              ) : (
                <Stat
                  label="Toneladas"
                  value={
                    detalhe.data.status === "AGUARDANDO_PESO"
                      ? "—"
                      : fmtNum(detalhe.data.toneladasEfetiva, 3)
                  }
                  fromAi={detalhe.data.ocrCampos?.includes("toneladas")}
                  subValue={
                    detalhe.data.status === "AGUARDANDO_PESO"
                      ? "aguardando"
                      : detalhe.data.toneladasAjustada
                        ? `informado ${fmtNum(detalhe.data.toneladasInformada, 3)}`
                        : undefined
                  }
                />
              )}
              <Stat
                label="Km"
                value={fmtNum(detalhe.data.kmEfetivo, 2)}
                fromAi={detalhe.data.ocrCampos?.includes("km")}
                subValue={
                  detalhe.data.kmAjustada
                    ? `informado ${fmtNum(detalhe.data.kmInformado, 2)}`
                    : detalhe.data.kmCalculado &&
                        Number(detalhe.data.kmCalculado) !==
                          Number(detalhe.data.km)
                      ? `calculado ${fmtNum(detalhe.data.kmCalculado, 2)}`
                      : undefined
                }
              />
              <Stat
                label="Ticket"
                value={
                  detalhe.data.status === "AGUARDANDO_PESO"
                    ? "—"
                    : detalhe.data.ticket
                }
                mono
                fromAi={detalhe.data.ocrCampos?.includes("ticket")}
              />
            </View>
            {detalhe.data.kmRecalculadoEm && (
              <View className="mt-3 flex-row items-start gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5">
                <RefreshCw size={16} color="#15803d" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-xs font-medium text-foreground">
                  {detalhe.data.kmAntesRecalculo
                    ? `Km acertado: essa viagem foi lançada sem sinal (${fmtNum(
                        detalhe.data.kmAntesRecalculo,
                        0,
                      )} km estimado) e recalculamos pelo trajeto certo — agora ${fmtNum(
                        detalhe.data.km,
                        0,
                      )} km.`
                    : "Km conferido pelo trajeto certo depois que pegou sinal."}
                </Text>
              </View>
            )}
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
              <MapTrajeto
                pontos={detalhe.data.pontos.map((p) => ({
                  lat: p.lat,
                  lng: p.lng,
                }))}
                height={240}
              />
            </Card>
          )}

          {/* Foto do ticket — mostra existentes + pendentes (offline) + permite anexar */}
          <Card>
            <View className="mb-2 flex-row items-center gap-2">
              <Camera size={16} color="#0f172a" />
              <Text className="text-base font-bold text-foreground">
                Foto do ticket
              </Text>
            </View>
            {detalhe.data.fotos.length === 0 && pendingFotos.length === 0 && (
              <Text className="mb-3 text-sm text-muted-foreground">
                Nenhuma foto anexada.
              </Text>
            )}
            {(detalhe.data.fotos.length > 0 || pendingFotos.length > 0) && (
              <View className="gap-2">
                {detalhe.data.fotos.map((f) => token && (
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
                {pendingFotos.map((f) => (
                  <View key={f.clientId} className="relative">
                    <Image
                      source={{ uri: f.fotoUri }}
                      style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 12, opacity: 0.75 }}
                      resizeMode="cover"
                    />
                    <View className="absolute right-2 top-2 rounded-full bg-warning px-3 py-1">
                      <Text className="text-xs font-bold text-warning-foreground">
                        {f.status === "error"
                          ? "Erro — vai tentar de novo"
                          : "Enviando…"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            <View className="mt-3 gap-2">
              {/* value sempre null → componente reseta após cada captura.
                  onChange enfileira direto. Feedback visual via pendingFotos. */}
              <PhotoCapture value={null} onChange={onFotoCapturada} />
            </View>
          </Card>

          {/* Trajeto carga→descarga (só se nao tem GPS tracking — senao MapTrajeto
              acima já mostra o trajeto real) */}
          {detalhe.data.pontos.length < 2 &&
            (detalhe.data.localCarga.lat != null ||
              detalhe.data.localDescarga?.lat != null ||
              detalhe.data.lat != null) && (
              <Card>
                <View className="mb-2 flex-row items-center gap-2">
                  <MapPin size={16} color="#0f172a" />
                  <Text className="text-base font-bold text-foreground">
                    Trajeto da viagem
                  </Text>
                </View>
                <View className="mb-3">
                  <MapaCargaDescarga
                    carga={
                      detalhe.data.localCarga.lat != null &&
                      detalhe.data.localCarga.lng != null
                        ? {
                            lat: detalhe.data.localCarga.lat,
                            lng: detalhe.data.localCarga.lng,
                            nome: detalhe.data.localCarga.nome,
                          }
                        : null
                    }
                    descarga={
                      detalhe.data.localDescarga?.lat != null &&
                      detalhe.data.localDescarga?.lng != null
                        ? {
                            lat: detalhe.data.localDescarga.lat,
                            lng: detalhe.data.localDescarga.lng,
                            nome: detalhe.data.localDescarga.nome,
                          }
                        : null
                    }
                    lancamento={
                      detalhe.data.lat != null && detalhe.data.lng != null
                        ? { lat: detalhe.data.lat, lng: detalhe.data.lng }
                        : null
                    }
                    geometria={detalhe.data.rotaGeometria}
                    pedagios={pedagiosNaRota.data ?? []}
                    height={220}
                  />
                </View>
                {detalhe.data.lat != null && detalhe.data.lng != null && (
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
                )}
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
  subValue,
  fromAi = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  subValue?: string;
  fromAi?: boolean;
}) {
  return (
    <View>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {fromAi ? " ✨" : ""}
      </Text>
      <Text
        className="text-lg font-bold text-foreground"
        style={mono ? { fontVariant: ["tabular-nums"] } : undefined}
      >
        {value}
      </Text>
      {subValue && (
        <Text className="text-xs text-muted-foreground">{subValue}</Text>
      )}
    </View>
  );
}

function fmtNum(v: string, casas: number): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
