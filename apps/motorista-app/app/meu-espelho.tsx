import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
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
  /** O dia que ele tocou. Abre a folha com o que aconteceu nele. */
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);

  async function cancelarPedido(id: string) {
    setCancelando(id);
    try {
      await api.delete(`/m/ponto/correcoes/${id}`);
      await qc.invalidateQueries({ queryKey: ["ponto-espelho", mes] });
    } catch {
      void showAlert({
        title: "Não consegui cancelar",
        message: "Precisa de internet. Se o escritório já decidiu, não dá mais pra cancelar.",
      });
    } finally {
      setCancelando(null);
    }
  }

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
                // `filter`, não `find`: pedir a entrada E a saída do mesmo
                // dia é o caso mais comum de quem esqueceu o celular em casa,
                // e com `find` a segunda sumia da tela — dando a impressão de
                // que não tinha sido enviada.
                const pedidos = data.correcoes.filter(
                  (c) => c.dia === d.dia && c.status === "PENDENTE",
                );
                return (
                <Pressable
                  key={d.dia}
                  accessibilityRole="button"
                  accessibilityLabel={`Pedir correção do dia ${d.dia.slice(-2)}`}
                  disabled={d.futuro || data.fechado}
                  onPress={() => setDiaAberto(d.dia)}
                  className={`flex-row items-center gap-3 rounded-xl border px-3 py-2 active:opacity-70 ${
                    pedidos.length > 0 ? "border-warning/60 bg-warning/5" : "border-border"
                  } ${d.futuro ? "opacity-40" : ""}`}
                >
                  <Text className="w-10 text-base font-semibold text-foreground">
                    {d.dia.slice(-2)}
                  </Text>
                  <View className="flex-1 flex-row flex-wrap gap-1">
                    {d.pares.length === 0 && pedidos.length === 0 ? (
                      <Text className="text-sm text-muted-foreground">—</Text>
                    ) : (
                      d.pares.map((p, i) => (
                        <Text key={i} className="text-sm text-foreground">
                          {/* Lado a lado: o que ELE bateu e o que foi incluído
                              por correção não podem sair iguais. */}
                          <Text className={p.entradaIncluida ? "font-bold text-[#1D4ED8]" : ""}>
                            {hora(p.entrada)}
                          </Text>
                          {p.saida ? (
                            <Text className={p.saidaIncluida ? "font-bold text-[#1D4ED8]" : ""}>
                              {`–${hora(p.saida)}`}
                            </Text>
                          ) : (
                            <Text> – ?</Text>
                          )}
                        </Text>
                      ))
                    )}
                    {/* Os horários PEDIDOS aparecem junto dos outros, do jeito
                        que ele imaginou o dia. Sem rótulo entre parênteses: a
                        cor e o negrito já dizem que é outra coisa, e texto
                        dentro da linha de horas rouba a leitura do que
                        importa — que são as horas. Quem explica é a legenda. */}
                    {pedidos.map((c) =>
                      c.instantePretendido ? (
                        <Text key={c.id} className="text-sm font-bold text-[#B4501A]">
                          {hora(c.instantePretendido)}
                        </Text>
                      ) : null,
                    )}
                    {d.alertas.length > 0 && (
                      <Text className="w-full text-xs text-[#B4501A]">
                        {d.alertas.map((a) => TEXTO_ALERTA[a.codigo] ?? a.codigo).join(" · ")}
                      </Text>
                    )}
                    {/* O pedido dele aparece NO DIA. Sem isto ele pede a
                        correção e o dia continua idêntico — parece que não
                        foi, e o caminho natural é pedir de novo. */}
                    {pedidos.length > 0 && (
                      <Text className="w-full text-xs font-medium text-foreground">
                        {pedidos.length === 1
                          ? "você pediu correção · esperando o escritório"
                          : `você pediu ${pedidos.length} correções · esperando o escritório`}
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
              {/* A legenda só cita a cor que está na tela: explicar marca que
                  não aparece é ruído. */}
              <View className="mt-1 gap-0.5">
                <Text className="text-xs text-muted-foreground">
                  Toque num dia pra ver o que aconteceu nele.
                </Text>
                {data.correcoes.some((c) => c.status === "PENDENTE") && (
                  <Text className="text-xs">
                    <Text className="font-bold text-[#B4501A]">Laranja</Text>
                    <Text className="text-muted-foreground">
                      {" "}
                      = horário que você pediu, esperando o escritório.
                    </Text>
                  </Text>
                )}
                {data.dias.some((d) => d.pares.some((p) => p.entradaIncluida || p.saidaIncluida)) && (
                  <Text className="text-xs">
                    <Text className="font-bold text-[#1D4ED8]">Azul</Text>
                    <Text className="text-muted-foreground">
                      {" "}
                      = horário incluído por correção, não foi você que bateu.
                    </Text>
                  </Text>
                )}
              </View>
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

      {/* A FOLHA DO DIA.
          
          ⚠️ Tocar no dia levava direto pro formulário de correção, e isso
          pulava a pergunta que ele faz primeiro: "o que eu fiz nesse dia
          mesmo?". Agora mostra as batidas, os pedidos em aberto — com a
          saída pra cancelar o que ele digitou errado — e só então o caminho
          pra pedir. */}
      <Modal
        visible={diaAberto !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setDiaAberto(null)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setDiaAberto(null)} />
        <View className="max-h-[75%] rounded-t-3xl bg-background px-5 pb-10 pt-4">
          {(() => {
            const d = data?.dias.find((x) => x.dia === diaAberto);
            const pedidos = (data?.correcoes ?? []).filter((c) => c.dia === diaAberto);
            if (!d) return null;
            return (
              <ScrollView>
                <Text className="text-xl font-bold text-foreground">
                  Dia {d.dia.slice(-2)} de {NOMES_MES[(mesNum ?? 1) - 1]}
                </Text>
                <Text className="mt-0.5 text-base text-muted-foreground">
                  {duracao(d.minutosConsiderados)} trabalhadas · previsto{" "}
                  {duracao(d.minutosPrevistos)} · saldo {hm(d.saldoMin)}
                </Text>

                <Text className="mt-4 text-base font-semibold text-foreground">
                  O que foi registrado
                </Text>
                {d.pares.length === 0 ? (
                  <Text className="mt-1 text-base text-muted-foreground">
                    Nenhuma batida neste dia.
                  </Text>
                ) : (
                  d.pares.map((p, i) => (
                    <View key={i} className="mt-2 flex-row items-center gap-2">
                      <Text
                        className={`text-lg ${p.entradaIncluida ? "font-bold text-[#1D4ED8]" : "text-foreground"}`}
                      >
                        {hora(p.entrada)}
                      </Text>
                      <Text className="text-lg text-muted-foreground">até</Text>
                      <Text
                        className={`text-lg ${p.saidaIncluida ? "font-bold text-[#1D4ED8]" : "text-foreground"}`}
                      >
                        {p.saida ? hora(p.saida) : "?"}
                      </Text>
                      {(p.entradaIncluida || p.saidaIncluida) && (
                        <Text className="text-xs text-[#1D4ED8]">incluído por correção</Text>
                      )}
                    </View>
                  ))
                )}

                {pedidos.length > 0 && (
                  <>
                    <Text className="mt-5 text-base font-semibold text-foreground">
                      Seus pedidos neste dia
                    </Text>
                    {pedidos.map((c) => (
                      <View
                        key={c.id}
                        className="mt-2 gap-1 rounded-2xl border-2 border-border p-3"
                      >
                        <Text className="text-lg font-bold text-[#B4501A]">
                          {c.instantePretendido ? hora(c.instantePretendido) : "—"}
                        </Text>
                        <Text className="text-sm text-foreground">{c.motivo}</Text>
                        <Text className="text-sm font-medium text-foreground">
                          {c.status === "PENDENTE"
                            ? "Esperando o escritório decidir."
                            : c.status === "APROVADA"
                              ? "Aceito — já está contado."
                              : "Não foi aceito."}
                        </Text>
                        {/* Só o PRÓPRIO pedido, e só enquanto ninguém decidiu:
                            depois disso virou parte do documento. */}
                        {c.status === "PENDENTE" && c.pedidoPor === "FUNCIONARIO" && (
                          <Pressable
                            accessibilityRole="button"
                            disabled={cancelando === c.id}
                            onPress={() => void cancelarPedido(c.id)}
                            className="mt-1 h-12 items-center justify-center rounded-xl border-2 border-border"
                          >
                            <Text className="text-base font-semibold text-foreground">
                              {cancelando === c.id ? "Cancelando…" : "Cancelar este pedido"}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </>
                )}

                {!data?.fechado && !d.futuro && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      const alvo = d.dia;
                      setDiaAberto(null);
                      router.push(`/corrigir-ponto?dia=${alvo}`);
                    }}
                    className="mt-5 h-14 items-center justify-center rounded-2xl bg-brand"
                  >
                    <Text className="text-lg font-bold text-brand-foreground">
                      Pedir correção deste dia
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDiaAberto(null)}
                  className="mt-2 h-14 items-center justify-center rounded-2xl border-2 border-border"
                >
                  <Text className="text-base font-semibold text-foreground">Fechar</Text>
                </Pressable>
              </ScrollView>
            );
          })()}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
