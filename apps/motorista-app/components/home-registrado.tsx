import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowRight, Building2, CalendarDays, Check, Clock, Receipt } from "lucide-react-native";
import { usePontoHoje } from "@/lib/queries";
import { hojeISO } from "@/lib/datetime";
import { usePendingPonto } from "@/hooks/use-pending-ponto";
import { assinarVinculoRegistrado, vinculoRegistradoSync } from "@/lib/vinculo-registrado";

/**
 * A HOME DE QUEM É REGISTRADO EM CARTEIRA e não dirige pra empresa.
 *
 * Mecânico, escritório, ajudante — gente que a transportadora contratou e que
 * usa o app pra uma coisa só: registrar a jornada.
 *
 * ⚠️ Ela existe porque essas pessoas caíam na home do AUTÔNOMO. O app decidia
 * a casa por "tem cadastro de motorista em alguma empresa?", e a resposta
 * delas é não — então abriam o app e viam calculadora de frete, "a receber" e
 * convite de empresa. Nada errado por acaso: estava tudo certo pra outra
 * pessoa.
 *
 * ⚠️ O que esta tela NÃO tem, de propósito: holerite, banco de horas, escala
 * prevista e aviso do RH. Nada disso existe no produto hoje, e um card que
 * promete o que o sistema não faz é pior que a ausência dele — foi a primeira
 * coisa que o QA do Instagram barrou, pelo mesmo motivo.
 *
 * ⚠️ E não tem botão de registrar jornada AQUI. O registro mora na aba dele,
 * com a fricção de segurar 1,2 s que existe porque batida errada não se apaga.
 * Um segundo botão em outra tela seria um segundo jeito de errar. Esta tela
 * responde a pergunta que vem ANTES: "já bati hoje?".
 */
export function HomeRegistrado() {
  const vinculo = useSyncExternalStore(
    assinarVinculoRegistrado,
    vinculoRegistradoSync,
    () => undefined,
  );
  const hoje = usePontoHoje(hojeISO());
  const [puxando, setPuxando] = useState(false);
  const naFila = usePendingPonto();
  const esperando = naFila.filter((p) => p.status !== "error").length;

  const funcionario = hoje.data?.funcionario ?? null;
  const marcacoes = hoje.data?.marcacoes ?? [];
  const total = marcacoes.length + esperando;
  const ultima = marcacoes[marcacoes.length - 1];

  const empresa = vinculo?.contaNome ?? funcionario?.empresa ?? null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}
        refreshControl={
          /* O spinner é do GESTO dele: `refreshing` fixo em false nunca mostra
             que algo está acontecendo, e ligado à query prende o spinner no
             iOS quando a revalidação automática roda sozinha. */
          <RefreshControl
            refreshing={puxando}
            onRefresh={async () => {
              setPuxando(true);
              try {
                await hoje.refetch();
              } finally {
                setPuxando(false);
              }
            }}
          />
        }
      >
        <View>
          <Text className="text-2xl font-bold text-foreground">
            {primeiroNome(funcionario?.nome) ?? "Olá"}
          </Text>
          {/* Quem o registrou, e desde quando, vem do cadastro — o app não
              inventa nome de empresa nem cargo. */}
          <Text className="mt-0.5 text-base text-muted-foreground">
            {empresa ? `Registrado na ${empresa}` : "Registrado em carteira"}
            {funcionario?.cargo ? ` · ${funcionario.cargo}` : ""}
          </Text>
        </View>

        {/* O HERÓI é a resposta, não a ação: "já bati hoje?" é o que ele abre o
            app pra saber. O verbo fica na aba, que é onde se bate. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir a jornada de hoje"
          onPress={() => router.push("/ponto")}
          className="overflow-hidden rounded-2xl bg-primary active:opacity-85"
        >
          <View className="flex-row items-center gap-4 p-5">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
              {total > 0 ? (
                <Check size={32} color="white" strokeWidth={2.5} />
              ) : (
                <Clock size={32} color="white" strokeWidth={2.5} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-2xl font-extrabold text-primary-foreground">
                {total === 0
                  ? "Nenhum registro hoje"
                  : total === 1
                    ? "1 registro hoje"
                    : `${total} registros hoje`}
              </Text>
              <Text className="mt-0.5 text-base font-medium text-primary-foreground/85">
                {esperando > 0
                  ? `${esperando} esperando sinal · toque pra ver`
                  : ultima
                    ? `Último às ${hora(ultima.marcadoEm)} · toque pra registrar`
                    : "Toque pra registrar"}
              </Text>
            </View>
            <ArrowRight size={26} color="white" strokeWidth={2.5} />
          </View>
        </Pressable>

        <Atalho
          icone={<CalendarDays size={22} color="#13316b" />}
          titulo="Meu espelho"
          descricao="Seus registros do mês, dia a dia"
          onPress={() => router.push("/meu-espelho")}
        />

        {/* O caderno é DELE, não da empresa: gasto do próprio bolso não deixa
            de existir porque a pessoa tem carteira assinada. */}
        <Atalho
          icone={<Receipt size={22} color="#13316b" />}
          titulo="Meu caderno"
          descricao="Seus gastos e recebimentos por fora"
          onPress={() => router.push("/meus-gastos")}
        />

        {/* Ele pode ser convidado como motorista por outra empresa — e aí passa
            a ter as duas coisas. O banner é o mesmo da home de quem não tem
            empresa. */}
        <Atalho
          icone={<Building2 size={22} color="#13316b" />}
          titulo="Convites"
          descricao="Se alguma transportadora te chamar, aparece aqui"
          onPress={() => router.push("/convites")}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Atalho({
  icone,
  titulo,
  descricao,
  onPress,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titulo}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">{icone}</View>
      <View className="flex-1">
        <Text className="text-base font-bold text-foreground">{titulo}</Text>
        <Text className="text-sm text-muted-foreground">{descricao}</Text>
      </View>
      <ArrowRight size={20} color="#64748b" />
    </Pressable>
  );
}

function primeiroNome(nome: string | null | undefined): string | null {
  if (!nome) return null;
  return nome.trim().split(/\s+/)[0] ?? null;
}

/** Hora do registro no fuso do aparelho — é a mesma que ele viu ao bater. */
function hora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
