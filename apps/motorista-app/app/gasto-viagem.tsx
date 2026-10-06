import { router, Stack, useLocalSearchParams } from "expo-router";
import { ChevronRight, Fuel, ListChecks, Route } from "lucide-react-native";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { BotaoAcao, IconeTipo, SemGastoDeViagem } from "@/components/gastos";
import { usePermite } from "@/lib/acessos-app";
import { useModuloDespesas, useTiposDespesa } from "@/lib/gastos";
import { useMe } from "@/lib/queries";

/**
 * [A] "O que você pagou?" — LISTA DE NAVEGAÇÃO, não seletor: um toque escolhe
 * e já abre o formulário certo. Nada destacado ao abrir, ordem fixa do painel
 * (nunca por uso), "Outro" sempre por último.
 *
 * Aberta de dentro de uma viagem (`viagemClientId`): só os tipos da empresa —
 * pedágio já é o campo da tela anterior e abastecimento não tem viagem.
 */
export default function GastoViagem() {
  const params = useLocalSearchParams<{
    viagemClientId?: string;
    viagemRotulo?: string;
    veiculoId?: string;
  }>();
  const daViagem = !!params.viagemClientId;
  const modulo = useModuloDespesas();
  const me = useMe();
  const tipos = useTiposDespesa();
  const permitePedagio = usePermite("app.pedagio.lancar");
  const permiteAbastecimento = usePermite("app.abastecimento.lancar");
  const pedagio = !daViagem && (me.data?.podeLancarPedagio ?? false) && permitePedagio;
  const abastecimento =
    !daViagem && (me.data?.podeLancarAbastecimento ?? false) && permiteAbastecimento;

  const titulo = daViagem ? "Gasto desta viagem" : "Gasto de viagem";
  if (!modulo.lancar) return <SemGastoDeViagem titulo={titulo} />;

  // Contexto da viagem vai junto pro formulário; `voltar` = quantas telas
  // fechar depois de salvar pra cair de volta onde ele estava.
  const ctx: Record<string, string> = { voltar: "2" };
  if (params.viagemClientId) ctx.viagemClientId = params.viagemClientId;
  if (params.viagemRotulo) ctx.viagemRotulo = params.viagemRotulo;
  if (params.veiculoId) ctx.veiculoId = params.veiculoId;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={titulo} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
        <View className="gap-1">
          <Text className="text-2xl font-bold text-foreground">O que você pagou?</Text>
          <Text className="text-sm text-muted-foreground">
            Vai pro escritório e volta pra você no acerto.
          </Text>
        </View>

        {/* No topo, não no rodapé: é aqui que ele procura o que já lançou. */}
        {!daViagem && modulo.acompanhar ? (
          <BotaoAcao Icone={ListChecks} onPress={() => router.push("/meus-reembolsos")}>
            Ver meus gastos
          </BotaoAcao>
        ) : null}

        {pedagio || abastecimento ? (
          <Grupo>
            {pedagio ? (
              <Linha
                icone={<IconeSistema Icone={Route} />}
                nome="Pedágio"
                onPress={() => router.push("/novo-pedagio")}
              />
            ) : null}
            {pedagio && abastecimento ? <Divisor /> : null}
            {abastecimento ? (
              <Linha
                icone={<IconeSistema Icone={Fuel} />}
                nome="Abastecimento"
                onPress={() => router.push("/novo-abastecimento")}
              />
            ) : null}
          </Grupo>
        ) : null}

        {!tipos.chegaram ? (
          <View className="gap-3 rounded-2xl border-2 border-dashed border-border p-4">
            <Text className="text-base text-foreground">
              Os tipos de gasto do escritório ainda não chegaram neste celular. Quando pegar
              sinal, eles aparecem aqui.
            </Text>
            <Button variant="outline" onPress={tipos.tentarAgora} loading={tipos.carregando}>
              Tentar agora
            </Button>
          </View>
        ) : tipos.daEmpresa.length > 0 ? (
          <Grupo>
            {tipos.daEmpresa.map((t, i) => (
              <View key={t.id}>
                {i > 0 ? <Divisor /> : null}
                <Linha
                  icone={<IconeTipo icone={t.icone} slug={t.slug} />}
                  nome={t.nome}
                  sub={t.reembolsa ? undefined : "Por sua conta"}
                  onPress={() =>
                    router.push({ pathname: "/gasto-novo", params: { ...ctx, tipoId: t.id } })
                  }
                />
              </View>
            ))}
          </Grupo>
        ) : null}

        {daViagem ? (
          <Text className="text-sm text-muted-foreground">
            Pedágio desta viagem: use o campo Pedágio da tela anterior.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Grupo({ children }: { children: React.ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border-2 border-border bg-card">{children}</View>
  );
}

function Divisor() {
  return <View className="ml-[72px] h-px bg-border" />;
}

function IconeSistema({ Icone }: { Icone: typeof Route }) {
  return (
    <View className="h-10 w-10 items-center justify-center rounded-xl bg-sky-100">
      <Icone size={22} color="#13316b" strokeWidth={2.2} />
    </View>
  );
}

function Linha({
  icone,
  nome,
  sub,
  onPress,
}: {
  icone: React.ReactNode;
  nome: string;
  sub?: string;
  onPress: ComponentProps<typeof Pressable>["onPress"];
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-4 px-4 active:bg-muted"
      style={{ minHeight: 64 }}
    >
      {icone}
      <View className="flex-1 py-2">
        <Text className="text-lg font-semibold text-foreground">{nome}</Text>
        {sub ? <Text className="text-[13px] text-muted-foreground">{sub}</Text> : null}
      </View>
      <ChevronRight size={22} color="#64748b" />
    </Pressable>
  );
}
