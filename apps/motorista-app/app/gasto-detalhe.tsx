import { useMemo, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { ScreenHeader } from "@/components/screen-header";
import { FotoDaDespesa, SemGastoDeViagem, StatusGasto } from "@/components/gastos";
import { ErroCampo } from "@/components/validacao-guiada";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { humanizeApiError } from "@/lib/api";
import { apagarDespesa } from "@/lib/despesas";
import {
  diaFalado,
  fmtReais,
  horaSP,
  ligarGastos,
  useGastos,
  useModuloDespesas,
  useViagensConhecidas,
  viagensRecentes,
} from "@/lib/gastos";

/**
 * [E2] DETALHE DO GASTO já enviado: foto (abre grande na própria tela),
 * valor, status e os dados. Enquanto o escritório não decidiu: "Corrigir" e
 * "Apagar" (confirmação INLINE, nunca showConfirm). Depois: só ler.
 *
 * Trocar a viagem funciona offline (vai pela fila); corrigir e apagar falam
 * com o servidor na hora (o escritório pode estar decidindo agora).
 */
export default function GastoDetalhe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const modulo = useModuloDespesas();
  const { gastos, query } = useGastos({ enabled: modulo.acompanhar || modulo.lancar });
  const viagens = useViagensConhecidas();
  const qc = useQueryClient();
  const g = gastos.find((x) => x.despesaId === id);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [trocandoViagem, setTrocandoViagem] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoesViagem: SelectOption[] = useMemo(
    () =>
      viagensRecentes(viagens, 15).map((v) => ({
        value: v.chave,
        label: `${diaFalado(v.dia)} · ${v.rotulo}`,
        sublabel: v.placa ?? undefined,
      })),
    [viagens],
  );

  if (!modulo.acompanhar && !modulo.lancar) return <SemGastoDeViagem titulo="Gasto" />;

  if (!g || !g.servidor) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Gasto" />
        <View className="flex-1 items-center justify-center gap-4 p-6">
          {query.isLoading ? (
            <ActivityIndicator />
          ) : (
            <>
              <Text className="text-center text-base text-foreground">
                Esse gasto não está mais na sua lista.
              </Text>
              <Button variant="outline" onPress={() => router.back()}>
                Voltar
              </Button>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const d = g.servidor;
  const podeMexer = g.editavel && modulo.lancar;

  async function apagar() {
    if (apagando) return;
    setApagando(true);
    setErro(null);
    try {
      await apagarDespesa(d.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await qc.invalidateQueries({ queryKey: ["despesas"] });
      router.back();
    } catch (err) {
      setErro(`Não deu pra apagar agora. ${humanizeApiError(err)}`);
      setConfirmandoApagar(false);
    } finally {
      setApagando(false);
    }
  }

  const pares: [string, React.ReactNode][] = [
    ["Quando", `${diaFalado(g.dia)}, ${horaSP(g.data)}`],
    [
      "Viagem",
      <Text key="v" className="text-[15px] text-foreground">
        {g.viagemRotulo ?? (g.naoFoiEmViagem ? "Fora de viagem" : "Sem viagem")}
        {modulo.lancar && d.situacao !== "NO_ACERTO" && d.situacao !== "PAGO" ? (
          <>
            {" · "}
            <Text className="font-semibold text-brand" onPress={() => setTrocandoViagem(true)}>
              Trocar
            </Text>
          </>
        ) : null}
      </Text>,
    ],
  ];
  if (d.veiculo) pares.push(["Caminhão", d.veiculo.placa]);
  if (d.descricao) pares.push(["O que foi", d.descricao]);
  if (d.onde) pares.push(["Onde", d.onde]);
  if (d.litros != null) pares.push(["Litros", String(d.litros).replace(".", ",")]);
  if (d.odometro != null) pares.push(["Odômetro", `${d.odometro} km`]);
  if (d.semComprovanteMotivo) pares.push(["Sem comprovante", d.semComprovanteMotivo]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={g.tipoNome} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
        {d.fotos[0] ? (
          <FotoDaDespesa despesaId={d.id} fotoId={d.fotos[0].id} titulo={g.tipoNome} />
        ) : null}

        <View className="gap-1">
          <Text className="text-[28px] font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
            {fmtReais(g.valorInformado)}
          </Text>
          <StatusGasto status={g.status} grande />
        </View>

        <View className="gap-2">
          {pares.map(([rotulo, valor]) => (
            <View key={rotulo} className="flex-row gap-3">
              <Text className="w-28 text-[15px] text-muted-foreground">{rotulo}</Text>
              <View className="flex-1">
                {typeof valor === "string" ? (
                  <Text className="text-[15px] text-foreground">{valor}</Text>
                ) : (
                  valor
                )}
              </View>
            </View>
          ))}
        </View>

        {trocandoViagem ? (
          <View className="gap-2 rounded-2xl border-2 border-border p-4">
            <Text className="text-base font-semibold text-foreground">Em qual viagem foi?</Text>
            <Select
              value=""
              onChange={(k) => {
                const v = viagens.find((x) => x.chave === k);
                if (!v) return;
                setTrocandoViagem(false);
                void ligarGastos([g], { tipo: "viagem", viagem: v });
              }}
              options={opcoesViagem}
              placeholder="Escolha a viagem"
              searchable
              emptyMessage="Nenhuma viagem dos últimos 15 dias neste celular."
            />
            <View className="flex-row flex-wrap gap-x-4">
              <Pressable
                onPress={() => {
                  setTrocandoViagem(false);
                  void ligarGastos([g], { tipo: "fora" });
                }}
                className="min-h-[44px] justify-center"
                accessibilityRole="link"
              >
                <Text className="text-[15px] font-semibold text-brand">Não foi em viagem</Text>
              </Pressable>
              <Pressable
                onPress={() => setTrocandoViagem(false)}
                className="min-h-[44px] justify-center"
                accessibilityRole="link"
              >
                <Text className="text-[15px] font-semibold text-brand">Deixar como está</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {erro ? <ErroCampo msg={erro} /> : null}

        {podeMexer ? (
          confirmandoApagar ? (
            <View className="gap-3 rounded-2xl border-2 border-border p-4">
              <Text className="text-base font-semibold text-foreground">
                Apagar o gasto de {g.tipoNome} de {fmtReais(g.valorInformado)}? Ele sai do escritório também.
              </Text>
              <Button variant="destructive" onPress={() => void apagar()} loading={apagando}>
                Apagar gasto
              </Button>
              <Button variant="outline" onPress={() => setConfirmandoApagar(false)}>
                Manter
              </Button>
            </View>
          ) : (
            <>
              <Button
                size="lg"
                className="h-20"
                onPress={() =>
                  router.push({
                    pathname: "/gasto-novo",
                    params: { tipoId: g.tipoId ?? "", despesaId: d.id },
                  })
                }
              >
                <Text className="text-xl font-bold text-primary-foreground">Corrigir gasto</Text>
              </Button>
              <Pressable
                onPress={() => setConfirmandoApagar(true)}
                className="min-h-[44px] items-center justify-center"
                accessibilityRole="button"
              >
                <Text className="text-base font-medium text-destructive">Apagar este gasto</Text>
              </Pressable>
            </>
          )
        ) : !g.editavel ? (
          <Text className="text-sm text-muted-foreground">
            O escritório já decidiu este gasto. Pra mudar, fale com o escritório.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
