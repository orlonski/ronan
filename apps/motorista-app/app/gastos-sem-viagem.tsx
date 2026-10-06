import { useEffect, useMemo, useRef, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Check, ListChecks, ListTodo, Undo2 } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { BotaoAcao, IconeTipo, SemGastoDeViagem } from "@/components/gastos";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  desfazerLigacao,
  diaFalado,
  diaSP,
  fmtReais,
  gastosSemViagem,
  horaSP,
  ligarGastos,
  sugerirViagem,
  useGastos,
  useModuloDespesas,
  useViagensConhecidas,
  viagensRecentes,
  type DestinoGasto,
  type GastoVisto,
  type LigacaoFeita,
  type ViagemConhecida,
} from "@/lib/gastos";

/**
 * [C2] GASTOS SEM VIAGEM — só os que ficaram SEM RESPOSTA. Quem disse "não
 * foi em viagem" não aparece (não insistir).
 *
 * Agrupado pela viagem provável: "esses três são desta viagem" é um toque,
 * sem modo de seleção. Nunca liga sozinho. Funciona offline (vai pela fila).
 *
 * Aberto pela pergunta-ponte do Finalizar (`viagemClientId` + `dia`): a
 * viagem que ele está fechando é a sugestão dos gastos daquele dia.
 */
export default function GastosSemViagem() {
  const params = useLocalSearchParams<{
    dia?: string;
    viagemClientId?: string;
    viagemRotulo?: string;
  }>();
  const modulo = useModuloDespesas();
  const { gastos } = useGastos();
  const viagens = useViagensConhecidas();
  const [umPorUm, setUmPorUm] = useState<Record<string, boolean>>({});
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ texto: string; ligacao: LigacaoFeita } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const viagemDaPonte: ViagemConhecida | null = params.viagemClientId
    ? {
        chave: `ponte:${params.viagemClientId}`,
        viagemId: null,
        clientId: params.viagemClientId,
        rotulo: params.viagemRotulo ?? "Esta viagem",
        dia: params.dia ?? diaSP(Date.now()),
        inicio: null,
        emAndamento: true,
        veiculoId: null,
        placa: null,
      }
    : null;

  const soltos = useMemo(() => {
    const l = gastosSemViagem(gastos);
    return params.dia ? l.filter((g) => g.dia === params.dia) : l;
  }, [gastos, params.dia]);

  const { comViagem, semParecida } = useMemo(() => {
    const grupos = new Map<string, { viagem: ViagemConhecida; gastos: GastoVisto[] }>();
    const sem: GastoVisto[] = [];
    for (const g of soltos) {
      const v = viagemDaPonte && g.dia === viagemDaPonte.dia ? viagemDaPonte : sugerirViagem(viagens, g.data);
      if (!v) {
        sem.push(g);
        continue;
      }
      const grupo = grupos.get(v.chave) ?? { viagem: v, gastos: [] };
      grupo.gastos.push(g);
      grupos.set(v.chave, grupo);
    }
    return { comViagem: [...grupos.values()], semParecida: sem };
  }, [soltos, viagens, viagemDaPonte]);

  const opcoesViagem: SelectOption[] = useMemo(
    () =>
      viagensRecentes(viagens, 15).map((v) => ({
        value: v.chave,
        label: `${diaFalado(v.dia)} · ${v.rotulo}`,
        sublabel: v.placa ?? undefined,
      })),
    [viagens],
  );

  if (!modulo.lancar) return <SemGastoDeViagem titulo="Gastos sem viagem" />;

  async function aplicar(gs: GastoVisto[], destino: DestinoGasto) {
    const ligacao = await ligarGastos(gs, destino);
    const n = gs.length;
    const texto =
      destino.tipo === "viagem"
        ? `${n} ${n === 1 ? "gasto ligado" : "gastos ligados"} à viagem ${destino.viagem.rotulo}.`
        : `${n === 1 ? "Gasto marcado" : `${n} gastos marcados`} como fora de viagem.`;
    setFeito({ texto, ligacao });
    setEscolhendo(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeito(null), 10_000);
  }

  async function desfazer() {
    if (!feito) return;
    const l = feito.ligacao;
    setFeito(null);
    await desfazerLigacao(l);
  }

  function seletorDeViagem(gs: GastoVisto[]) {
    return (
      <View className="gap-2">
        <Select
          value=""
          onChange={(k) => {
            const v = viagens.find((x) => x.chave === k);
            if (v) void aplicar(gs, { tipo: "viagem", viagem: v });
          }}
          options={opcoesViagem}
          placeholder="Escolha a viagem"
          searchable
          title="Em qual viagem foi?"
          emptyMessage="Nenhuma viagem dos últimos 15 dias neste celular."
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Gastos sem viagem" />
      {feito ? (
        <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-xl bg-green-50 px-4 py-3">
          <Check size={20} color="#15803d" />
          <Text className="flex-1 text-base font-semibold text-green-900">{feito.texto}</Text>
          <BotaoAcao Icone={Undo2} size="sm" onPress={() => void desfazer()}>
            Desfazer
          </BotaoAcao>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
        <Text className="text-sm text-muted-foreground">
          Diga de qual viagem foi cada gasto. Isso ajuda o escritório a conferir.
        </Text>

        {soltos.length === 0 ? (
          <View className="items-center gap-3 py-8">
            <Text className="text-center text-base text-foreground">
              Todos os seus gastos estão com a viagem certa.
            </Text>
            <BotaoAcao
              Icone={ListChecks}
              className="self-stretch"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/meus-reembolsos"))}
            >
              Ver meus gastos
            </BotaoAcao>
          </View>
        ) : null}

        {comViagem.length > 0 ? (
          <Text className="text-xs font-bold tracking-wider text-muted-foreground">PARECEM DA VIAGEM</Text>
        ) : null}
        {comViagem.map(({ viagem, gastos: gs }) => (
          <View key={viagem.chave} className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
            <View>
              <Text className="text-base font-bold text-foreground">{viagem.rotulo}</Text>
              <Text className="text-sm text-muted-foreground">
                {diaFalado(viagem.dia)}
                {viagem.inicio ? ` · desde ${horaSP(viagem.inicio)}` : ""}
                {viagem.placa ? ` · ${viagem.placa}` : ""}
              </Text>
            </View>
            <View className="h-px bg-border" />
            {gs.map((g) => (
              <View key={g.chave} className="gap-2">
                <View className="flex-row items-center gap-3">
                  <IconeTipo icone={g.tipoIcone} tamanho={32} />
                  <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                    {g.tipoNome} {horaSP(g.data)}
                  </Text>
                  <Text className="text-base font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                    {fmtReais(g.valorInformado)}
                  </Text>
                </View>
                {umPorUm[viagem.chave] ? (
                  escolhendo === g.chave ? (
                    seletorDeViagem([g])
                  ) : (
                    <View className="flex-row gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onPress={() => void aplicar([g], { tipo: "viagem", viagem })}
                      >
                        Ligar a esta
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" onPress={() => setEscolhendo(g.chave)}>
                        Outra viagem
                      </Button>
                    </View>
                  )
                ) : null}
              </View>
            ))}
            {!umPorUm[viagem.chave] ? (
              <>
                <View className="h-px bg-border" />
                <Button onPress={() => void aplicar(gs, { tipo: "viagem", viagem })}>
                  {gs.length === 1 ? "Ligar a esta viagem" : `Ligar os ${gs.length} a esta viagem`}
                </Button>
                <BotaoAcao
                  Icone={ListTodo}
                  onPress={() => setUmPorUm((m) => ({ ...m, [viagem.chave]: true }))}
                >
                  Escolher um por um
                </BotaoAcao>
              </>
            ) : null}
          </View>
        ))}

        {semParecida.length > 0 ? (
          <Text className="text-xs font-bold tracking-wider text-muted-foreground">SEM VIAGEM PARECIDA</Text>
        ) : null}
        {semParecida.map((g) => (
          <View key={g.chave} className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
            <View className="flex-row items-center gap-3">
              <IconeTipo icone={g.tipoIcone} tamanho={32} />
              <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                {g.tipoNome} · {diaFalado(g.dia)}
              </Text>
              <Text className="text-base font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                {fmtReais(g.valorInformado)}
              </Text>
            </View>
            {escolhendo === g.chave ? (
              seletorDeViagem([g])
            ) : (
              <View className="flex-row gap-2">
                <Button variant="outline" className="flex-1" onPress={() => setEscolhendo(g.chave)}>
                  Escolher viagem
                </Button>
                <Button variant="outline" className="flex-1" onPress={() => void aplicar([g], { tipo: "fora" })}>
                  Não foi em viagem
                </Button>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
