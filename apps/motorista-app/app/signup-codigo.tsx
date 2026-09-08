import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCpf } from "@ronan/shared-types";
import { showAlert } from "@/lib/alert";
import { api, humanizeApiError } from "@/lib/api";
import { setAuthState } from "@/lib/auth-state";
import { setCadastroStatus } from "@/lib/cadastro-status";
import { marcarEmpresaEscolhida, salvarSessoesDoLogin } from "@/lib/sessoes";

const COOLDOWN_S = 60;

function mascararCelular(c: string): string {
  // Mostra só os 4 últimos dígitos: (..) ....-1234
  const d = c.replace(/\D/g, "");
  if (d.length < 4) return c;
  return `••••-${d.slice(-4)}`;
}

export default function SignupCodigoScreen() {
  const params = useLocalSearchParams<{
    cpf?: string;
    celular?: string;
    /** Máscara do número pra onde o código foi de verdade (vem do backend). */
    destino?: string;
    reivindicacao?: string;
  }>();
  const cpf = params.cpf ?? "";
  const celular = params.celular ?? "";
  // Ele já tinha cadastro criado pela empresa: o código foi pro número que ELA
  // tem em ficha, que pode não ser o que ele acabou de digitar. Sem dizer isso,
  // ele fica olhando pro WhatsApp errado.
  const reivindicacao = params.reivindicacao === "1";
  const [destino, setDestino] = useState(params.destino ?? "");

  const [codigo, setCodigo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(COOLDOWN_S);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function confirmar() {
    setErro(null);
    if (codigo.trim().length !== 6) return setErro("Digite os 6 dígitos do código.");
    setSubmitting(true);
    try {
      const res = await api.confirmarCadastro({ cpf, codigo: codigo.trim() });
      const cadastros = res.cadastros ?? [];
      if (cadastros.length > 0) {
        // Reivindicou o cadastro que a empresa já tinha: entra direto nela.
        await salvarSessoesDoLogin(cadastros, cadastros[0]!.motoristaId);
        marcarEmpresaEscolhida();
        setCadastroStatus(cadastros[0]!.status);
      }
      // Sem empresa nenhuma ele entra do mesmo jeito: a sessão da PESSOA já foi
      // guardada pelo cliente de API, e o app abre no modo sem empresa.
      setAuthState(true);
      if (cadastros.length > 0 && reivindicacao) {
        void showAlert({
          title: `Bem-vindo à ${cadastros[0]!.contaNome}`,
          message:
            "Você já tinha cadastro nessa empresa. Agora a senha é a que você acabou de escolher.",
        });
      }
      router.replace("/");
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function reenviar() {
    if (cooldown > 0) return;
    setErro(null);
    setReenviando(true);
    try {
      const res = await api.reenviarCodigoCadastro(cpf);
      if (res.destinoMascarado) setDestino(res.destinoMascarado);
      setCodigo("");
      setCooldown(COOLDOWN_S);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setReenviando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView
        behavior="padding"
        className="flex-1"
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="bg-brand px-6 pb-8 pt-16">
            <Text className="text-4xl font-extrabold tracking-tight text-white">
              Confirme o código
            </Text>
            <Text className="mt-2 text-base font-medium text-white/80">
              Enviamos um código no WhatsApp {destino || (celular ? mascararCelular(celular) : "")}
            </Text>
          </View>

          <View className="flex-1 gap-6 px-6 py-8">
            {cpf ? (
              <Text className="text-base text-muted-foreground">
                Cadastro do CPF {formatCpf(cpf)}
              </Text>
            ) : null}

            {reivindicacao && (
              <View className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                <Text className="text-base font-semibold text-amber-900">
                  Você já tem cadastro numa empresa
                </Text>
                <Text className="mt-1 text-base text-amber-900">
                  Por segurança, o código foi pro número que ela tem no seu cadastro
                  {destino ? ` (${destino})` : ""} — não pro que você digitou agora. Se esse
                  número não é mais seu, peça pro administrativo dela atualizar.
                </Text>
              </View>
            )}

            <View className="gap-2">
              <Label>Código de 6 dígitos</Label>
              <Input
                value={codigo}
                onChangeText={(v) => setCodigo(v.replace(/\D/g, "").slice(0, 6))}
                keyboardType="numeric"
                placeholder="000000"
                className="text-center text-2xl tracking-[8px]"
                maxLength={6}
                editable={!submitting}
              />
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            <Button size="lg" className="h-16" loading={submitting} onPress={confirmar}>
              <Text className="text-lg font-bold text-primary-foreground">
                {submitting ? "Confirmando..." : "Confirmar"}
              </Text>
            </Button>

            <Pressable onPress={reenviar} disabled={cooldown > 0 || reenviando} className="py-2">
              <Text
                className={
                  cooldown > 0
                    ? "text-center text-base font-medium text-muted-foreground"
                    : "text-center text-base font-semibold text-brand"
                }
              >
                {reenviando
                  ? "Reenviando..."
                  : cooldown > 0
                    ? `Não recebi — reenviar em ${cooldown}s`
                    : "Não recebi — reenviar código"}
              </Text>
            </Pressable>

            <Pressable onPress={() => router.replace("/login")} disabled={submitting} className="py-1">
              <Text className="text-center text-base font-medium text-muted-foreground">
                Voltar pro login
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
