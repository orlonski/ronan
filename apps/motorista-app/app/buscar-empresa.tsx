import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Building2, CheckCircle2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, humanizeApiError, type EmpresaBusca } from "@/lib/api";

/**
 * Ele procura a empresa pelo nome e pede pra entrar.
 *
 * Não é onde o cadastro começa: só chega aqui quem já tem conta e roda pra uma
 * empresa que ainda não o chamou. A empresa decide — o pedido chega pra ela como
 * "aguardando aprovação". Só aparecem as que escolheram aparecer.
 */
export default function BuscarEmpresaScreen() {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<EmpresaBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState<string | null>(null);
  const [enviadas, setEnviadas] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = termo.trim();
    if (q.length < 3) {
      setLista([]);
      setErro(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    timer.current = setTimeout(async () => {
      const minha = ++seq.current;
      try {
        const r = await api.buscarEmpresas(q);
        if (minha !== seq.current) return;
        setLista(r);
        setErro(null);
      } catch (e) {
        if (minha !== seq.current) return;
        setLista([]);
        setErro(humanizeApiError(e));
      } finally {
        if (minha === seq.current) setBuscando(false);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [termo]);

  async function pedir(e: EmpresaBusca) {
    setPedindo(e.id);
    setErro(null);
    try {
      await api.pedirEntradaEmpresa(e.id);
      setEnviadas((a) => [...a, e.id]);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setPedindo(null);
    }
  }

  const semResultado = termo.trim().length >= 3 && !buscando && !erro && lista.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2">
            <Text className="text-2xl font-bold text-foreground">Procure sua empresa</Text>
            <Text className="text-base leading-6 text-muted-foreground">
              Digite o nome da transportadora pra quem você roda. Ela recebe seu pedido e,
              aceitando, você passa a lançar suas viagens pra ela.
            </Text>
          </View>

          <Input
            value={termo}
            onChangeText={setTermo}
            placeholder="Nome da empresa"
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
          />

          {buscando && <Text className="text-sm text-muted-foreground">Procurando…</Text>}
          {erro && <Text className="text-sm text-destructive">{erro}</Text>}

          {lista.map((e) => {
            const enviado = enviadas.includes(e.id);
            return (
              <View key={e.id} className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
                <View className="flex-row items-center gap-3">
                  <Building2 size={22} color="#0f172a" />
                  <View className="flex-1">
                    <Text className="text-lg font-bold text-foreground">{e.nome}</Text>
                    {e.local ? <Text className="text-sm text-muted-foreground">{e.local}</Text> : null}
                  </View>
                </View>
                {enviado ? (
                  <View className="flex-row items-center gap-2">
                    <CheckCircle2 size={20} color="#16a34a" />
                    <Text className="flex-1 text-base font-semibold text-foreground">
                      Pedido enviado. Agora é com a empresa — você avisa quando ela aceitar.
                    </Text>
                  </View>
                ) : (
                  <Button
                    size="lg"
                    className="bg-green-600"
                    loading={pedindo === e.id}
                    disabled={pedindo !== null}
                    onPress={() => void pedir(e)}
                  >
                    <Text className="text-lg font-bold text-white">Pedir pra entrar</Text>
                  </Button>
                )}
              </View>
            );
          })}

          {semResultado && (
            <View className="gap-1">
              <Text className="text-base font-semibold text-foreground">Não achei essa empresa</Text>
              <Text className="text-sm leading-5 text-muted-foreground">
                Nem toda empresa aparece aqui. Peça pra ela te cadastrar pelo seu CPF — o
                convite chega no seu app.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
