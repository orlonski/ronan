import { useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { api } from "@/lib/api";
import { showAlert } from "@/lib/alert";
import { useMeuEspelhoPonto } from "@/lib/queries";
import { hojeISO } from "@/lib/datetime";

/**
 * O ESPELHO DE PONTO do mês, pra ELE conferir.
 *
 * ⚠️ É o artefato de maior valor probatório do módulo inteiro — e o que dá
 * valor a ele é a pessoa poder dizer que NÃO confere. Um botão só, escrito
 * "concordo", transforma a conferência em formalidade sem valor nenhum.
 *
 * ⚠️ O calendário vem completo, com os dias em branco. Dia que some do
 * espelho é dia que ninguém confere.
 */

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const TEXTO_ALERTA: Record<string, string> = {
  CONFERIR: "faltou fechar uma batida",
  SEM_REGISTRO: "dia de trabalho sem registro",
  FORA_DA_JORNADA: "você registrou num dia de folga",
  SEM_INTERVALO: "intervalo menor que o combinado",
};

function hm(min: number): string {
  const sinal = min < 0 ? "-" : min > 0 ? "+" : "";
  const abs = Math.abs(min);
  return `${sinal}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

function duracao(min: number): string {
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

function hora(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function mesVizinho(ym: string, passos: number): string {
  const [a, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(a!, (m ?? 1) - 1 + passos, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function MeuEspelhoScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const mesAtual = hojeISO().slice(0, 7);
  const [mes, setMes] = useState(mesAtual);
  const { data } = useMeuEspelhoPonto(mes);
  const [observacao, setObservacao] = useState("");
  const [naoConfere, setNaoConfere] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const scroll = useRef<ScrollView>(null);

  async function conferir(concorda: boolean) {
    if (!data) return;
    setEnviando(true);
    try {
      await api.post("/m/ponto/espelho/conferir", {
        competencia: mes,
        concorda,
        observacao: observacao.trim() || undefined,
        hash: data.hash,
      });
      await qc.invalidateQueries({ queryKey: ["ponto-espelho", mes] });
      setNaoConfere(false);
      setObservacao("");
      void showAlert({
        title: concorda ? "Conferido" : "Registrado",
        message: concorda
          ? "Ficou gravado que você conferiu este mês."
          : "Ficou gravado que você não concorda. O escritório vai ver.",
      });
    } catch {
      void showAlert({
        title: "Não consegui registrar",
        message: "Precisa de internet pra isso. Tente de novo quando tiver sinal.",
      });
    } finally {
      setEnviando(false);
    }
  }

  const [ano, mesNum] = mes.split("-").map(Number);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="bg-brand px-5 pb-6 pt-14">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white">Meu espelho de ponto</Text>
            <Text className="mt-0.5 text-base text-white/80">
              {NOMES_MES[(mesNum ?? 1) - 1]} de {ano}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={() => router.back()}
            className="p-2"
          >
            <X size={28} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Mesmo motivo do `corrigir-ponto`: sem isto o teclado cobre o campo de
          observação do "não confere" — e é justamente o texto que sustenta a
          discordância dele. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1" keyboardVerticalOffset={8}>
      <ScrollView
        ref={scroll}
        contentContainerClassName="p-4 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mês anterior"
            onPress={() => setMes((m) => mesVizinho(m, -1))}
            className="rounded-2xl border-2 border-border p-4"
          >
            <ChevronLeft size={28} />
          </Pressable>
          <Text className="text-base text-muted-foreground">
            {data ? `${duracao(data.totalConsideradoMin)} trabalhadas` : "—"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Próximo mês"
            disabled={mes >= mesAtual}
            onPress={() => setMes((m) => mesVizinho(m, 1))}
            className={`rounded-2xl border-2 border-border p-4 ${mes >= mesAtual ? "opacity-30" : ""}`}
          >
            <ChevronRight size={28} />
          </Pressable>
        </View>

        {data && (
          <>
            <View className="items-center rounded-3xl bg-secondary py-6">
              <Text className="text-5xl font-bold text-secondary-foreground">
                {hm(data.saldoMin)}
              </Text>
              <Text className="mt-1 text-lg text-secondary-foreground">
                {data.saldoMin === 0
                  ? "fechou certinho"
                  : data.saldoMin > 0
                    ? "a mais que o previsto"
                    : "a menos que o previsto"}
              </Text>
            </View>

            {data.diasParaConferir > 0 && (
              <View className="rounded-2xl border-2 border-warning/60 bg-warning/10 p-4">
                <Text className="text-base font-semibold text-foreground">
                  {data.diasParaConferir === 1
                    ? "1 dia precisa de conferência"
                    : `${data.diasParaConferir} dias precisam de conferência`}
                </Text>
                <Text className="mt-1 text-sm text-foreground">
                  Se algum dia está errado, peça correção — o escritório decide e fica registrado
                  quem pediu e por quê.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/corrigir-ponto")}
                  className="mt-2 items-center rounded-xl border-2 border-border bg-background py-3"
                >
                  <Text className="text-base font-semibold text-foreground">Pedir correção</Text>
                </Pressable>
              </View>
            )}

            {/* O calendário completo. Dia em branco fica, com o motivo. */}
            <View className="gap-1">
              {/* Dia que ainda não chegou fica apagado e sem saldo: no dia 5
                  do mês, mostrar o resto como dívida seria mentira. */}
              {data.dias.map((d) => {
                const pedido = data.correcoes.find(
                  (c) => c.dia === d.dia && c.status === "PENDENTE",
                );
                return (
                <Pressable
                  key={d.dia}
                  accessibilityRole="button"
                  accessibilityLabel={`Pedir correção do dia ${d.dia.slice(-2)}`}
                  disabled={d.futuro || data.fechado}
                  onPress={() => router.push(`/corrigir-ponto?dia=${d.dia}`)}
                  className={`flex-row items-center gap-3 rounded-xl border px-3 py-2 active:opacity-70 ${
                    pedido ? "border-warning/60 bg-warning/5" : "border-border"
                  } ${d.futuro ? "opacity-40" : ""}`}
                >
                  <Text className="w-10 text-base font-semibold text-foreground">
                    {d.dia.slice(-2)}
                  </Text>
                  <View className="flex-1 flex-row flex-wrap gap-1">
                    {d.pares.length === 0 && !pedido ? (
                      <Text className="text-sm text-muted-foreground">—</Text>
                    ) : (
                      d.pares.map((p, i) => (
                        <Text key={i} className="text-sm text-foreground">
                          {/* Lado a lado: o que ELE bateu e o que foi incluído
                              por correção não podem sair iguais. */}
                          <Text className={p.entradaIncluida ? "text-[#1D4ED8] font-semibold" : ""}>
                            {hora(p.entrada)}
                            {p.entradaIncluida ? "*" : ""}
                          </Text>
                          {p.saida ? (
                            <Text className={p.saidaIncluida ? "text-[#1D4ED8] font-semibold" : ""}>
                              {`–${hora(p.saida)}${p.saidaIncluida ? "*" : ""}`}
                            </Text>
                          ) : (
                            <Text> – ?</Text>
                          )}
                        </Text>
                      ))
                    )}
                    {/* O horário PEDIDO aparece junto dos outros, do jeito que
                        ele imaginou o dia — com a cara de "ainda não vale". */}
                    {pedido?.instantePretendido && (
                      <Text className="text-sm font-semibold text-[#B4501A]">
                        {hora(pedido.instantePretendido)} (pedido)
                      </Text>
                    )}
                    {d.alertas.length > 0 && (
                      <Text className="w-full text-xs text-[#B4501A]">
                        {d.alertas.map((a) => TEXTO_ALERTA[a.codigo] ?? a.codigo).join(" · ")}
                      </Text>
                    )}
                    {/* O pedido dele aparece NO DIA. Sem isto ele pede a
                        correção e o dia continua idêntico — parece que não
                        foi, e o caminho natural é pedir de novo. */}
                    {pedido && (
                      <Text className="w-full text-xs font-medium text-foreground">
                        você pediu correção · esperando o escritório
                      </Text>
                    )}
                  </View>
                  <Text
                    className={`text-sm ${d.saldoMin < 0 ? "text-[#B4501A]" : "text-muted-foreground"}`}
                  >
                    {d.futuro ? "" : hm(d.saldoMin)}
                  </Text>
                </Pressable>
                );
              })}
              <Text className="mt-1 text-xs text-muted-foreground">
                Toque num dia pra pedir correção dele.
                {data.dias.some((d) => d.pares.some((p) => p.entradaIncluida || p.saidaIncluida))
                  ? " O horário com * foi incluído por correção, não foi você que bateu."
                  : ""}
              </Text>
            </View>

            {/* MEUS PEDIDOS.

                ⚠️ Existe porque o pedido sumia da vista: ele mandava, a tela
                não mudava em lugar nenhum, e não havia como saber se tinha
                chegado nem o que o escritório decidiu. Pedir e não ver mais
                nada é o pior tipo de silêncio pra este público — e é o motivo
                mais provável de ele pedir a mesma coisa de novo. */}
            {data.correcoes.length > 0 && (
              <View className="gap-2">
                <Text className="text-base font-semibold text-foreground">Meus pedidos</Text>
                {data.correcoes.map((c) => (
                  <View
                    key={c.id}
                    className={`gap-1 rounded-2xl border-2 p-3 ${
                      c.status === "APROVADA"
                        ? "border-success/50 bg-success/5"
                        : c.status === "RECUSADA"
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-warning/60 bg-warning/10"
                    }`}
                  >
                    <Text className="text-base font-semibold text-foreground">
                      Dia {c.dia.slice(-2)}
                      {c.instantePretendido ? ` · ${hora(c.instantePretendido)}` : ""}
                      {c.pedidoPor === "GESTOR" ? " · lançado pelo escritório" : ""}
                    </Text>
                    <Text className="text-sm text-foreground">{c.motivo}</Text>
                    <Text className="text-sm font-medium text-foreground">
                      {c.status === "PENDENTE"
                        ? "Esperando o escritório decidir."
                        : c.status === "APROVADA"
                          ? "Aceito — já está contado no seu mês."
                          : "Não foi aceito."}
                    </Text>
                    {c.status === "RECUSADA" && c.decisaoMotivo ? (
                      <Text className="text-sm text-foreground">Motivo: {c.decisaoMotivo}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}

            {/* A conferência. Os DOIS botões, sempre — e o "não confere" não é
                um botão escondido: é o que dá valor ao "confere". */}
            {data.ciencia ? (
              <View
                className={`rounded-2xl border-2 p-4 ${
                  data.ciencia.concorda
                    ? "border-success/50 bg-success/10"
                    : "border-warning/60 bg-warning/10"
                }`}
              >
                <Text className="text-base font-semibold text-foreground">
                  {data.ciencia.concorda
                    ? "Você conferiu e concordou com este mês."
                    : "Você registrou que não concorda com este mês."}
                </Text>
                {data.ciencia.observacao ? (
                  <Text className="mt-1 text-sm text-foreground">{data.ciencia.observacao}</Text>
                ) : null}
              </View>
            ) : naoConfere ? (
              <View className="gap-2 rounded-2xl border-2 border-border p-4">
                <Text className="text-base font-semibold text-foreground">
                  O que está errado?
                </Text>
                <TextInput
                  className="min-h-20 rounded-xl border-2 border-border p-3 text-base text-foreground"
                  multiline
                  placeholder="Escreva com suas palavras"
                  value={observacao}
                  onChangeText={setObservacao}
                  onFocus={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 250)}
                />
                <View className="flex-row gap-3">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setNaoConfere(false)}
                    className="h-14 flex-1 items-center justify-center rounded-xl border-2 border-border"
                  >
                    <Text className="text-base font-semibold text-foreground">Voltar</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={enviando}
                    onPress={() => void conferir(false)}
                    className="h-14 flex-1 items-center justify-center rounded-xl bg-warning"
                  >
                    <Text className="text-base font-semibold text-warning-foreground">
                      {enviando ? "Enviando…" : "Registrar"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View className="gap-2">
                <Text className="text-sm text-muted-foreground">
                  Confira os dias acima. O que você marcar aqui fica gravado com a data.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={enviando}
                  onPress={() => void conferir(true)}
                  className="h-16 items-center justify-center rounded-2xl bg-success"
                >
                  <Text className="text-xl font-bold text-success-foreground">
                    {enviando ? "Enviando…" : "Confere"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setNaoConfere(true)}
                  className="h-14 items-center justify-center rounded-2xl border-2 border-warning"
                >
                  <Text className="text-base font-semibold text-foreground">
                    Não confere — quero corrigir
                  </Text>
                </Pressable>
              </View>
            )}

            <Text className="pb-4 text-center text-xs text-muted-foreground">
              As batidas são as suas, e ninguém pode apagá-las — nem a empresa, nem nós. O que
              muda a conta é a correção, e ela fica registrada com autor e motivo.
            </Text>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
