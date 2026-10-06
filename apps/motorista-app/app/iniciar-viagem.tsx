import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { CheckCircle2, ClipboardCheck, SkipForward } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { LocalPorGps, type SelecaoLocal } from "@/components/local-por-gps";
import { MiniMapaCarga } from "@/components/mini-mapa-carga";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { SemCatalogo } from "@/components/sem-catalogo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { hidratarViagemDoServidor, iniciarViagemGuiada } from "@/lib/lifecycle";
import { useCatalogos, useMe, useModelosEtapa } from "@/lib/queries";
import { useCapacidadeNova } from "@/lib/acessos-app";
import { CAP_ETAPAS } from "@/lib/etapas";
import { registrarViagemComEtapas } from "@/lib/etapas-local";
import { BarreiraEtapas } from "@/components/etapas/barreira-etapas";
import { useChecklistDeHoje } from "@/lib/checklist";
import { pagadorSeDiferente } from "@/lib/utils";
import { ConvitePosicao } from "@/components/convite-posicao";
import { escolherModoDaLista } from "@ronan/shared-types";

/**
 * Passo 1 do lifecycle guiado: escolher a placa e (opcional) marcar o local
 * de carga por GPS. Ao confirmar, abre a viagem (enfileira o /iniciar) e vai
 * pra tela de andamento.
 */
export default function IniciarViagem() {
  const me = useMe();
  const cat = useCatalogos();
  const qc = useQueryClient();
  const [veiculoId, setVeiculoId] = useState("");
  // Lembrete do checklist pro caminhão escolhido. Só lembra — começar a
  // viagem sem ele continua liberado.
  const checklistHoje = useChecklistDeHoje(veiculoId || null);
  // "Pular" vale pra esta viagem (esta tela): não pergunta de novo até ele
  // começar outra.
  const [pulouChecklist, setPulouChecklist] = useState(false);
  const [abriuChecklist, setAbriuChecklist] = useState(false);
  const [clienteId, setClienteId] = useState("");
  // Modo de serviço escolhido. "" = o padrão da conta (o caso de quem tem um
  // modo só, que nem vê a pergunta).
  const [tipoServicoId, setTipoServicoId] = useState("");
  const [localCarga, setLocalCarga] = useState<SelecaoLocal | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const v = useValidacaoGuiada();
  // Já tem viagem aberta? Não deixa abrir duas — redireciona pra andamento.
  const [checando, setChecando] = useState(true);
  // Documentos da viagem (nasce desligado: sem a função, nada aqui muda).
  const etapasLigado = useCapacidadeNova(CAP_ETAPAS);
  const modelosEtapa = useModelosEtapa(etapasLigado);
  // "Antes de seguir": documento da viagem anterior que o escritório precisa.
  // O botão final só aparece depois que ele anexa ou explica.
  const [liberadoEtapas, setLiberadoEtapas] = useState(true);

  useEffect(() => {
    let alive = true;
    // Catálogo fresco (clientes/locais atuais — evita cliente/local excluído).
    void qc.invalidateQueries({ queryKey: ["catalogos"] });
    // Reconcilia com o servidor: se já existe viagem em andamento (local ou
    // órfã no servidor), retoma em vez de deixar abrir outra (evita o 409).
    void hidratarViagemDoServidor().then((atual) => {
      if (!alive) return;
      if (atual) {
        router.replace("/viagem-guiada");
        return;
      }
      setChecando(false);
    });
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pré-seleciona a placa default do motorista.
  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const veiculoOptions: SelectOption[] = (
    cat.data?.veiculos ??
    me.data?.veiculos ??
    []
  ).map((v) => ({ value: v.id, label: v.placa, sublabel: v.modelo ?? undefined }));

  const clienteOptions: SelectOption[] = (cat.data?.clientes ?? []).map((c) => ({
    value: c.id,
    label: c.nome,
    sublabel: pagadorSeDiferente(c.nome, c.empresa?.nome),
  }));
  // Mesmo seletor da "Lançar viagem feita": só aparece com mais de um modo
  // ativo. O modo decide o que o finalizar vai pedir, por isso é escolhido aqui.
  const tiposServico = useMemo(() => cat.data?.tiposServico ?? [], [cat.data?.tiposServico]);
  const mostrarSeletorServico = tiposServico.length > 1;
  const modo = useMemo(
    () => escolherModoDaLista(tiposServico, tipoServicoId),
    [tiposServico, tipoServicoId],
  );

  const clienteNome = useMemo(
    () => cat.data?.clientes.find((c) => c.id === clienteId)?.nome,
    [cat.data?.clientes, clienteId],
  );

  async function confirmar() {
    setErro(null);
    if (!veiculoId) return void v.apontar("placa", "Escolha a placa do caminhão");
    if (!clienteId) return void v.apontar("cliente", "Escolha o cliente");
    if (!localCarga)
      return void v.apontar("carga", "Toque em “Estou no local de carga” e marque o local");
    v.limpar();
    setSubmitting(true);
    try {
      const viagemClientId = await iniciarViagemGuiada({
        veiculoId,
        // Snapshot da placa junto: se o veículo sumir do cadastro antes de esta
        // viagem subir, o servidor readota pela placa em vez de ter que
        // adivinhar o caminhão.
        veiculoPlaca: veiculoOptions.find((o) => o.value === veiculoId)?.label,
        clienteId,
        clienteNome,
        // O modo que valeu na tela (escolhido ou padrão). Sem modo no catálogo
        // vai sem, e o servidor grava o padrão da conta.
        tipoServicoId: modo?.id,
        coords: localCarga?.lat != null && localCarga?.lng != null
          ? { lat: localCarga.lat, lng: localCarga.lng, precisao: localCarga.precisao ?? undefined, fonte: localCarga.fonte }
          : undefined,
        localCarga: {
          id: localCarga.id,
          nome: localCarga.nome,
          lat: localCarga.lat,
          lng: localCarga.lng,
          criarOffline: localCarga.criarOffline,
        },
        cargaCaptura: {
          gpsLat: localCarga.gpsLat,
          gpsLng: localCarga.gpsLng,
          precisao: localCarga.precisao,
          fonte: localCarga.fonte,
          distanciaMetros: localCarga.distanciaMetros,
          raioUsadoM: localCarga.raioUsadoM,
          buscaOffline: localCarga.buscaOffline,
        },
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Documentos: a viagem guarda os formulários que valem AGORA (a versão
      // que ele vai ver). Os da carga NÃO abrem sozinhos: ele cai na viagem em
      // andamento, vê que começou, e o cartão "Agora" convida pros documentos.
      if (etapasLigado && modelosEtapa.length > 0) {
        await registrarViagemComEtapas({
          viagemClientId,
          rotulo: [clienteNome, localCarga.nome].filter(Boolean).join(" · ") || "Viagem",
          placa: veiculoOptions.find((o) => o.value === veiculoId)?.label ?? null,
          origem: "GUIADA",
          iniciadaEm: new Date().toISOString(),
          modelos: modelosEtapa,
        }).catch(() => {});
      }
      router.replace({ pathname: "/viagem-guiada", params: { iniciou: "1" } });
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSubmitting(false);
    }
  }

  if (checando) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Começar viagem" />

      {!cat.data ? (
        <SemCatalogo carregando={cat.isFetching} aoBaixar={() => void cat.refetch()} />
      ) : (
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        <ScrollView
          ref={v.scrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <BarreiraEtapas acao="INICIAR" onLiberado={setLiberadoEtapas} />

          {/* Convite discreto (saiu da home): some se ele já compartilha. */}
          <ConvitePosicao />

          <View className="gap-2" onLayout={v.onLayoutCampo("placa")}>
            <Label error={!!v.erroDe("placa")}>Placa</Label>
            <Select
              value={veiculoId}
              onChange={(x) => {
                v.limpar();
                setVeiculoId(x);
              }}
              options={veiculoOptions}
              placeholder="Escolha a placa"
              searchable
              error={!!v.erroDe("placa")}
            />
            {v.erroDe("placa") ? <ErroCampo msg={v.erroDe("placa")!} /> : null}
          </View>

          <View className="gap-2" onLayout={v.onLayoutCampo("cliente")}>
            <Label error={!!v.erroDe("cliente")}>Cliente</Label>
            <Select
              value={clienteId}
              onChange={(x) => {
                v.limpar();
                setClienteId(x);
                setLocalCarga(null); // troca de cliente reseta o local de carga
              }}
              options={clienteOptions}
              placeholder="Escolha o cliente"
              searchable
              error={!!v.erroDe("cliente")}
            />
            {v.erroDe("cliente") ? <ErroCampo msg={v.erroDe("cliente")!} /> : null}
          </View>

          {mostrarSeletorServico ? (
            <View className="gap-2">
              <Label>Tipo de serviço</Label>
              <Select
                value={modo?.id ?? ""}
                onChange={(x) => {
                  v.limpar();
                  setTipoServicoId(x);
                }}
                options={tiposServico.map((t) => ({ value: t.id, label: t.nome }))}
                placeholder="Escolha o tipo de serviço"
                title="Tipo de serviço"
              />
            </View>
          ) : null}

          {/* Local de carga — só depois do cliente (busca só locais dele/perto). */}
          {clienteId ? (
            <View
              className={
                v.erroDe("carga")
                  ? "gap-2 rounded-2xl border-2 border-destructive bg-destructive/5 p-3"
                  : "gap-2"
              }
              onLayout={v.onLayoutCampo("carga")}
            >
              <LocalPorGps
                lado="carga"
                ctaLabel="Estou no local de carga"
                clienteId={clienteId}
                value={localCarga}
                onSelect={(sel) => {
                  v.limpar();
                  setLocalCarga(sel);
                }}
                onLimpar={() => setLocalCarga(null)}
              />
              {v.erroDe("carga") ? (
                <ErroCampo msg={v.erroDe("carga")!} />
              ) : (
                <Text className="text-xs text-muted-foreground">
                  Toque quando estiver no pátio de carga — o app acha o local desse
                  cliente pela sua posição. Marca aqui a hora que você carregou.
                </Text>
              )}
              {/* Mapa "você × local" — mostra na hora se está perto ou longe. */}
              {localCarga?.lat != null &&
              localCarga?.lng != null &&
              localCarga?.gpsLat != null &&
              localCarga?.gpsLng != null ? (
                <MiniMapaCarga
                  motorista={{ lat: localCarga.gpsLat, lng: localCarga.gpsLng }}
                  local={{ lat: localCarga.lat, lng: localCarga.lng }}
                  distanciaMetros={localCarga.distanciaMetros}
                />
              ) : null}
            </View>
          ) : (
            <Text className="text-sm text-muted-foreground">
              Escolha o cliente pra marcar o local de carga.
            </Text>
          )}

          {/* Checklist do caminhão: na 1ª viagem do dia DESTE caminhão, logo
              antes do "Confirmar carga". Saiu da home (decisão do dono,
              06/10/2026). Lembrete, nunca trava: "Pular" some com o cartão
              nesta viagem e o painel segue vendo quem rodou sem. */}
          {checklistHoje.devoLembrar && veiculoId && !pulouChecklist ? (
            <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
              <View className="flex-row items-start gap-3">
                <ClipboardCheck size={24} color="#B4501A" />
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    Checklist do caminhão — leva um minuto
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Dá uma olhada no caminhão antes de sair. O que tiver problema vai pro escritório.
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                <Button
                  className="flex-1"
                  onPress={() => {
                    setAbriuChecklist(true);
                    // push (não replace): ao concluir, o checklist volta pra
                    // cá com placa, cliente e carga do jeito que ele deixou.
                    router.push({ pathname: "/checklist", params: { veiculoId } });
                  }}
                >
                  <ClipboardCheck size={20} color="white" />
                  <Text className="text-base font-semibold text-primary-foreground">Fazer checklist</Text>
                </Button>
                <Button variant="outline" onPress={() => setPulouChecklist(true)}>
                  <SkipForward size={20} color="#0f172a" />
                  <Text className="text-base font-semibold text-foreground">Pular</Text>
                </Button>
              </View>
            </View>
          ) : abriuChecklist && checklistHoje.feito ? (
            <View className="flex-row items-center gap-3 rounded-xl border-2 border-success bg-success/10 p-3">
              <CheckCircle2 size={22} color="#16a34a" />
              <Text className="flex-1 text-base font-semibold text-foreground">Checklist feito</Text>
            </View>
          ) : null}

          {erro ? <ErroCampo msg={erro} /> : null}

          {liberadoEtapas ? (
            // "Confirmar carga", não "Começar viagem": o título da tela já é
            // esse nome, e dois toques seguidos no mesmo nome fazem ele achar
            // que o primeiro não pegou.
            <Button size="lg" variant="success" onPress={confirmar} loading={submitting}>
              {!submitting && <CheckCircle2 size={22} color="white" />}
              <Text className="text-lg font-bold text-success-foreground">
                {submitting ? "Confirmando…" : "Confirmar carga"}
              </Text>
            </Button>
          ) : (
            <Text className="text-center text-base text-muted-foreground">
              Anexe o documento lá em cima, ou toque em “Seguir sem isso”, pra liberar o “Confirmar carga”.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
