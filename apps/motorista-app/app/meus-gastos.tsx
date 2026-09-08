import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import {
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, CloudOff, Plus, Trash2 } from "lucide-react-native";
import {
  ROTULO_LANCAMENTO_PESSOAL,
  TIPOS_LANCAMENTO_PESSOAL,
  ehGanho,
  type ResumoMesPessoal,
  type TipoLancamentoPessoal,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { showConfirm } from "@/lib/alert";
import {
  cacheDoMes,
  carregarMes,
  carregarResumo,
  drenar,
  hojeISO,
  lancar,
  mesAtual,
  type ItemPessoal,
} from "@/lib/pessoal";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O caderninho do motorista: o que ele gastou e recebeu, do bolso dele.
 *
 * Vale com ou sem empresa — é dele. Nenhuma transportadora vê isto, e é por isso
 * que a tela fala "seu" e não "da empresa". Ver docs/identidade-motorista.md.
 */
export default function MeusGastosScreen() {
  const [mes] = useState(mesAtual());
  const [itens, setItens] = useState<ItemPessoal[]>([]);
  const [resumo, setResumo] = useState<ResumoMesPessoal | null>(null);
  const [form, setForm] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setItens(await carregarMes(mes));
      setResumo(await carregarResumo(mes));
    } catch {
      /* sem sinal: fica o que já está na tela */
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    // Cache primeiro: a lista aparece na hora, mesmo sem sinal, e o servidor
    // corrige por trás. Igual ao resto do app.
    void cacheDoMes(mes).then(setItens);
    void drenar().then(recarregar);
  }, [mes, recarregar]);

  async function apagar(item: ItemPessoal) {
    if (item.pendente) return;
    const ok = await showConfirm({
      title: "Apagar este lançamento?",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    await api.apagarLancamentoPessoal(item.id).catch(() => {});
    await recarregar();
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={carregando} onRefresh={() => void recarregar()} />
          }
        >
          <View className="bg-brand px-6 pb-6 pt-14">
            <View className="flex-row items-center gap-3">
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <ArrowLeft size={24} color="#fff" />
              </Pressable>
              <View>
                <Text className="text-2xl font-extrabold tracking-tight text-white">
                  Meus gastos
                </Text>
                <Text className="text-sm font-medium text-white/80">
                  Só seu — nenhuma empresa vê isto
                </Text>
              </View>
            </View>

            {resumo && (
              <View className="mt-5 flex-row gap-2">
                <Resumo rotulo="Recebi" valor={resumo.ganhos} />
                <Resumo rotulo="Gastei" valor={resumo.gastos} />
                <Resumo rotulo="Sobrou" valor={resumo.saldo} destaque />
              </View>
            )}
            {resumo?.precoMedioLitro != null && (
              <Text className="mt-3 text-sm font-medium text-white/80">
                Combustível: {dinheiro(resumo.precoMedioLitro)}/litro em{" "}
                {resumo.litros.toLocaleString("pt-BR")} litros
              </Text>
            )}
          </View>

          <View className="flex-1 gap-4 px-6 py-6">
            {form ? (
              <Formulario
                onCancelar={() => setForm(false)}
                onPronto={async () => {
                  setForm(false);
                  setItens(await cacheDoMes(mes));
                  await recarregar();
                }}
              />
            ) : (
              <Button size="lg" className="h-16" onPress={() => setForm(true)}>
                <Plus size={22} color="#fff" />
                <Text className="text-lg font-bold text-primary-foreground">Lançar</Text>
              </Button>
            )}

            {itens.length === 0 && !form && (
              <View className="rounded-2xl border-2 border-dashed border-border p-6">
                <Text className="text-center text-base font-semibold text-foreground">
                  Nada lançado neste mês
                </Text>
                <Text className="mt-1 text-center text-sm text-muted-foreground">
                  Anote o diesel, o pedágio, a refeição — e o que você recebeu. Serve pra você
                  saber quanto sobrou no fim do mês.
                </Text>
              </View>
            )}

            {itens.map((i) => (
              <View
                key={i.clientId}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4"
              >
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-bold text-foreground">
                      {ROTULO_LANCAMENTO_PESSOAL[i.tipo]}
                    </Text>
                    {i.pendente && (
                      <View className="flex-row items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
                        <CloudOff size={12} color="#b45309" />
                        <Text className="text-xs font-semibold text-amber-700">
                          Vai subir depois
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-muted-foreground">
                    {i.data.split("-").reverse().join("/")}
                    {i.descricao ? ` · ${i.descricao}` : ""}
                    {i.litros ? ` · ${i.litros} L` : ""}
                  </Text>
                </View>
                <Text
                  className={`text-lg font-bold ${
                    ehGanho(i.tipo) ? "text-green-700" : "text-foreground"
                  }`}
                >
                  {ehGanho(i.tipo) ? "+" : "−"} {dinheiro(i.valor)}
                </Text>
                {!i.pendente && (
                  <Pressable onPress={() => void apagar(i)} hitSlop={10}>
                    <Trash2 size={18} color="#64748b" />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Resumo({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <View className={`flex-1 rounded-xl p-3 ${destaque ? "bg-white/20" : "bg-white/10"}`}>
      <Text className="text-xs font-medium uppercase tracking-wide text-white/70">{rotulo}</Text>
      <Text className="mt-0.5 text-base font-bold text-white">{dinheiro(valor)}</Text>
    </View>
  );
}

function Formulario({ onCancelar, onPronto }: { onCancelar: () => void; onPronto: () => void }) {
  const [tipo, setTipo] = useState<TipoLancamentoPessoal>("ABASTECIMENTO");
  const [valor, setValor] = useState("");
  const [litros, setLitros] = useState("");
  const [data] = useState(hojeISO());
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!valorNum || valorNum <= 0) return setErro("Informe o valor.");
    setSalvando(true);
    try {
      await lancar({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        tipo,
        data,
        valor: valorNum,
        litros: tipo === "ABASTECIMENTO" && litros ? Number(litros.replace(",", ".")) : undefined,
        descricao: descricao.trim() || undefined,
      });
      onPronto();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <View className="gap-4 rounded-2xl border-2 border-border bg-card p-4">
      <View className="flex-row flex-wrap gap-2">
        {TIPOS_LANCAMENTO_PESSOAL.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTipo(t)}
            className={`rounded-xl border-2 px-3 py-2 ${
              tipo === t ? "border-primary bg-primary/10" : "border-border"
            }`}
          >
            <Text
              className={`text-sm font-bold ${
                tipo === t ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {ROTULO_LANCAMENTO_PESSOAL[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="gap-2">
        <Label>Valor (R$)</Label>
        <Input
          value={valor}
          onChangeText={(v) => setValor(v.replace(/[^\d.,]/g, ""))}
          keyboardType="decimal-pad"
          placeholder="0,00"
          editable={!salvando}
        />
      </View>

      {tipo === "ABASTECIMENTO" && (
        <View className="gap-2">
          <Label>Litros (opcional)</Label>
          <Input
            value={litros}
            onChangeText={(v) => setLitros(v.replace(/[^\d.,]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="0"
            editable={!salvando}
          />
          <Text className="text-xs text-muted-foreground">
            Com os litros dá pra ver quanto você está pagando por litro no mês.
          </Text>
        </View>
      )}

      <View className="gap-2">
        <Label>Observação (opcional)</Label>
        <Input
          value={descricao}
          onChangeText={setDescricao}
          placeholder={tipo === "ABASTECIMENTO" ? "Posto, cidade…" : "O que foi"}
          editable={!salvando}
        />
      </View>

      {erro && (
        <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
          <Text className="text-base font-medium text-destructive">{erro}</Text>
        </View>
      )}

      <View className="flex-row gap-2">
        <Button variant="outline" className="flex-1" onPress={onCancelar} disabled={salvando}>
          <Text className="text-base font-semibold text-foreground">Cancelar</Text>
        </Button>
        <Button className="flex-1 bg-green-600" loading={salvando} onPress={salvar}>
          <Text className="text-base font-bold text-white">
            {salvando ? "Salvando..." : "Salvar"}
          </Text>
        </Button>
      </View>
    </View>
  );
}
