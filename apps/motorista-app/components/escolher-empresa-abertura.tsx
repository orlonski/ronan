import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react-native";
import { MovatruckLogo } from "@/components/movatruck-logo";
import { marcarEmpresaEscolhida, motoristaAtivoId } from "@/lib/sessoes";
import { sessoesComPendentes, trocarEmpresa } from "@/lib/troca-empresa";

type Linha = { motoristaId: string; contaNome: string; pendentes: number };

/**
 * Tela de abertura de quem roda pra mais de uma empresa: pra qual vai trabalhar
 * hoje.
 *
 * Aparece uma vez por abertura do app, antes de qualquer tela — o motorista pode
 * carregar de dia pra uma e de noite pra outra, e lançar viagem na empresa
 * errada é um estrago chato de desfazer. Quem tem uma empresa só nunca vê isto.
 */
export function EscolherEmpresaAbertura() {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [indo, setIndo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [lista, atual] = await Promise.all([sessoesComPendentes(), motoristaAtivoId()]);
      if (!vivo) return;
      setLinhas(
        lista.map((s) => ({
          motoristaId: s.motoristaId,
          contaNome: s.contaNome || "Empresa",
          pendentes: s.pendentes,
        })),
      );
      setAtiva(atual);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function escolher(motoristaId: string) {
    setIndo(motoristaId);
    setErro(null);
    try {
      await trocarEmpresa(qc, motoristaId);
      marcarEmpresaEscolhida();
    } catch {
      // Não entrou na empresa (faltou o token dela e não deu pra pedir outro
      // agora). Segue perguntando: passar direto abriria o app na empresa
      // errada — justamente o que esta tela existe pra impedir.
      setErro("Não deu pra abrir essa empresa agora. Veja sua internet e tente de novo.");
      setIndo(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="bg-brand px-6 pb-8 pt-16">
        <MovatruckLogo />
        <Text className="mt-2 text-base font-medium text-white/80">
          Bom dia! Vamos começar.
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
        <Text className="text-2xl font-bold text-foreground">
          Você vai rodar pra quem hoje?
        </Text>
        <Text className="mb-2 text-base text-muted-foreground">
          Tudo que você lançar vai pra empresa escolhida. Dá pra trocar depois, lá no topo da
          tela inicial.
        </Text>

        {erro && (
          <View className="rounded-2xl border-2 border-destructive/50 bg-destructive/10 p-4">
            <Text className="text-base font-medium text-foreground">{erro}</Text>
          </View>
        )}

        {linhas.map((l) => (
          <Pressable
            key={l.motoristaId}
            onPress={() => void escolher(l.motoristaId)}
            disabled={indo !== null}
            className={`flex-row items-center gap-3 rounded-2xl border-2 p-5 active:opacity-75 ${
              l.motoristaId === ativa ? "border-brand bg-brand/10" : "border-border bg-card"
            }`}
          >
            <Building2 size={26} color="#1e3a8a" />
            <View className="flex-1">
              <Text className="text-xl font-bold text-foreground">{l.contaNome}</Text>
              {l.pendentes > 0 && (
                <Text className="mt-0.5 text-sm font-medium text-warning-foreground">
                  {l.pendentes === 1
                    ? "1 lançamento esperando pra subir"
                    : `${l.pendentes} lançamentos esperando pra subir`}
                </Text>
              )}
            </View>
            {indo === l.motoristaId && (
              <Text className="text-sm text-muted-foreground">abrindo…</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
