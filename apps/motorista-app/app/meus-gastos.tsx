import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import {
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, ArrowRight, CloudOff, FileText, Plus, Send, Trash2 } from "lucide-react-native";
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
import { showAlert, showConfirm } from "@/lib/alert";
import { API_URL } from "@/lib/api-url";
import {
  cacheDoMes,
  cacheViagens,
  carregarMes,
  carregarResumo,
  carregarViagens,
  drenar,
  hojeISO,
  lancar,
  mesAtual,
  type ItemPessoal,
  type ItemViagem,
} from "@/lib/pessoal";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.split("-").reverse().join("/");

type Aba = "fretes" | "gastos";

/**
 * O caderno de trabalho do motorista por conta própria: os fretes que ele fez e
 * o que gastou/recebeu do próprio bolso.
 *
 * Vale com ou sem empresa — é dele, e nenhuma transportadora vê. Os fretes aqui
 * não são as viagens da empresa: sem catálogo, origem e destino são texto livre.
 * Ver docs/motorista-sem-empresa.md.
 */
export default function MeuCadernoScreen() {
  const [mes] = useState(mesAtual());
  const [aba, setAba] = useState<Aba>("fretes");
  const [itens, setItens] = useState<ItemPessoal[]>([]);
  const [viagens, setViagens] = useState<ItemViagem[]>([]);
  const [resumo, setResumo] = useState<ResumoMesPessoal | null>(null);
  const [form, setForm] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setViagens(await carregarViagens(mes));
      setItens(await carregarMes(mes));
      setResumo(await carregarResumo(mes));
    } catch {
      /* sem sinal: fica o que já está na tela */
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    // Cache primeiro: as listas aparecem na hora, mesmo sem sinal, e o servidor
    // corrige por trás. Igual ao resto do app.
    void cacheViagens(mes).then(setViagens);
    void cacheDoMes(mes).then(setItens);
    void drenar().then(recarregar);
  }, [mes, recarregar]);

  async function apagarGasto(item: ItemPessoal) {
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

  async function apagarFrete(v: ItemViagem) {
    if (v.pendente) return;
    const ok = await showConfirm({
      title: "Apagar este frete?",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    await api.apagarViagemPessoal(v.id).catch(() => {});
    await recarregar();
  }

  /**
   * Gera o link do mês e abre o compartilhamento do sistema — é assim que ele
   * manda pro WhatsApp de quem vai pagar.
   */
  async function mandarComprovante() {
    if (viagens.length === 0) {
      void showAlert({
        title: "Nenhum frete neste mês",
        message: "Registre os fretes primeiro — o comprovante mostra o que você rodou.",
      });
      return;
    }
    try {
      const [ano, m] = mes.split("-").map(Number);
      const ultimoDia = new Date(Date.UTC(ano!, m!, 0)).getUTCDate();
      const c = await api.criarComprovantePessoal({
        tipo: "FRETES",
        inicio: `${mes}-01`,
        fim: `${mes}-${String(ultimoDia).padStart(2, "0")}`,
      });
      const link = `${API_URL}/publico/comprovante/${c.token}`;
      await Share.share({
        message: `Fretes que rodei de ${dia(c.inicio)} a ${dia(c.fim)}: ${link}`,
      });
    } catch {
      void showAlert({
        title: "Não deu pra gerar o comprovante",
        message: "Precisa de internet pra criar o link. Tente de novo quando tiver sinal.",
      });
    }
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
              <View className="flex-1">
                <Text className="text-2xl font-extrabold tracking-tight text-white">
                  Meu caderno
                </Text>
                <Text className="text-sm font-medium text-white/80">
                  Seus fretes e seus gastos — nenhuma empresa vê
                </Text>
              </View>
            </View>

            {resumo && (
              <>
                <View className="mt-5 flex-row gap-2">
                  <Resumo rotulo="Recebi" valor={dinheiro(resumo.ganhos)} />
                  <Resumo rotulo="Gastei" valor={dinheiro(resumo.gastos)} />
                  <Resumo rotulo="Sobrou" valor={dinheiro(resumo.saldo)} destaque />
                </View>
                <Text className="mt-3 text-sm font-medium text-white/80">
                  {resumo.viagens} {resumo.viagens === 1 ? "frete" : "fretes"}
                  {resumo.km > 0 ? ` · ${resumo.km.toLocaleString("pt-BR")} km` : ""}
                  {resumo.ganhoPorKm != null ? ` · ${dinheiro(resumo.ganhoPorKm)}/km` : ""}
                  {resumo.precoMedioLitro != null
                    ? ` · ${dinheiro(resumo.precoMedioLitro)}/litro`
                    : ""}
                </Text>
              </>
            )}
          </View>

          <View className="flex-row gap-2 border-b border-border px-6 pt-4">
            {(["fretes", "gastos"] as const).map((a) => (
              <Pressable
                key={a}
                onPress={() => {
                  setAba(a);
                  setForm(false);
                }}
                className={`border-b-2 px-3 pb-3 ${
                  aba === a ? "border-primary" : "border-transparent"
                }`}
              >
                <Text
                  className={`text-base font-bold ${
                    aba === a ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {a === "fretes" ? "Fretes" : "Gastos"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="flex-1 gap-4 px-6 py-6">
            {aba === "fretes" ? (
              <>
                <Button size="lg" className="h-16" onPress={() => router.push("/novo-frete")}>
                  <Plus size={22} color="#fff" />
                  <Text className="text-lg font-bold text-primary-foreground">Novo frete</Text>
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  onPress={() => router.push("/meus-documentos")}
                >
                  <FileText size={18} color="#0f172a" />
                  <Text className="text-base font-semibold text-foreground">
                    Meus documentos
                  </Text>
                </Button>

                {viagens.length > 0 && (
                  <Button size="lg" variant="outline" onPress={() => void mandarComprovante()}>
                    <Send size={18} color="#0f172a" />
                    <Text className="text-base font-semibold text-foreground">
                      Mandar comprovante do mês
                    </Text>
                  </Button>
                )}

                {viagens.length === 0 && (
                  <Vazio
                    titulo="Nenhum frete neste mês"
                    texto="Toque em Novo frete: o app calcula o km e as praças de pedágio do caminho, e mostra o que sobra antes de você aceitar."
                  />
                )}

                {viagens.map((v) => (
                  <View key={v.clientId} className="rounded-2xl border-2 border-border bg-card p-4">
                    <View className="flex-row items-start gap-3">
                      <View className="flex-1">
                        <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                          <Text className="font-bold text-foreground">{v.origem}</Text>
                          <ArrowRight size={14} color="#64748b" />
                          <Text className="font-bold text-foreground">{v.destino}</Text>
                          {v.pendente && <Pendente />}
                        </View>
                        <Text className="mt-0.5 text-sm text-muted-foreground">
                          {dia(v.data)}
                          {v.carga ? ` · ${v.carga}` : ""}
                          {v.km ? ` · ${v.km.toLocaleString("pt-BR")} km` : ""}
                          {v.peso ? ` · ${v.peso.toLocaleString("pt-BR")} t` : ""}
                        </Text>
                      </View>
                      {v.valorRecebido != null && (
                        <Text className="text-lg font-bold text-green-700">
                          + {dinheiro(v.valorRecebido)}
                        </Text>
                      )}
                      {!v.pendente && (
                        <Pressable onPress={() => void apagarFrete(v)} hitSlop={10}>
                          <Trash2 size={18} color="#64748b" />
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <>
                {form ? (
                  <FormGasto
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
                    <Text className="text-lg font-bold text-primary-foreground">Lançar gasto</Text>
                  </Button>
                )}

                {itens.length === 0 && !form && (
                  <Vazio
                    titulo="Nada lançado neste mês"
                    texto="Anote o diesel, o pedágio, a refeição. Os abastecimentos com litros são o que deixam o app calcular o diesel dos seus fretes."
                  />
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
                        {i.pendente && <Pendente />}
                      </View>
                      <Text className="text-sm text-muted-foreground">
                        {dia(i.data)}
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
                      <Pressable onPress={() => void apagarGasto(i)} hitSlop={10}>
                        <Trash2 size={18} color="#64748b" />
                      </Pressable>
                    )}
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Pendente() {
  return (
    <View className="flex-row items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
      <CloudOff size={12} color="#b45309" />
      <Text className="text-xs font-semibold text-amber-700">Vai subir depois</Text>
    </View>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <View className="rounded-2xl border-2 border-dashed border-border p-6">
      <Text className="text-center text-base font-semibold text-foreground">{titulo}</Text>
      <Text className="mt-1 text-center text-sm text-muted-foreground">{texto}</Text>
    </View>
  );
}

function Resumo({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <View className={`flex-1 rounded-xl p-3 ${destaque ? "bg-white/20" : "bg-white/10"}`}>
      <Text className="text-xs font-medium uppercase tracking-wide text-white/70">{rotulo}</Text>
      <Text className="mt-0.5 text-base font-bold text-white">{valor}</Text>
    </View>
  );
}

function FormGasto({ onCancelar, onPronto }: { onCancelar: () => void; onPronto: () => void }) {
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
            Com os litros o app calcula seu consumo — e é ele que estima o diesel dos fretes.
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
