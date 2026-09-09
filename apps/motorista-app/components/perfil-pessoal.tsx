import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FileText,
  KeyRound,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  Truck,
  User,
  X,
} from "lucide-react-native";
import { formatCpf, formatTelefone } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type MeuPerfil } from "@/lib/api";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { clearCadastroStatus } from "@/lib/cadastro-status";
import { showAlert, showConfirm } from "@/lib/alert";

const URL_PRIVACIDADE = "https://app.movatruck.com.br/politica-de-privacidade";

/**
 * O perfil de quem trabalha por conta própria.
 *
 * O perfil da empresa mostra o que ELA liberou pra ele (flags, resumo diário,
 * preferências de aviso). Aqui não há empresa: o que existe é ele — os dados,
 * as placas, os documentos e a senha, que sempre foi da pessoa.
 */
export function PerfilPessoal() {
  const [perfil, setPerfil] = useState<MeuPerfil | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [placaNova, setPlacaNova] = useState("");
  const [salvandoPlaca, setSalvandoPlaca] = useState(false);
  const [apagandoConta, setApagandoConta] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      setPerfil(await api.meuPerfil());
    } catch {
      /* sem sinal: fica o que já está na tela */
    }
  }, []);

  /**
   * A rodinha do "puxar pra atualizar" só acende quando ELE puxa.
   *
   * Acender numa recarga automática deixa o spinner preso embaixo do cabeçalho
   * no iOS — o `RefreshControl` é feito pra refletir o gesto, não trabalho de
   * fundo. A revalidação do perfil roda calada; o que está na tela é o cache.
   */
  const puxarPraAtualizar = useCallback(async () => {
    setCarregando(true);
    try {
      await recarregar();
    } finally {
      setCarregando(false);
    }
  }, [recarregar]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  async function trocarSenha() {
    if (novaSenha.length < 6) {
      void showAlert({ title: "Senha muito curta", message: "Use pelo menos 6 caracteres." });
      return;
    }
    setSalvando(true);
    try {
      await api.trocarSenhaPessoa(senhaAtual, novaSenha);
      setSenhaAtual("");
      setNovaSenha("");
      setTrocando(false);
      void showAlert({ title: "Senha trocada", message: "Use a nova da próxima vez que entrar." });
    } catch (e) {
      void showAlert({ title: "Não deu pra trocar", message: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  /** Adicionar/remover placa. O endpoint existia e nenhuma tela chamava. */
  async function salvarPlacas(placas: { placa: string; modelo?: string }[]) {
    setSalvandoPlaca(true);
    try {
      setPerfil(await api.salvarMinhasPlacas(placas, perfil?.placaDefault ?? null));
      setPlacaNova("");
    } catch (e) {
      void showAlert({ title: "Não deu pra salvar a placa", message: (e as Error).message });
    } finally {
      setSalvandoPlaca(false);
    }
  }

  async function adicionarPlaca() {
    const placa = placaNova.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (placa.length < 7) {
      void showAlert({ title: "Placa incompleta", message: "Confira a placa e tente de novo." });
      return;
    }
    const atuais = perfil?.placas ?? [];
    if (atuais.some((p) => p.placa === placa)) return setPlacaNova("");
    await salvarPlacas([...atuais, { placa }]);
  }

  async function tirarPlaca(placa: string) {
    const ok = await showConfirm({
      title: `Tirar a placa ${placa}?`,
      message: "Ela some do seu perfil. Dá pra adicionar de novo depois.",
      confirmLabel: "Tirar",
      destructive: true,
    });
    if (!ok) return;
    await salvarPlacas((perfil?.placas ?? []).filter((p) => p.placa !== placa));
  }

  async function sair() {
    const ok = await showConfirm({
      title: "Sair do app?",
      message: "Seus fretes e documentos continuam guardados — é só entrar de novo.",
      confirmLabel: "Sair",
    });
    if (!ok) return;
    await clearTokens();
    await clearCadastroStatus();
    setAuthState(false);
    router.replace("/login");
  }

  /**
   * Apagar a conta.
   *
   * A App Store exige que quem cria conta no app consiga apagá-la por lá
   * (5.1.1-v) — faltar isso é recusa na triagem, antes de qualquer outra coisa
   * ser avaliada. Duas confirmações, e o texto diz o que fica: viagem rodada
   * pra transportadora é documento fiscal DELA e não some.
   */
  async function apagarConta() {
    const temEmpresa = (perfil?.empresas.length ?? 0) > 0;
    const primeira = await showConfirm({
      title: "Apagar sua conta?",
      message: temEmpresa
        ? "Some tudo que é seu: fretes por conta própria, gastos, comprovantes e documentos. Seu acesso à(s) empresa(s) é desligado. As viagens que você rodou pra elas ficam com elas — é a nota fiscal delas, não dá pra apagar."
        : "Some tudo: seus fretes, seus gastos, seus comprovantes e seus documentos. Não tem como voltar atrás.",
      confirmLabel: "Continuar",
    });
    if (!primeira) return;

    const certeza = await showConfirm({
      title: "Tem certeza mesmo?",
      message: "Isso é definitivo. Nada é recuperado depois.",
      confirmLabel: "Apagar minha conta",
      destructive: true,
    });
    if (!certeza) return;

    setApagandoConta(true);
    try {
      await api.excluirMinhaConta();
      await clearTokens();
      await clearCadastroStatus();
      setAuthState(false);
      router.replace("/login");
    } catch (e) {
      void showAlert({ title: "Não deu pra apagar", message: (e as Error).message });
    } finally {
      setApagandoConta(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      {/* Cabeçalho azul: a barra de status do iPhone é branca (ver _layout), e
          topo claro apagaria hora, sinal e bateria. */}
      <SafeAreaView edges={["top"]} className="bg-brand">
        <View className="px-4 pb-4 pt-2">
          <Text className="text-2xl font-extrabold tracking-tight text-white">Perfil</Text>
          <Text className="text-sm font-medium text-white/80">Seus dados e documentos</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={carregando} onRefresh={() => void puxarPraAtualizar()} />
        }
      >
        <Card className="gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <User size={26} color="#13316b" />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-foreground">{perfil?.nome ?? "—"}</Text>
              <Text className="text-sm text-muted-foreground">
                {perfil ? formatCpf(perfil.cpf) : ""}
                {perfil?.telefone ? ` · ${formatTelefone(perfil.telefone)}` : ""}
              </Text>
            </View>
          </View>
        </Card>

        <Card className="gap-3 p-4">
          <View className="flex-row items-center gap-2">
            <Truck size={22} color="#13316b" />
            <Text className="text-lg font-bold text-foreground">Minhas placas</Text>
          </View>
          {(perfil?.placas ?? []).map((p) => (
            <View
              key={p.placa}
              className="flex-row items-center gap-3 rounded-xl bg-secondary px-3 py-3"
            >
              <Text className="flex-1 font-mono text-base font-bold text-foreground">
                {p.placa}
              </Text>
              <Pressable
                onPress={() => void tirarPlaca(p.placa)}
                hitSlop={12}
                className="h-10 w-10 items-center justify-center rounded-full active:bg-destructive/10"
              >
                <X size={20} color="#dc2626" />
              </Pressable>
            </View>
          ))}
          <View className="flex-row items-end gap-2">
            <View className="flex-1 gap-2">
              <Label>Adicionar placa</Label>
              <Input
                value={placaNova}
                onChangeText={(v) => setPlacaNova(v.toUpperCase())}
                placeholder="ABC1D23"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!salvandoPlaca}
              />
            </View>
            <Button
              className="h-14 w-14 p-0"
              loading={salvandoPlaca}
              onPress={() => void adicionarPlaca()}
            >
              <Plus size={22} color="#fff" />
            </Button>
          </View>
        </Card>

        <Pressable
          onPress={() => router.push("/meus-documentos")}
          className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
        >
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <FileText size={26} color="#13316b" strokeWidth={2.5} />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-foreground">Meus documentos</Text>
            <Text className="text-sm text-muted-foreground">CNH, toxicológico, RNTRC, CRLV</Text>
          </View>
        </Pressable>

        {trocando ? (
          <Card className="gap-3 p-4">
            <Text className="text-lg font-bold text-foreground">Trocar senha</Text>
            <View className="gap-2">
              <Label>Senha atual</Label>
              <Input
                value={senhaAtual}
                onChangeText={setSenhaAtual}
                secureTextEntry
                editable={!salvando}
              />
            </View>
            <View className="gap-2">
              <Label>Nova senha</Label>
              <Input
                value={novaSenha}
                onChangeText={setNovaSenha}
                secureTextEntry
                editable={!salvando}
              />
            </View>
            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => setTrocando(false)}
                disabled={salvando}
              >
                <Text className="text-base font-semibold text-foreground">Cancelar</Text>
              </Button>
              <Button className="flex-1" loading={salvando} onPress={() => void trocarSenha()}>
                <Text className="text-base font-bold text-primary-foreground">Salvar</Text>
              </Button>
            </View>
          </Card>
        ) : (
          <Pressable
            onPress={() => setTrocando(true)}
            className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
          >
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <KeyRound size={26} color="#13316b" strokeWidth={2.5} />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-foreground">Trocar senha</Text>
              <Text className="text-sm text-muted-foreground">
                A senha é sua, vale em qualquer empresa que você entrar
              </Text>
            </View>
          </Pressable>
        )}

        <Pressable
          onPress={() => void Linking.openURL(URL_PRIVACIDADE).catch(() => {})}
          className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
        >
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <ShieldCheck size={26} color="#13316b" strokeWidth={2.5} />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-foreground">Política de privacidade</Text>
            <Text className="text-sm text-muted-foreground">
              O que o app guarda, por quanto tempo e por quê
            </Text>
          </View>
        </Pressable>

        <Button size="lg" variant="outline" onPress={() => void sair()}>
          <LogOut size={20} color="#0f172a" />
          <Text className="text-base font-semibold text-foreground">Sair</Text>
        </Button>

        <View className="mt-4 gap-2">
          <Button
            size="lg"
            variant="destructive"
            loading={apagandoConta}
            onPress={() => void apagarConta()}
          >
            <Trash2 size={20} color="#fff" />
            <Text className="text-base font-bold text-white">Apagar minha conta</Text>
          </Button>
          <Text className="px-2 text-center text-sm text-muted-foreground">
            Apaga a sua conta e tudo que é seu neste app. É definitivo.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
