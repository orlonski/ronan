import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CloudOff, Fuel, Receipt, Send, Truck, Utensils, Wrench } from "lucide-react-native";
import {
  ROTULO_LANCAMENTO_PESSOAL,
  ehGanho,
  type ResumoMesPessoal,
  type TipoLancamentoPessoal,
} from "@ronan/shared-types";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/api-url";
import { showAlert } from "@/lib/alert";
import {
  cacheDoMes,
  cacheViagens,
  carregarMes,
  carregarResumo,
  carregarViagens,
  drenar,
  mesAtual,
  type ItemPessoal,
  type ItemViagem,
} from "@/lib/pessoal";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Frete e gasto na MESMA lista — o dia dele não vem separado por categoria. */
type Linha =
  | { tipo: "frete"; data: string; item: ItemViagem }
  | { tipo: "gasto"; data: string; item: ItemPessoal };

/**
 * O que já aconteceu: fretes e gastos numa linha do tempo só.
 *
 * Aqui não se CRIA nada — criar é no Início. Histórico com botão de "novo" faz
 * o motorista lançar de dois lugares diferentes e nunca saber qual é o certo; e
 * documento, que é cadastro, não tem nada que fazer no meio do que ele rodou.
 *
 * Sem abas de propósito: separar frete de gasto obriga ele a lembrar em qual
 * aba estava o que procura, quando o que ele quer é ver o dia — o frete e o
 * diesel daquele frete, um embaixo do outro.
 */
export function HistoricoPessoal() {
  const meses = useMemo(() => ultimosMeses(6), []);
  const [mes, setMes] = useState(mesAtual());
  const [viagens, setViagens] = useState<ItemViagem[]>([]);
  const [gastos, setGastos] = useState<ItemPessoal[]>([]);
  const [resumo, setResumo] = useState<ResumoMesPessoal | null>(null);
  const [carregando, setCarregando] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setViagens(await carregarViagens(mes));
      setGastos(await carregarMes(mes));
      setResumo(await carregarResumo(mes));
    } catch {
      /* sem sinal: fica o que já está na tela */
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    void cacheViagens(mes).then(setViagens);
    void cacheDoMes(mes).then(setGastos);
    void drenar().then(recarregar);
  }, [mes, recarregar]);

  const dias = useMemo(() => agruparPorDia(viagens, gastos), [viagens, gastos]);

  /**
   * O comprovante saiu do botão grande no meio da tela e virou ação do mês que
   * ele está olhando — é aqui que a pergunta "o que eu rodei pra você?" nasce.
   */
  async function enviarComprovante() {
    if (viagens.length === 0) {
      void showAlert({
        title: "Nenhum frete neste mês",
        message: "O comprovante mostra os fretes do período — registre os fretes primeiro.",
      });
      return;
    }
    try {
      const [ano, m] = mes.split("-").map(Number);
      const ultimoDia = new Date(Date.UTC(ano!, m!, 0)).getUTCDate();
      const c = await api.criarComprovantePessoal({
        tipo: "FRETES",
        inicio: `${mes}-01`,
        fim: `${mes}-${String(ultimoDia).padStart(2, "0")}`,
      });
      await Share.share({
        message: `Fretes que rodei em ${fmtMesLongo(mes)}: ${API_URL}/publico/comprovante/${c.token}`,
      });
    } catch {
      void showAlert({
        title: "Não deu pra gerar o comprovante",
        message: "Precisa de internet pra criar o link.",
      });
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="border-b border-border px-4 pb-3 pt-2">
        <Text className="mb-3 text-2xl font-extrabold tracking-tight text-foreground">
          Histórico
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
          {meses.map((m) => (
            <Pressable
              key={m.chave}
              onPress={() => setMes(m.chave)}
              className={`mx-1 rounded-full px-4 py-2 ${
                mes === m.chave ? "bg-primary" : "bg-secondary"
              }`}
            >
              <Text
                className={`text-sm font-bold ${
                  mes === m.chave ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {m.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={carregando} onRefresh={() => void recarregar()} />
        }
      >
        {resumo && (
          <View className="rounded-2xl border-2 border-border bg-card p-4">
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {fmtMesLongo(mes)}
                </Text>
                <Text
                  className="mt-1 text-3xl font-extrabold text-foreground"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {dinheiro(resumo.saldo)}
                </Text>
                <Text className="text-sm text-muted-foreground">
                  {dinheiro(resumo.ganhos)} recebidos · {dinheiro(resumo.gastos)} gastos
                </Text>
                {resumo.viagens > 0 && (
                  <Text className="mt-0.5 text-sm text-muted-foreground">
                    {resumo.viagens} {resumo.viagens === 1 ? "frete" : "fretes"}
                    {resumo.km > 0 ? ` · ${resumo.km.toLocaleString("pt-BR")} km` : ""}
                  </Text>
                )}
              </View>
              {viagens.length > 0 && (
                <Pressable
                  onPress={() => void enviarComprovante()}
                  className="flex-row items-center gap-1.5 rounded-full bg-secondary px-3 py-2 active:opacity-70"
                >
                  <Send size={14} color="#13316b" />
                  <Text className="text-sm font-bold text-primary">Comprovante</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {dias.length === 0 && !carregando && (
          <View className="mt-4 rounded-2xl border-2 border-dashed border-border p-6">
            <Text className="text-center text-base font-semibold text-foreground">
              Nada em {fmtMesLongo(mes)}
            </Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">
              Os fretes que você rodar e os gastos que lançar aparecem aqui, dia a dia.
            </Text>
          </View>
        )}

        {dias.map(([data, linhas]) => (
          <View key={data} className="gap-2">
            <Text className="mt-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {fmtDia(data)}
            </Text>
            {linhas.map((l) => (
              <View
                key={l.tipo === "frete" ? l.item.clientId : `g-${l.item.clientId}`}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4"
              >
                <View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary">
                  {l.tipo === "frete" ? (
                    <Truck size={22} color="#13316b" strokeWidth={2.5} />
                  ) : (
                    <IconeGasto tipo={l.item.tipo} />
                  )}
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 font-bold text-foreground" numberOfLines={1}>
                      {l.tipo === "frete"
                        ? `${l.item.origem} → ${l.item.destino}`
                        : ROTULO_LANCAMENTO_PESSOAL[l.item.tipo]}
                    </Text>
                    {l.item.pendente && (
                      <View className="flex-row items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
                        <CloudOff size={11} color="#b45309" />
                        <Text className="text-xs font-semibold text-amber-700">vai subir</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {l.tipo === "frete"
                      ? [
                          l.item.carga,
                          l.item.km ? `${l.item.km.toLocaleString("pt-BR")} km` : null,
                          l.item.peso ? `${l.item.peso.toLocaleString("pt-BR")} t` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "sem detalhes"
                      : [l.item.descricao, l.item.litros ? `${l.item.litros} L` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                  </Text>
                </View>
                <Text
                  className={`text-base font-bold ${
                    l.tipo === "frete" || ehGanho(l.item.tipo)
                      ? "text-green-700"
                      : "text-foreground"
                  }`}
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {l.tipo === "frete"
                    ? l.item.valorRecebido != null
                      ? `+ ${dinheiro(l.item.valorRecebido)}`
                      : "—"
                    : `${ehGanho(l.item.tipo) ? "+" : "−"} ${dinheiro(l.item.valor)}`}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function IconeGasto({ tipo }: { tipo: TipoLancamentoPessoal }) {
  if (tipo === "ABASTECIMENTO") return <Fuel size={22} color="#13316b" strokeWidth={2.5} />;
  if (tipo === "PEDAGIO") return <Receipt size={22} color="#13316b" strokeWidth={2.5} />;
  if (tipo === "MANUTENCAO") return <Wrench size={22} color="#13316b" strokeWidth={2.5} />;
  if (tipo === "ALIMENTACAO") return <Utensils size={22} color="#13316b" strokeWidth={2.5} />;
  return <Receipt size={22} color="#13316b" strokeWidth={2.5} />;
}

/** Um dia por bloco, do mais recente pro mais antigo. */
function agruparPorDia(viagens: ItemViagem[], gastos: ItemPessoal[]): [string, Linha[]][] {
  const linhas: Linha[] = [
    ...viagens.map((item) => ({ tipo: "frete" as const, data: item.data, item })),
    ...gastos.map((item) => ({ tipo: "gasto" as const, data: item.data, item })),
  ];
  const porDia = new Map<string, Linha[]>();
  for (const l of linhas) {
    const lista = porDia.get(l.data) ?? [];
    // Frete primeiro no dia: é o que aconteceu, o gasto é consequência dele.
    if (l.tipo === "frete") lista.unshift(l);
    else lista.push(l);
    porDia.set(l.data, lista);
  }
  return [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function ultimosMeses(n: number): { chave: string; label: string }[] {
  const out: { chave: string; label: string }[] = [];
  const hoje = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    out.push({
      chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
    });
  }
  return out;
}

function fmtMesLongo(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const nomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return `${nomes[(m ?? 1) - 1]} de ${ano}`;
}

function fmtDia(iso: string): string {
  const [ano, m, d] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano!, (m ?? 1) - 1, d ?? 1));
  const semana = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${semana[data.getUTCDay()]}`;
}
