import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, CloudOff } from "lucide-react-native";
import {
  ROTULO_LANCAMENTO_PESSOAL,
  TIPOS_LANCAMENTO_PESSOAL,
  ehGanho,
  type TipoLancamentoPessoal,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenHeader } from "@/components/screen-header";
import { cacheDoMes, hojeISO, lancar, mesAtual, type ItemPessoal } from "@/lib/pessoal";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Lançar um gasto — e só isso.
 *
 * Esta tela já foi "o caderno": tinha abas de fretes e gastos, botão de criar
 * frete, atalho pra documentos e um botão grande de comprovante. Virou o lugar
 * onde cabia tudo, que é o mesmo que não ser lugar de nada. Hoje a lista é a aba
 * Histórico, o documento é o Perfil, e aqui se lança um gasto.
 *
 * O tipo pode vir pronto (`?tipo=ABASTECIMENTO`): a home tem um card
 * "Abastecer", e chegar com o abastecimento já escolhido tira um toque do
 * caminho mais repetido do dia dele.
 */
export default function LancarGastoScreen() {
  const params = useLocalSearchParams<{ tipo?: string }>();
  const tipoInicial = TIPOS_LANCAMENTO_PESSOAL.includes(params.tipo as TipoLancamentoPessoal)
    ? (params.tipo as TipoLancamentoPessoal)
    : "ABASTECIMENTO";

  const [tipo, setTipo] = useState<TipoLancamentoPessoal>(tipoInicial);
  const [valor, setValor] = useState("");
  const [litros, setLitros] = useState("");
  const [odometro, setOdometro] = useState("");
  // Nasce marcado porque encher é o que se faz no posto — e porque é a marcação
  // que torna a conta de consumo possível. Quem só completou desmarca.
  const [tanqueCheio, setTanqueCheio] = useState(true);
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ultimos, setUltimos] = useState<ItemPessoal[]>([]);

  // Os últimos do mês, só pra ele conferir que o de agora entrou — e não lançar
  // o mesmo abastecimento duas vezes.
  useEffect(() => {
    void cacheDoMes(mesAtual()).then((itens) => setUltimos(itens.slice(0, 3)));
  }, []);

  async function salvar() {
    setErro(null);
    const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!valorNum || valorNum <= 0) return setErro("Informe o valor.");
    setSalvando(true);
    try {
      await lancar({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        tipo,
        data: hojeISO(),
        valor: valorNum,
        litros: tipo === "ABASTECIMENTO" && litros ? Number(litros.replace(",", ".")) : undefined,
        odometro:
          tipo === "ABASTECIMENTO" && odometro ? Number(odometro.replace(/\D/g, "")) : undefined,
        tanqueCheio: tipo === "ABASTECIMENTO" ? tanqueCheio : undefined,
        descricao: descricao.trim() || undefined,
      });
      router.back();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title="Lançar gasto"
            subtitle="Entra no seu histórico — nenhuma empresa vê"
          />

          <View className="flex-1 gap-5 px-5 py-6">
            <View className="flex-row flex-wrap gap-2">
              {TIPOS_LANCAMENTO_PESSOAL.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTipo(t)}
                  className={`rounded-xl border-2 px-4 py-3 ${
                    tipo === t ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                >
                  <Text
                    className={`text-base font-bold ${
                      tipo === t ? "text-primary" : "text-foreground"
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
                autoFocus
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
                <Text className="text-sm text-muted-foreground">
                  Com os litros o app sabe quanto você paga no litro.
                </Text>
              </View>
            )}

            {/* Odômetro + tanque cheio: é o par que mede o consumo de verdade.
                Sem eles a conta só poderia dividir o km dos fretes lançados
                pelos litros de todos os abastecimentos — dois conjuntos que não
                se falam, e um km/l com cara de medido. */}
            {tipo === "ABASTECIMENTO" && (
              <View className="gap-2">
                <Label>Odômetro (opcional)</Label>
                <Input
                  value={odometro}
                  onChangeText={(v) => setOdometro(v.replace(/[^\d]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="km do painel"
                  editable={!salvando}
                />
                <Pressable
                  onPress={() => setTanqueCheio((v) => !v)}
                  disabled={salvando}
                  className={`flex-row items-center gap-3 rounded-xl border-2 p-3 ${
                    tanqueCheio ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                >
                  <View
                    className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
                      tanqueCheio ? "border-primary bg-primary" : "border-border"
                    }`}
                  >
                    {tanqueCheio ? <Check size={16} color="white" strokeWidth={3} /> : null}
                  </View>
                  <Text className="flex-1 text-base font-semibold text-foreground">
                    Enchi o tanque
                  </Text>
                </Pressable>
                <Text className="text-sm text-muted-foreground">
                  Anotando o odômetro nos cheios, o app mede seu km/L de verdade — e é ele
                  que diz se o frete paga o diesel.
                </Text>
              </View>
            )}

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            {/* "Salvar" ANTES da observação: o campo Valor abre com o teclado em
                cima (autoFocus), e com o botão lá embaixo o lançamento mais
                repetido do dia terminava com ele procurando onde confirmar, no
                posto, com o caminhão ligado. O opcional fica depois. */}
            <Button size="lg" className="h-16" loading={salvando} onPress={salvar}>
              <Text className="text-lg font-bold text-primary-foreground">
                {salvando ? "Salvando..." : "Salvar"}
              </Text>
            </Button>

            <View className="gap-2">
              <Label>Observação (opcional)</Label>
              <Input
                value={descricao}
                onChangeText={setDescricao}
                placeholder={tipo === "ABASTECIMENTO" ? "Posto, cidade…" : "O que foi"}
                editable={!salvando}
              />
            </View>

            {ultimos.length > 0 && (
              <View className="gap-2">
                <Text className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Últimos lançamentos
                </Text>
                {ultimos.map((i) => (
                  <View
                    key={i.clientId}
                    className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3"
                  >
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="font-bold text-foreground">
                          {ROTULO_LANCAMENTO_PESSOAL[i.tipo]}
                        </Text>
                        {i.pendente && (
                          <View className="flex-row items-center gap-1 rounded-full bg-warning/15 px-2 py-1">
                            <CloudOff size={16} color="#b45309" />
                            <Text className="text-sm font-semibold text-foreground">vai subir</Text>
                          </View>
                        )}
                      </View>
                      <Text className="text-sm text-muted-foreground">
                        {i.data.split("-").reverse().join("/")}
                        {i.descricao ? ` · ${i.descricao}` : ""}
                      </Text>
                    </View>
                    <Text
                      className={`font-bold ${
                        ehGanho(i.tipo) ? "text-success" : "text-foreground"
                      }`}
                    >
                      {ehGanho(i.tipo) ? "+" : "−"} {dinheiro(i.valor)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
