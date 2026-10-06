import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { ActivityIndicator, AppState, KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Camera, CheckCircle2, CloudOff, Clock, Pencil } from "lucide-react-native";
import { ScreenHeader } from "@/components/screen-header";

import { useValidacaoGuiada } from "@/components/validacao-guiada";
import { Button } from "@/components/ui/button";
import { CampoEtapa } from "@/components/etapas/campo-etapa";
import { useConnectivity } from "@/lib/connectivity";
import { pegarCoordsRapido } from "@/lib/geo";
import { buscarEtapasDaViagem, type ItemEtapa } from "@/lib/etapas";
import {
  abrirRascunho,
  aplicarServidor,
  chaveRascunho,
  contar,
  enviarRascunho,
  extraDaResposta,
  itemRespondido,
  marcarConcluida,
  pegarRascunho,
  reabrirParaCorrigir,
  salvarItem,
  useEstadoEtapas,
  usePendingEtapas,
  type RascunhoEtapa,
  type RespostaItem,
} from "@/lib/etapas-local";

/** A frase grande da validação guiada: imperativa, um item por vez. */
function fraseFaltando(item: ItemEtapa, r: RespostaItem | undefined): string {
  switch (item.tipo) {
    case "FOTO":
    case "ARQUIVO":
      return `Tire a foto: ${item.rotulo}`;
    case "TEXTO":
      return `Escreva: ${item.rotulo}`;
    case "TEXTO_FOTO":
      return r?.texto?.trim() ? `Tire a foto: ${item.rotulo}` : `Escreva: ${item.rotulo}`;
    case "VALOR":
    case "NUMERO":
      return `Informe: ${item.rotulo}`;
    case "ASSINATURA":
      return r?.assinaturaSvg ? "Escreva o nome de quem assinou" : `Peça a assinatura: ${item.rotulo}`;
    case "SIM_NAO":
      if (r?.simNao == null) return `Responda: ${item.rotulo}`;
      if (extraDaResposta(item, r)?.comentario === "EXIGE" && !r.comentario?.trim()) return "Escreva o comentário";
      return "Tire a foto que falta";
  }
}

type Grupo = { area: string | null; itens: ItemEtapa[] };

/** Áreas na ordem do modelo (itens seguidos da mesma área viram um cartão). */
function agrupar(itens: ItemEtapa[]): Grupo[] {
  const grupos: Grupo[] = [];
  for (const item of itens) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.area === item.area) ultimo.itens.push(item);
    else grupos.push({ area: item.area, itens: [item] });
  }
  return grupos;
}

/**
 * PREENCHER UM FORMULÁRIO DE DOCUMENTOS (Documentos da carga, da descarga,
 * Acerto do frete).
 *
 * Tela cheia empilhada — nunca `<Modal>`: tem câmera, assinatura e teclado, e
 * Modal no Android desalinha medidas e esconde confirmações.
 *
 * - Sem botão Salvar: cada toque grava no celular na hora. Sair no meio não
 *   perde nada; pro escritório, sobe quando ele sai da tela.
 * - Obrigatório faltando NUNCA impede concluir: a validação aponta um por vez
 *   e, na insistência, oferece "Concluir e mandar o resto depois".
 */
export default function EtapaScreen() {
  const { viagemClientId, modeloId } = useLocalSearchParams<{
    viagemClientId: string;
    modeloId: string;
  }>();
  const estado = useEstadoEtapas();
  const fila = usePendingEtapas();
  const online = useConnectivity();
  const v = useValidacaoGuiada();
  const [rascunho, setRascunho] = useState<RascunhoEtapa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [assinando, setAssinando] = useState(false);
  const [mostrarFaltam, setMostrarFaltam] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const ultimoApontado = useRef<string | null>(null);

  const viagem = useMemo(
    () => estado?.viagens.find((x) => x.viagemClientId === viagemClientId) ?? null,
    [estado, viagemClientId],
  );
  const modeloDaViagem = useMemo(
    () => viagem?.modelos.find((m) => m.id === modeloId) ?? null,
    [viagem, modeloId],
  );

  // Abre o rascunho (ou nasce do que o servidor já tem, de outro celular).
  useEffect(() => {
    if (!estado) return;
    let vivo = true;
    void (async () => {
      if (!viagem || !modeloDaViagem || !viagemClientId || !modeloId) {
        if (vivo) setCarregando(false);
        return;
      }
      let r = await pegarRascunho(viagemClientId, modeloId);
      if (!r) {
        const srv = await buscarEtapasDaViagem(viagemClientId);
        if (srv) await aplicarServidor(viagemClientId, srv);
        const daqui = srv?.respostas.find((x) => x.modeloId === modeloId) ?? null;
        r = await abrirRascunho(viagem, modeloDaViagem, daqui);
      } else {
        // Já tinha rascunho: só atualiza o que o escritório resolveu, sem esperar.
        void buscarEtapasDaViagem(viagemClientId).then((srv) => {
          if (srv) void aplicarServidor(viagemClientId, srv);
        });
      }
      if (vivo) {
        setRascunho(r);
        setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // Só na abertura: depois quem manda é o estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!estado]);

  // Enquanto ele está na tela, as RESPOSTAS da tela mandam (o disco grava logo
  // atrás; trazer de volta do disco no meio da digitação faria o texto
  // "voltar" uma letra). Do disco vem só o estado do formulário: concluído,
  // reaberto pra corrigir, enviado.
  useEffect(() => {
    if (!estado || !viagemClientId || !modeloId) return;
    const r = estado.rascunhos[chaveRascunho(viagemClientId, modeloId)];
    if (!r) return;
    setRascunho((atual) =>
      atual
        ? {
            ...atual,
            concluidaEm: r.concluidaEm,
            incompleta: r.incompleta,
            enviadoEm: r.enviadoEm,
            alteradaEm: r.alteradaEm,
          }
        : r,
    );
  }, [estado, viagemClientId, modeloId]);

  // Pro escritório, sobe quando ele SAI da tela — ou quando o app vai pro fundo
  // (pode não voltar tão cedo).
  useEffect(() => {
    if (!viagemClientId || !modeloId) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void enviarRascunho(viagemClientId, modeloId);
    });
    return () => {
      sub.remove();
      void enviarRascunho(viagemClientId, modeloId);
    };
  }, [viagemClientId, modeloId]);

  const modelo = rascunho?.modelo ?? modeloDaViagem;
  const resolvidos = useMemo(
    () =>
      (viagemClientId && modeloId && estado?.resolvidos[chaveRascunho(viagemClientId, modeloId)]) || [],
    [estado, viagemClientId, modeloId],
  );
  const contagem = useMemo(
    () => (modelo ? contar(modelo, rascunho ?? undefined, resolvidos) : null),
    [modelo, rascunho, resolvidos],
  );
  const grupos = useMemo(() => (modelo ? agrupar(modelo.itens) : []), [modelo]);

  const pendente = fila.find((p) => p.clientId === rascunho?.clientId);
  const idsNaFila = useMemo(() => {
    const ids = new Set<string>();
    for (const a of pendente?.arquivos ?? []) if (!a.storageKey && !a.arquivoId) ids.add(a.id);
    // Ainda nem foi pra fila (ele está na tela): tudo que é local está "guardado aqui".
    if (rascunho && rascunho.enviadoEm !== rascunho.alteradaEm) {
      for (const it of Object.values(rascunho.itens))
        for (const a of it.arquivos) if (a.uri && !a.storageKey) ids.add(a.id);
    }
    return ids;
  }, [pendente, rascunho]);

  const concluidaCompleta = !!rascunho?.concluidaEm && !rascunho.incompleta;
  const somenteLeitura = concluidaCompleta;

  const mudarItem = useCallback(
    (chave: string, f: (r: RespostaItem) => RespostaItem) => {
      if (!viagemClientId || !modeloId) return;
      v.limpar();
      setMostrarFaltam(false);
      // Na tela na hora; no disco logo atrás (o estado reativo confirma).
      setRascunho((atual) => {
        if (!atual) return atual;
        const antes = atual.itens[chave] ?? { arquivos: [] };
        return { ...atual, itens: { ...atual.itens, [chave]: f({ ...antes, arquivos: [...antes.arquivos] }) } };
      });
      void salvarItem(viagemClientId, modeloId, chave, f);
    },
    [viagemClientId, modeloId, v],
  );

  async function concluir(incompleta: boolean) {
    if (!viagemClientId || !modeloId || concluindo) return;
    setConcluindo(true);
    try {
      const gps = await pegarCoordsRapido();
      await marcarConcluida(viagemClientId, modeloId, incompleta, gps);
      await enviarRascunho(viagemClientId, modeloId, { forcar: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } finally {
      setConcluindo(false);
    }
  }

  function aoTocarConcluir() {
    if (!contagem || !rascunho) return;
    const primeiro = contagem.faltando[0];
    if (!primeiro) {
      void concluir(false);
      return;
    }
    // Insistiu com o mesmo item ainda vazio: em vez de apontar de novo, mostra
    // o que falta e a saída "mandar depois". Nunca recusa.
    if (ultimoApontado.current === primeiro.chave) {
      v.limpar();
      setMostrarFaltam(true);
      setTimeout(() => v.scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return;
    }
    ultimoApontado.current = primeiro.chave;
    v.apontar(primeiro.chave, fraseFaltando(primeiro, rascunho.itens[primeiro.chave]));
  }

  if (carregando || !estado) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!viagem || !modelo || !rascunho || !contagem) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Documentos" />
        <View className="gap-4 p-4">
          <Text className="text-lg text-foreground">
            Esses documentos não estão mais neste celular.
          </Text>
          <Button variant="outline" onPress={() => router.back()}>
            <ArrowLeft size={20} color="#0f172a" />
            <Text className="text-base font-semibold text-foreground">Voltar</Text>
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const arquivoRecusado = pendente?.status === "error" ? pendente.arquivoRecusado ?? null : null;
  const pct = contagem.total > 0 ? Math.round((contagem.feitos / contagem.total) * 100) : 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={modelo.nome}
        subtitle={[viagem.placa, viagem.rotulo].filter(Boolean).join(" · ")}
      />
      {!online ? (
        <View className="flex-row items-center gap-2 bg-muted px-4 py-2.5">
          <CloudOff size={18} color="#475569" />
          <Text className="flex-1 text-sm text-muted-foreground">
            Sem sinal. Está tudo guardado no celular e sobe sozinho quando pegar.
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          ref={v.scrollRef}
          scrollEnabled={!assinando}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        >
          <View ref={v.conteudoRef} className="gap-4">
            <View className="gap-2">
              <View className="h-3 overflow-hidden rounded-full bg-muted">
                <View className="h-3 rounded-full bg-success" style={{ width: `${pct}%` }} />
              </View>
              <Text className="text-base font-semibold text-foreground">
                {contagem.feitos} de {contagem.total} feitos
              </Text>
            </View>

            {somenteLeitura ? (
              <View className="gap-3 rounded-2xl border-2 border-success/40 bg-success/10 p-4">
                <View className="flex-row items-center gap-2">
                  <CheckCircle2 size={20} color="#16a34a" />
                  <Text className="flex-1 text-base font-bold text-foreground">
                    Documentos concluídos
                  </Text>
                </View>
                <Button
                  variant="outline"
                  onPress={() => {
                    if (viagemClientId && modeloId) void reabrirParaCorrigir(viagemClientId, modeloId);
                  }}
                >
                  <Pencil size={18} color="#0f172a" />
                  <Text className="text-base font-semibold text-foreground">Corrigir</Text>
                </Button>
              </View>
            ) : null}

            {grupos.map((g, gi) => {
              const feitosArea = g.itens.filter(
                (i) => resolvidos.includes(i.chave) || itemRespondido(i, rascunho.itens[i.chave]),
              ).length;
              return (
                <View key={`${g.area ?? "sem-area"}-${gi}`} className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                      {g.area ?? "Documentos"}
                    </Text>
                    <Text className="text-sm font-semibold text-muted-foreground">
                      {feitosArea} de {g.itens.length}
                    </Text>
                  </View>
                  {g.itens.map((item) =>
                    resolvidos.includes(item.chave) ? (
                      <View key={item.chave} className="flex-row items-center gap-2 rounded-xl border border-border p-3">
                        <CheckCircle2 size={20} color="#16a34a" />
                        <Text className="flex-1 text-base text-foreground">
                          {item.rotulo} — o escritório já cuidou deste.
                        </Text>
                      </View>
                    ) : (
                      <View key={item.chave} ref={v.refCampo(item.chave)} onLayout={v.onLayoutCampo(item.chave)}>
                        <CampoEtapa
                          item={item}
                          resposta={rascunho.itens[item.chave]}
                          erro={v.erroDe(item.chave)}
                          aviso={
                            arquivoRecusado?.itemChave === item.chave &&
                            (rascunho.itens[item.chave]?.arquivos ?? []).some(
                              (a) => a.id === arquivoRecusado.arquivoId,
                            )
                              ? "Esta foto não subiu. Apague e tire de novo."
                              : null
                          }
                          idsNaFila={idsNaFila}
                          somenteLeitura={somenteLeitura}
                          onMudar={(f) => mudarItem(item.chave, f)}
                          onDesenhando={setAssinando}
                        />
                      </View>
                    ),
                  )}
                </View>
              );
            })}

            {!somenteLeitura && mostrarFaltam && contagem.faltando.length > 0 ? (
              <View className="gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
                <Text className="text-lg font-bold text-foreground">
                  {contagem.faltando.length === 1 ? "Falta 1 item" : `Faltam ${contagem.faltando.length} itens`}
                </Text>
                {contagem.faltando.map((i) => (
                  <Text key={i.chave} className="text-base text-foreground">
                    • {i.rotulo}
                  </Text>
                ))}
                <Text className="text-base text-foreground">
                  Se ainda não chegou, pode concluir e mandar depois. O escritório fica sabendo
                  que está faltando.
                </Text>
                <Button
                  onPress={() => {
                    const p = contagem.faltando[0];
                    setMostrarFaltam(false);
                    if (p) {
                      ultimoApontado.current = p.chave;
                      v.apontar(p.chave, fraseFaltando(p, rascunho.itens[p.chave]));
                    }
                  }}
                >
                  <Camera size={20} color="white" />
                  <Text className="text-base font-semibold text-primary-foreground">Completar agora</Text>
                </Button>
                <Button variant="warning" onPress={() => void concluir(true)} loading={concluindo}>
                  <Clock size={20} color="#1f2937" />
                  <Text className="text-base font-semibold text-warning-foreground">
                    Concluir e mandar o resto depois
                  </Text>
                </Button>
              </View>
            ) : null}

            {!somenteLeitura ? (
              <Button
                size="lg"
                variant="success"
                className="h-20"
                onPress={aoTocarConcluir}
                loading={concluindo && !mostrarFaltam}
              >
                <CheckCircle2 size={24} color="white" />
                <Text className="text-xl font-bold text-success-foreground">Concluir</Text>
              </Button>
            ) : null}
            <Button variant="outline" onPress={() => router.back()}>
              <ArrowLeft size={20} color="#0f172a" />
              <Text className="text-base font-semibold text-foreground">Voltar pra viagem</Text>
            </Button>
            {!somenteLeitura ? (
              <Text className="text-center text-sm text-muted-foreground">
                Tudo o que você preenche fica guardado no celular. Pode sair e voltar depois.
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
