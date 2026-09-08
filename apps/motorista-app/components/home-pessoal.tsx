import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calculator,
  FileText,
  Fuel,
  Play,
  Receipt,
  Route,
} from "lucide-react-native";
import { ROTULO_DOCUMENTO_PESSOAL, type ResumoMesPessoal } from "@ronan/shared-types";
import { Badge } from "@/components/ui/badge";
import { api, type ConviteEmpresa } from "@/lib/api";
import {
  cacheViagens,
  carregarResumo,
  carregarViagens,
  drenar,
  mesAtual,
  type ItemViagem,
} from "@/lib/pessoal";
import { useViagemAndamento } from "@/lib/tracking";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * A home de quem trabalha por conta própria.
 *
 * MESMA gramática visual da home de quem tem empresa — mesmo herói, mesmos
 * cards, mesmo resumo do mês, mesmos banners. O que muda é o dono do trabalho:
 * aqui o frete é dele, e não tem empresa olhando. Antes disso, quem não tinha
 * vínculo via uma tela de espera com dois botões, que dizia na cara dele que o
 * app não era pra ele.
 *
 * O convite de empresa, que era essa tela inteira, virou um banner: importante
 * quando existe, invisível quando não.
 */
export function HomePessoal() {
  const [mes] = useState(mesAtual());
  const [viagens, setViagens] = useState<ItemViagem[]>([]);
  const [resumo, setResumo] = useState<ResumoMesPessoal | null>(null);
  const [convites, setConvites] = useState<ConviteEmpresa[]>([]);
  const [docsAlerta, setDocsAlerta] = useState<{ nome: string; vencido: boolean } | null>(null);
  const [perfil, setPerfil] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const tracking = useViagemAndamento(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setViagens(await carregarViagens(mes));
      setResumo(await carregarResumo(mes));
      setConvites(await api.meusConvites().catch(() => []));
      setPerfil((await api.meuPerfil().catch(() => null))?.nome ?? null);
      const docs = await api.meusDocumentos().catch(() => []);
      // Um alerta só, e o mais grave: vencido ganha de vencendo. Lista de
      // pendência na home vira ruído — o detalhe está na tela de documentos.
      const pior =
        docs.find((d) => d.status === "VENCIDO") ?? docs.find((d) => d.status === "VENCENDO");
      setDocsAlerta(
        pior ? { nome: ROTULO_DOCUMENTO_PESSOAL[pior.tipo], vencido: pior.status === "VENCIDO" } : null,
      );
    } catch {
      /* sem sinal: fica o que já está na tela */
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    void cacheViagens(mes).then(setViagens);
    void drenar().then(recarregar);
  }, [mes, recarregar]);

  return (
    <View className="flex-1 bg-background">
      {/* Cabeçalho AZUL, como todas as outras telas do app.
          Não é enfeite: a barra de status do iPhone é branca (`StatusBar
          style="light"` no _layout), então uma tela com topo claro apaga a
          hora, o sinal e a bateria — foi o "sumiram os ícones do iPhone". */}
      <SafeAreaView edges={["top"]} className="bg-brand">
        <View className="flex-row items-end justify-between px-4 pb-4 pt-2">
          <View>
            <Text className="text-2xl font-extrabold tracking-tight text-white">
              Seu trabalho
            </Text>
            <Text className="text-sm font-medium text-white/80">
              {perfil ? primeiroNome(perfil) : "Por conta própria"}
            </Text>
          </View>
          <Badge variant="success">Autônomo</Badge>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={carregando} onRefresh={() => void recarregar()} />
        }
      >

        {/* Convite de empresa: era a tela inteira, virou banner. */}
        {convites.map((c) => (
          <Pressable
            key={c.motoristaId}
            onPress={() => router.push("/convites")}
            className="flex-row items-center gap-3 rounded-2xl border-2 border-primary bg-primary/15 p-4 active:opacity-75"
          >
            <View className="h-12 w-12 items-center justify-center rounded-full bg-primary">
              <Building2 size={22} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-foreground">
                {c.contaNome} quer te adicionar
              </Text>
              <Text className="text-sm text-muted-foreground">
                Toque pra aceitar ou recusar
              </Text>
            </View>
            <ArrowRight size={20} color="#64748b" />
          </Pressable>
        ))}

        {docsAlerta && (
          <Pressable
            onPress={() => router.push("/meus-documentos")}
            className={`flex-row items-center gap-3 rounded-2xl border-2 p-4 active:opacity-75 ${
              docsAlerta.vencido
                ? "border-destructive/40 bg-destructive/10"
                : "border-amber-500/40 bg-amber-500/15"
            }`}
          >
            <View
              className={`h-12 w-12 items-center justify-center rounded-full ${
                docsAlerta.vencido ? "bg-destructive" : "bg-amber-500"
              }`}
            >
              <AlertTriangle size={22} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-foreground">
                {docsAlerta.nome} {docsAlerta.vencido ? "venceu" : "está vencendo"}
              </Text>
              <Text className="text-sm text-muted-foreground">
                Sem ele você não pega carga — toque pra ver
              </Text>
            </View>
          </Pressable>
        )}

        {/* O HERÓI NUNCA SOME.
            Antes ele era escondido quando havia frete rodando, e a tela ficava
            sem a ação principal — quem abrisse o app com um frete aberto não
            achava mais o botão. Agora o mesmo lugar diz "continuar". */}
        <Pressable
          onPress={() => router.push("/frete-guiado")}
          className="overflow-hidden rounded-2xl bg-primary active:opacity-85"
        >
          <View className="flex-row items-center gap-4 p-5">
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
              {tracking.data ? (
                <Activity size={32} color="white" strokeWidth={2.5} />
              ) : (
                <Route size={32} color="white" strokeWidth={2.5} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-2xl font-extrabold text-primary-foreground">
                {tracking.data ? "Frete em andamento" : "Iniciar frete"}
              </Text>
              <Text
                className="mt-0.5 text-base font-medium text-primary-foreground/85"
                style={tracking.data ? { fontVariant: ["tabular-nums"] } : undefined}
              >
                {tracking.data
                  ? `${tracking.resumo?.kmReal.toFixed(1) ?? "0,0"} km rodados · toque pra ver`
                  : "O app te guia e mede seu km"}
              </Text>
            </View>
            <Play size={26} color="white" strokeWidth={2.5} fill="white" />
          </View>
        </Pressable>

        {/* Ações em grade: cabem na tela sem rolar, e o polegar alcança as
            quatro. Lista vertical de cards empurrava o resumo do mês pra fora. */}
        <View className="flex-row gap-3">
          <AcaoRapida
            icone={<Calculator size={26} color="#13316b" strokeWidth={2.5} />}
            titulo="Vale a pena?"
            legenda="Antes de aceitar"
            onPress={() => router.push("/novo-frete")}
          />
          <AcaoRapida
            icone={<Fuel size={26} color="#13316b" strokeWidth={2.5} />}
            titulo="Abastecer"
            legenda="Diesel e litros"
            onPress={() => router.push("/meus-gastos?tipo=ABASTECIMENTO")}
          />
        </View>
        <View className="flex-row gap-3">
          <AcaoRapida
            icone={<Receipt size={26} color="#13316b" strokeWidth={2.5} />}
            titulo="Lançar gasto"
            legenda="Pedágio, comida"
            onPress={() => router.push("/meus-gastos?tipo=PEDAGIO")}
          />
          <AcaoRapida
            icone={<FileText size={26} color="#13316b" strokeWidth={2.5} />}
            titulo="Documentos"
            legenda="CNH, RNTRC"
            onPress={() => router.push("/meus-documentos")}
          />
        </View>

        {/* Resumo do mês — mesmo lugar e mesmo formato do resumo de quem tem
            empresa, com os números dele. */}
        {resumo && resumo.viagens + resumo.gastos > 0 && (
          <View className="mt-3 rounded-2xl border-2 border-border bg-card p-4">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Seu mês
            </Text>
            <View className="mt-3 flex-row gap-3">
              <Stat rotulo="Recebi" valor={dinheiro(resumo.ganhos)} />
              <Stat rotulo="Gastei" valor={dinheiro(resumo.gastos)} />
              <Stat rotulo="Sobrou" valor={dinheiro(resumo.saldo)} destaque />
            </View>
            <Text className="mt-3 text-sm text-muted-foreground">
              {resumo.viagens} {resumo.viagens === 1 ? "frete" : "fretes"}
              {resumo.km > 0 ? ` · ${resumo.km.toLocaleString("pt-BR")} km` : ""}
              {resumo.ganhoPorKm != null ? ` · ${dinheiro(resumo.ganhoPorKm)}/km` : ""}
            </Text>
          </View>
        )}

        {/* Os três últimos, e só. A lista inteira é a aba Histórico — repetir
            aqui faria a home crescer sem fim e competir com ela. */}
        {viagens.slice(0, 3).map((v) => (
          <View key={v.clientId} className="rounded-2xl border-2 border-border bg-card p-4">
            <View className="flex-row items-center gap-2">
              <Text className="font-bold text-foreground">{v.origem}</Text>
              <ArrowRight size={14} color="#64748b" />
              <Text className="flex-1 font-bold text-foreground">{v.destino}</Text>
              {v.valorRecebido != null && (
                <Text className="text-base font-bold text-green-700">
                  {dinheiro(v.valorRecebido)}
                </Text>
              )}
            </View>
            <Text className="mt-0.5 text-sm text-muted-foreground">
              {v.data.split("-").reverse().join("/")}
              {v.km ? ` · ${v.km.toLocaleString("pt-BR")} km` : ""}
            </Text>
          </View>
        ))}

        {viagens.length === 0 && !tracking.data && (
          <View className="mt-2 rounded-2xl border-2 border-dashed border-border p-6">
            <Text className="text-center text-base font-semibold text-foreground">
              Comece pelo primeiro frete
            </Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">
              Toque em Iniciar frete: o app te guia até o destino contando o km, e no fim ele
              entra no seu histórico.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** "Bom trabalho, João" é melhor que "Bom trabalho, João Carlos da Silva". */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Card quadrado da grade de ações — dois por linha, alcance de polegar. */
function AcaoRapida({
  icone,
  titulo,
  legenda,
  onPress,
}: {
  icone: React.ReactNode;
  titulo: string;
  legenda: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 gap-2 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
        {icone}
      </View>
      <View>
        <Text className="text-base font-bold text-foreground">{titulo}</Text>
        <Text className="text-xs text-muted-foreground">{legenda}</Text>
      </View>
    </Pressable>
  );
}

function Stat({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <View className="flex-1">
      <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </Text>
      <Text
        className={`mt-0.5 text-base font-bold ${destaque ? "text-green-700" : "text-foreground"}`}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {valor}
      </Text>
    </View>
  );
}
