import { useEffect, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { RequerCapacidade } from "@/components/requer-capacidade";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showAlert } from "@/lib/alert";
import { api, humanizeApiError } from "@/lib/api";

type PixAtual = {
  chavePix: string | null;
  alteradaEm: string | null;
  telefoneFinal: string | null;
  aguardandoCodigo: boolean;
};

/**
 * ONDE RECEBO: a chave Pix do acerto. Trocar é dinheiro, então a troca só
 * vale com o código que chega no WhatsApp do número do cadastro. Precisa de
 * internet (o código chega na hora) — diferente dos lançamentos, isto não vai
 * pra fila.
 */
export default function MeuPixScreen() {
  return (
    <RequerCapacidade chave="app.pix.editar" titulo="Onde recebo">
      <Conteudo />
    </RequerCapacidade>
  );
}

function Conteudo() {
  const [atual, setAtual] = useState<PixAtual | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [nova, setNova] = useState("");
  const [codigo, setCodigo] = useState("");
  const [etapa, setEtapa] = useState<"chave" | "codigo">("chave");
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    try {
      setAtual(await api.get<PixAtual>("/m/pix"));
      setErroCarga(null);
    } catch (e) {
      setErroCarga(humanizeApiError(e));
    }
  }
  useEffect(() => {
    void carregar();
  }, []);

  async function pedirCodigo() {
    if (nova.trim().length < 3) {
      await showAlert({ title: "Informe a chave Pix", message: "CPF, telefone, e-mail ou chave aleatória." });
      return;
    }
    setOcupado(true);
    try {
      await api.post("/m/pix/solicitar", { chavePix: nova.trim() });
      setEtapa("codigo");
    } catch (e) {
      await showAlert({ title: "Não consegui mandar o código", message: humanizeApiError(e), variant: "warning" });
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    setOcupado(true);
    try {
      await api.post("/m/pix/confirmar", { codigo: codigo.trim() });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await showAlert({
        title: "Chave Pix trocada",
        message: "O escritório foi avisado. Os próximos acertos vão pra essa chave.",
      });
      router.back();
    } catch (e) {
      await showAlert({ title: "Não deu certo", message: humanizeApiError(e), variant: "warning" });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Onde recebo" />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }} keyboardShouldPersistTaps="handled">
          {erroCarga ? (
            <Text className="text-base text-muted-foreground">
              Precisa de internet pra ver e trocar a chave Pix. {erroCarga}
            </Text>
          ) : !atual ? (
            <Text className="text-base text-muted-foreground">Carregando…</Text>
          ) : (
            <>
              <Card className="gap-1 p-4">
                <Text className="text-sm text-muted-foreground">Chave Pix de hoje</Text>
                <Text className="text-lg font-semibold text-foreground">
                  {atual.chavePix ?? "Nenhuma cadastrada"}
                </Text>
              </Card>

              {etapa === "chave" ? (
                <View className="gap-2">
                  <Label>Nova chave Pix</Label>
                  <Input
                    value={nova}
                    onChangeText={setNova}
                    placeholder="CPF, telefone, e-mail ou chave aleatória"
                    autoCapitalize="none"
                    maxLength={140}
                  />
                  <Text className="text-sm text-muted-foreground">
                    Pra sua segurança, mandamos um código no WhatsApp
                    {atual.telefoneFinal ? ` do número que termina em ${atual.telefoneFinal}` : " do seu cadastro"}.
                  </Text>
                  <Button onPress={() => void pedirCodigo()} loading={ocupado} disabled={ocupado}>
                    Mandar código
                  </Button>
                </View>
              ) : (
                <View className="gap-2">
                  <Label>Código que chegou no WhatsApp</Label>
                  <Input
                    value={codigo}
                    onChangeText={(t) => setCodigo(t.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6 números"
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                  <Button
                    variant="success"
                    onPress={() => void confirmar()}
                    loading={ocupado}
                    disabled={ocupado || codigo.length !== 6}
                  >
                    Confirmar troca
                  </Button>
                  <Button variant="outline" onPress={() => setEtapa("chave")} disabled={ocupado}>
                    Voltar
                  </Button>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
