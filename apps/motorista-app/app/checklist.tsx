import { useEffect, useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { RequerCapacidade } from "@/components/requer-capacidade";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { useCatalogos, useMe, useMeuChecklist, type ChecklistFeito } from "@/lib/queries";
import { usePendingChecklists } from "@/hooks/use-pending-checklists";
import { diaBR } from "@/lib/checklist";
import { fmtDataCurta, fmtHoraBR, hojeISO } from "@/lib/datetime";
import { enqueueChecklist } from "@/lib/sync";

type Resposta = { ok: boolean | null; observacao: string; foto: CapturedPhoto | null };

/**
 * CHECKLIST DO CAMINHÃO: conferir pneus, freios, luzes… antes de sair. O que a
 * empresa pede está no modelo que ela montou no painel.
 *
 * Lembrado, nunca obrigatório: ninguém é impedido de iniciar viagem sem ele.
 * Nada vem marcado — quem olhou o caminhão foi ele (e marcar sozinho já acusou
 * motorista nesta casa). Item com problema vira aviso pro escritório.
 * Offline-first: vai pra fila e sobe quando tiver sinal.
 */
export default function ChecklistScreen() {
  return (
    <RequerCapacidade chave="app.checklist.fazer" titulo="Checklist do caminhão">
      <Conteudo />
    </RequerCapacidade>
  );
}

function Conteudo() {
  const me = useMe();
  const cat = useCatalogos();
  const q = useMeuChecklist();
  const queryClient = useQueryClient();
  const val = useValidacaoGuiada();
  const [veiculoId, setVeiculoId] = useState("");
  const [respostas, setRespostas] = useState<Record<string, Resposta>>({});
  const [enviando, setEnviando] = useState(false);
  // Já fez hoje? A tela abre mostrando o que foi feito; o formulário em branco
  // só abre se ele pedir (trocou de caminhão, achou problema à tarde). Nunca
  // trava: lembrar, não impedir.
  const [fazendoNovo, setFazendoNovo] = useState(false);
  const pendentes = usePendingChecklists();
  const feitos = useMemo<(ChecklistFeito & { naFila?: boolean })[]>(() => {
    const daFila = pendentes.map((p) => {
      const ruins = p.respostas.filter((r) => !r.ok);
      return {
        id: p.clientId,
        veiculoId: p.veiculoId,
        placa: p.placa,
        feitoEm: p.feitoEm,
        reprovados: ruins.length,
        problemas: ruins.map((r) => (r.observacao ? `${r.texto}: ${r.observacao}` : r.texto)),
        naFila: true,
      };
    });
    return [...daFila, ...(q.data?.recentes ?? [])].sort((a, b) => b.feitoEm.localeCompare(a.feitoEm));
  }, [pendentes, q.data?.recentes]);
  const hoje = hojeISO();
  const deHoje = feitos.filter((f) => diaBR(f.feitoEm) === hoje);
  const anteriores = feitos.filter((f) => diaBR(f.feitoEm) !== hoje);
  const mostrarFormulario = fazendoNovo || deHoje.length === 0;

  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) setVeiculoId(me.data.veiculoDefaultId);
  }, [me.data?.veiculoDefaultId, veiculoId]);

  const veiculoOptions: SelectOption[] = useMemo(
    () => (cat.data?.veiculos ?? []).map((v) => ({ value: v.id, label: v.placa, sublabel: v.modelo ?? undefined })),
    [cat.data?.veiculos],
  );

  const modelo = q.data?.modelo ?? null;
  const itens = modelo?.itens ?? [];
  const resp = (id: string): Resposta => respostas[id] ?? { ok: null, observacao: "", foto: null };
  const mudar = (id: string, parcial: Partial<Resposta>) => {
    val.limpar();
    setRespostas((r) => ({ ...r, [id]: { ...resp(id), ...parcial } }));
  };

  async function enviar() {
    val.limpar();
    if (veiculoOptions.length > 0 && !veiculoId) return void val.apontar("veiculoId", "Escolha a placa");
    for (const it of itens) {
      const r = resp(it.id);
      if (r.ok === null) return void val.apontar(`item-${it.id}`, "Marque se está OK ou com problema");
      if (r.ok === false && r.observacao.trim().length < 3) {
        return void val.apontar(`item-${it.id}`, "Conte o que você viu");
      }
    }
    setEnviando(true);
    try {
      await enqueueChecklist({
        veiculoId: veiculoId || null,
        placa: cat.data?.veiculos.find((v) => v.id === veiculoId)?.placa ?? null,
        modeloId: modelo?.id ?? null,
        respostas: itens.map((it) => {
          const r = resp(it.id);
          return {
            itemId: it.id,
            texto: it.texto,
            ok: r.ok === true,
            observacao: r.ok === false ? r.observacao.trim() : null,
            foto: r.ok === false && r.foto ? { uri: r.foto.uri, mime: r.foto.mime } : null,
          };
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ["meu-checklist"] });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const comProblema = itens.filter((it) => resp(it.id).ok === false).length;
      await showAlert({
        title: comProblema > 0 ? "Checklist guardado" : "Tudo certo com o caminhão",
        message:
          comProblema > 0
            ? `Vai pro escritório assim que tiver sinal. ${comProblema === 1 ? "O item com problema vira" : `Os ${comProblema} itens com problema viram`} aviso na manutenção.`
            : "Checklist guardado. Boa viagem!",
      });
      router.back();
    } catch {
      await showAlert({
        title: "Não consegui guardar o checklist",
        message: "Tente de novo. Se continuar, tire as fotos outra vez.",
        variant: "warning",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Checklist do caminhão" />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          ref={val.scrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {q.isLoading && !q.data ? (
            <Text className="text-base text-muted-foreground">Carregando o checklist…</Text>
          ) : !modelo || itens.length === 0 ? (
            <Text className="text-base text-muted-foreground">
              A empresa ainda não montou o checklist do caminhão. Quando montar, ele aparece aqui.
            </Text>
          ) : !mostrarFormulario ? (
            <>
              <Text className="text-lg font-semibold text-foreground">Checklist de hoje feito</Text>
              {deHoje.map((f) => (
                <CartaoChecklist key={f.id} feito={f} />
              ))}
              <Text className="text-sm text-muted-foreground">
                Trocou de caminhão ou achou algum problema depois? Dá pra fazer outro.
              </Text>
              <Button variant="outline" onPress={() => setFazendoNovo(true)}>
                Fazer de outro caminhão
              </Button>
              <Historico itens={anteriores} />
            </>
          ) : (
            <>
              {deHoje.length > 0 && (
                <Button variant="outline" onPress={() => setFazendoNovo(false)}>
                  Voltar pro checklist de hoje
                </Button>
              )}
              <Text className="text-base text-muted-foreground">
                Dá uma olhada no caminhão antes de sair. O que tiver problema vai direto pro escritório
                cuidar do conserto.
              </Text>

              {veiculoOptions.length > 0 && (
                <View className="gap-2" onLayout={val.onLayoutCampo("veiculoId")}>
                  <Label error={!!val.erroDe("veiculoId")}>Placa</Label>
                  <Select
                    value={veiculoId}
                    onChange={(v) => {
                      val.limpar();
                      setVeiculoId(v);
                    }}
                    options={veiculoOptions}
                    placeholder="Escolha a placa"
                    searchable
                    error={!!val.erroDe("veiculoId")}
                  />
                  {val.erroDe("veiculoId") ? <ErroCampo msg={val.erroDe("veiculoId")!} /> : null}
                </View>
              )}

              {itens.map((it, i) => {
                const r = resp(it.id);
                const erro = val.erroDe(`item-${it.id}`);
                return (
                  <View
                    key={it.id}
                    onLayout={val.onLayoutCampo(`item-${it.id}`)}
                    className={`gap-2 rounded-xl border-2 p-3 ${erro ? "border-destructive" : "border-border"}`}
                  >
                    <Text className="text-base font-semibold text-foreground">
                      {i + 1}. {it.texto}
                    </Text>
                    <View className="flex-row gap-2">
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected: r.ok === true }}
                        onPress={() => mudar(it.id, { ok: true })}
                        className={`flex-1 items-center rounded-xl border-2 py-3 ${
                          r.ok === true ? "border-success bg-success/10" : "border-border"
                        }`}
                      >
                        <Text className="text-base font-semibold text-foreground">OK</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected: r.ok === false }}
                        onPress={() => mudar(it.id, { ok: false })}
                        className={`flex-1 items-center rounded-xl border-2 py-3 ${
                          r.ok === false ? "border-warning bg-warning/10" : "border-border"
                        }`}
                      >
                        <Text className="text-base font-semibold text-foreground">Com problema</Text>
                      </Pressable>
                    </View>
                    {r.ok === false && (
                      <View className="gap-2">
                        <TextInput
                          className="min-h-20 rounded-xl border-2 border-border p-3 text-base text-foreground"
                          multiline
                          textAlignVertical="top"
                          placeholder="O que você viu? Ex: pneu traseiro com bolha"
                          value={r.observacao}
                          onChangeText={(t) => mudar(it.id, { observacao: t })}
                        />
                        {it.fotoSeReprovar && (
                          <PhotoCapture value={r.foto} onChange={(p) => mudar(it.id, { foto: p })} />
                        )}
                      </View>
                    )}
                    {erro ? <ErroCampo msg={erro} /> : null}
                  </View>
                );
              })}

              <Button variant="success" onPress={() => void enviar()} loading={enviando} disabled={enviando}>
                Concluir checklist
              </Button>
              {deHoje.length === 0 && <Historico itens={anteriores} />}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Um checklist já feito: placa, hora e o que deu problema. */
function CartaoChecklist({ feito }: { feito: ChecklistFeito & { naFila?: boolean } }) {
  const tudoOk = feito.reprovados === 0;
  return (
    <View
      className={`gap-1 rounded-xl border-2 p-3 ${tudoOk ? "border-success bg-success/10" : "border-warning bg-warning/10"}`}
    >
      <Text className="text-base font-semibold text-foreground">
        {feito.placa ?? "Caminhão não informado"} · {fmtHoraBR(feito.feitoEm)}
      </Text>
      <Text className="text-sm text-foreground">
        {tudoOk
          ? "Tudo OK"
          : `${feito.reprovados} ${feito.reprovados === 1 ? "item com problema" : "itens com problema"}`}
      </Text>
      {feito.problemas.map((p, i) => (
        <Text key={i} className="text-sm text-muted-foreground">
          • {p}
        </Text>
      ))}
      {feito.naFila && (
        <Text className="text-xs text-muted-foreground">Guardado no celular, sobe quando tiver sinal.</Text>
      )}
    </View>
  );
}

/** Os dos dias anteriores (até 7), pra ele conferir o que já mandou. */
function Historico({ itens }: { itens: ChecklistFeito[] }) {
  if (itens.length === 0) return null;
  return (
    <View className="mt-2 gap-2">
      <Text className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Últimos 7 dias</Text>
      {itens.map((f) => (
        <View key={f.id} className="flex-row items-center justify-between rounded-xl border-2 border-border px-3 py-2">
          <Text className="text-sm text-foreground">
            {fmtDataCurta(diaBR(f.feitoEm))} · {fmtHoraBR(f.feitoEm)} · {f.placa ?? "—"}
          </Text>
          <Text className={`text-sm font-semibold ${f.reprovados === 0 ? "text-success" : "text-foreground"}`}>
            {f.reprovados === 0 ? "Tudo OK" : `${f.reprovados} com problema`}
          </Text>
        </View>
      ))}
    </View>
  );
}
