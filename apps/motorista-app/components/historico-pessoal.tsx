import { useCallback, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronRight,
  CloudOff,
  Fuel,
  Receipt,
  Send,
  TriangleAlert,
  Truck,
  Utensils,
  Wrench,
} from "lucide-react-native";
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
  /** Só o puxão dele acende a rodinha — a revalidação de fundo é calada. */
  const [atualizando, setAtualizando] = useState(false);
  /** Primeira carga do mês: aí sim vale um aviso, porque a lista está vazia. */
  const [carregando, setCarregando] = useState(false);

  const recarregar = useCallback(async () => {
    try {
      setViagens(await carregarViagens(mes));
      setGastos(await carregarMes(mes));
      setResumo(await carregarResumo(mes));
    } catch {
      /* sem sinal: fica o que já está na tela */
    }
  }, [mes]);

  const puxarPraAtualizar = useCallback(async () => {
    setAtualizando(true);
    try {
      await drenar();
    } catch {
      /* sem sinal: recarrega do jeito que der */
    } finally {
      await recarregar();
      setAtualizando(false);
    }
  }, [recarregar]);

  // `useFocusEffect`, não `useEffect`: a aba nunca desmonta, então voltar de uma
  // correção (ou de um lançamento novo) não recarregava nada — ele via o número
  // velho e lançava de novo achando que não tinha entrado.
  // O `.catch` no `drenar` é o que garante o recarregar: sem ele, uma falha na
  // fila (sem sinal) engolia a atualização inteira da tela.
  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      setCarregando(true);
      void cacheViagens(mes).then((c) => vivo && setViagens(c));
      void cacheDoMes(mes).then((c) => vivo && setGastos(c));
      void drenar()
        .catch(() => {})
        .then(() => recarregar())
        .catch(() => {})
        .finally(() => setCarregando(false));
      return () => {
        vivo = false;
      };
    }, [mes, recarregar]),
  );

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
    <View className="flex-1 bg-background">
      {/* Cabeçalho azul: a barra de status do iPhone é branca (ver _layout), e
          topo claro apagaria hora, sinal e bateria. */}
      <SafeAreaView edges={["top"]} className="bg-brand">
        <View className="px-4 pb-4 pt-2">
          <Text className="mb-3 text-2xl font-extrabold tracking-tight text-white">
            Histórico
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            {meses.map((m) => (
              <Pressable
                key={m.chave}
                onPress={() => setMes(m.chave)}
                className={`mx-1 rounded-full px-4 py-3 ${
                  mes === m.chave ? "bg-white" : "bg-white/15"
                }`}
              >
                <Text
                  className={`text-base font-bold ${
                    mes === m.chave ? "text-primary" : "text-white"
                  }`}
                >
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => void puxarPraAtualizar()}
          />
        }
      >
        {resumo && (
          <View className="rounded-2xl border-2 border-border bg-card p-4">
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
        )}

        {/* Linha própria, e o rótulo diz o que faz. Como pílula de 14px encostada
            no canto do card, ninguém entendia que era o link pro contratante. */}
        {viagens.length > 0 && (
          <Pressable
            onPress={() => void enviarComprovante()}
            className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
          >
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary">
              <Send size={22} color="#13316b" strokeWidth={2.5} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-foreground">
                Mandar o que rodei em {fmtMesCurto(mes)}
              </Text>
              <Text className="text-sm text-muted-foreground">
                Gera um link com seus fretes do mês pra quem vai pagar
              </Text>
            </View>
          </Pressable>
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
              // A linha ABRE. Antes era uma `View`: um valor errado não tinha
              // como ser corrigido nem apagado, e ficava mentindo no resumo do
              // mês e no comprovante que ele manda pra quem paga.
              <Pressable
                key={l.tipo === "frete" ? l.item.clientId : `g-${l.item.clientId}`}
                onPress={() =>
                  router.push(
                    l.tipo === "frete"
                      ? `/editar-frete?clientId=${encodeURIComponent(l.item.clientId)}&mes=${mes}`
                      : `/editar-gasto?clientId=${encodeURIComponent(l.item.clientId)}&mes=${mes}`,
                  )
                }
                className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
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
                    {l.item.erro ? (
                      <View className="flex-row items-center gap-1 rounded-full bg-destructive/10 px-2 py-1">
                        <TriangleAlert size={16} color="#dc2626" />
                        <Text className="text-sm font-bold text-destructive">não subiu</Text>
                      </View>
                    ) : (
                      l.item.pendente && (
                        <View className="flex-row items-center gap-1 rounded-full bg-warning/15 px-2 py-1">
                          <CloudOff size={16} color="#b45309" />
                          <Text className="text-sm font-semibold text-foreground">vai subir</Text>
                        </View>
                      )
                    )}
                  </View>
                  <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                    {l.item.erro
                      ? l.item.erro
                      : l.tipo === "frete"
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
                      ? "text-success"
                      : "text-foreground"
                  }`}
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {l.tipo === "frete"
                    ? l.item.valorRecebido != null
                      ? `+ ${dinheiro(l.item.valorRecebido)}`
                      : "falta o valor"
                    : `${ehGanho(l.item.tipo) ? "+" : "−"} ${dinheiro(l.item.valor)}`}
                </Text>
                <ChevronRight size={20} color="#94a3b8" />
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
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

function fmtMesCurto(mes: string): string {
  const [, m] = mes.split("-").map(Number);
  const nomes = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return nomes[(m ?? 1) - 1] ?? mes;
}

function fmtDia(iso: string): string {
  const [ano, m, d] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano!, (m ?? 1) - 1, d ?? 1));
  const semana = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${semana[data.getUTCDay()]}`;
}
