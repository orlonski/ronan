import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowRight, MapPin, Search } from "lucide-react-native";
import type { EstimativaFrete } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenHeader } from "@/components/screen-header";
import { api } from "@/lib/api";
import { hojeISO, lancarViagem } from "@/lib/pessoal";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Ponto = { texto: string; lat?: number; lng?: number };

/**
 * "Vale a pena esse frete?" — e, se valer, o registro dele.
 *
 * É a conta que o autônomo faz no papel antes de aceitar uma carga. Aqui ela sai
 * com os números DELE: o consumo e o preço do litro vêm do que ele mesmo lançou
 * no caderno. Ver docs/motorista-sem-empresa.md.
 *
 * A estimativa é um bônus, não um pré-requisito: sem sinal (ou sem achar o
 * endereço no mapa) ele ainda registra o frete digitando o km. Um frete anotado
 * pela metade vale mais que frete nenhum anotado.
 */
export default function NovoFreteScreen() {
  const [origem, setOrigem] = useState<Ponto>({ texto: "" });
  const [destino, setDestino] = useState<Ponto>({ texto: "" });
  const [carga, setCarga] = useState("");
  const [peso, setPeso] = useState("");
  const [pagam, setPagam] = useState("");
  const [contratante, setContratante] = useState("");
  const [kmManual, setKmManual] = useState("");
  const [estimativa, setEstimativa] = useState<EstimativaFrete | null>(null);
  const [estimando, setEstimando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const temCoordenadas = origem.lat != null && destino.lat != null;
  const valor = pagam ? Number(pagam.replace(/\./g, "").replace(",", ".")) : null;

  // O valor entra na estimativa (é ele que responde "sobra quanto"), mas com
  // atraso: a estimativa chama roteamento, e disparar isso a cada tecla do
  // campo de dinheiro seria uma consulta por dígito.
  const [valorParaConta, setValorParaConta] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setValorParaConta(valor), 600);
    return () => clearTimeout(t);
  }, [valor]);

  const estimar = useCallback(async () => {
    if (!temCoordenadas) return;
    setEstimando(true);
    setErro(null);
    try {
      setEstimativa(
        await api.estimarFrete({
          origemLat: origem.lat!,
          origemLng: origem.lng!,
          destinoLat: destino.lat!,
          destinoLng: destino.lng!,
          // Os nomes escritos são o que casa com o histórico dele: coordenada
          // de hoje nunca bate com a coordenada digitada mês passado.
          origemNome: origem.texto.trim() || undefined,
          destinoNome: destino.texto.trim() || undefined,
          valorFrete: valorParaConta && valorParaConta > 0 ? valorParaConta : undefined,
        }),
      );
    } catch {
      // Sem rede a estimativa simplesmente não aparece — e o registro continua
      // possível. Não vira erro na cara dele.
      setEstimativa(null);
    } finally {
      setEstimando(false);
    }
  }, [origem, destino, temCoordenadas, valorParaConta]);

  useEffect(() => {
    void estimar();
  }, [estimar]);

  const km = estimativa?.km ?? (kmManual ? Number(kmManual.replace(",", ".")) : null);
  const resultado = estimativa?.resultado ?? null;

  async function registrar() {
    setErro(null);
    if (origem.texto.trim().length < 2) return setErro("De onde você sai?");
    if (destino.texto.trim().length < 2) return setErro("Pra onde você leva?");
    setSalvando(true);
    try {
      await lancarViagem({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        data: hojeISO(),
        origem: origem.texto.trim(),
        destino: destino.texto.trim(),
        carga: carga.trim() || undefined,
        km: km ?? undefined,
        peso: peso ? Number(peso.replace(",", ".")) : undefined,
        valorRecebido: valor ?? undefined,
        contratante: contratante.trim() || undefined,
        // Nasce EM ABERTO: o frete acabou de ser aceito, o dinheiro não caiu.
        // Marcar como recebido aqui era o que fazia o resumo somar como ganho
        // um dinheiro que ele ainda não tinha visto a cor.
      });
      // Volta pra Início, onde o frete recém-criado aparece no topo dos
      // últimos. Antes ia pra "/meus-gastos", que deixou de ser o caderno e
      // virou o formulário de LANÇAR GASTO: ele confirmava o frete e caía num
      // campo "Valor" em branco com o teclado aberto, parecendo que o app pediu
      // mais uma coisa ou que o frete não salvou.
      router.replace("/");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title="Vale a pena?"
            subtitle="Veja o que sobra antes de aceitar o frete"
          />

          <View className="flex-1 gap-5 px-5 py-6">
            <BuscaLocal rotulo="Saio de" ponto={origem} onEscolher={setOrigem} />
            <BuscaLocal rotulo="Levo para" ponto={destino} onEscolher={setDestino} />

            {estimando && (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator />
                <Text className="text-base text-muted-foreground">Calculando o caminho…</Text>
              </View>
            )}

            {estimativa?.km != null && (
              <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-medium text-muted-foreground">Distância</Text>
                  <Text className="text-xl font-bold text-foreground">
                    {estimativa.km.toLocaleString("pt-BR")} km
                  </Text>
                </View>

                <View className="flex-row items-start justify-between gap-3">
                  <Text className="text-base font-medium text-muted-foreground">Pedágio</Text>
                  <Text className="flex-1 text-right text-xl font-bold text-foreground">
                    {estimativa.pedagiosDesconhecidos
                      ? "não deu pra conferir"
                      : estimativa.pedagios.length === 0
                        ? "sem praça no caminho"
                        : estimativa.pedagioTotal != null
                          ? `${estimativa.pedagioParcial ? "a partir de " : ""}${dinheiro(estimativa.pedagioTotal)}`
                          : "—"}
                  </Text>
                </View>

                {estimativa.pedagios.length > 0 && (
                  <Text className="text-sm text-muted-foreground">
                    {estimativa.pedagioTotal == null
                      ? // Sem os eixos o app tem a tarifa de cada praça e não
                        // pode somar nada: um eixo a mais ou a menos muda o
                        // pedágio inteiro.
                        "Diga quantos eixos você roda no seu perfil e o app soma o pedágio em reais."
                      : estimativa.pedagioParcial
                        ? `${estimativa.pedagios.length} ${estimativa.pedagios.length === 1 ? "praça" : "praças"} no caminho, e nem todas têm preço cadastrado — o valor real é maior.`
                        : `${estimativa.pedagios.length} ${estimativa.pedagios.length === 1 ? "praça" : "praças"}: ${estimativa.pedagios.map((p) => p.nome).join(", ")}`}
                  </Text>
                )}

                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-medium text-muted-foreground">Diesel</Text>
                  <Text className="text-xl font-bold text-foreground">
                    {estimativa.diesel != null ? dinheiro(estimativa.diesel) : "—"}
                  </Text>
                </View>

                {estimativa.diesel != null ? (
                  <Text className="text-sm text-muted-foreground">
                    Pelo SEU consumo: {estimativa.consumoKmPorLitro?.toLocaleString("pt-BR")} km/L
                    a {dinheiro(estimativa.precoLitro!)} o litro, dos últimos 90 dias.
                  </Text>
                ) : (
                  // Dizer O QUE falta, e não só que falta: a diferença entre o
                  // motorista preencher o odômetro no próximo posto e achar que
                  // o app não funciona.
                  <Text className="text-sm text-muted-foreground">
                    {estimativa.consumoMotivo === "SEM_ODOMETRO"
                      ? "Anote o odômetro quando encher o tanque. Com dois cheios o app mede seu km/L de verdade — média de mercado aqui seria chute com o seu dinheiro."
                      : estimativa.consumoMotivo === "ODOMETRO_INCONSISTENTE"
                        ? "Os odômetros lançados não batem entre si (algum ficou trocado). Corrija em Meus gastos e a conta volta."
                        : estimativa.precoLitro == null
                          ? "Lance seus abastecimentos com litros e odômetro. A conta sai com os SEUS números, não com média de mercado."
                          : "Falta o segundo tanque cheio com odômetro: é entre dois cheios que dá pra medir o consumo."}
                  </Text>
                )}

                {/* A única referência de preço honesta que o app tem pra dar:
                    a dele. Tabela de mercado o sistema não conhece, e inventar
                    uma seria pôr um número na boca dele numa negociação. */}
                {estimativa.historico && (
                  <View className="gap-1 border-t border-border pt-3">
                    <Text className="text-base font-semibold text-foreground">
                      Você já fez esse trecho {estimativa.historico.vezes}{" "}
                      {estimativa.historico.vezes === 1 ? "vez" : "vezes"}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      Recebeu {dinheiro(estimativa.historico.medianaValor ?? 0)} em média
                      {estimativa.historico.medianaPorKm != null
                        ? ` (${dinheiro(estimativa.historico.medianaPorKm)}/km)`
                        : ""}
                      {estimativa.historico.ultimaVez
                        ? ` · última vez em ${estimativa.historico.ultimaVez.split("-").reverse().join("/")}`
                        : ""}
                      .
                    </Text>
                  </View>
                )}

                {estimativa.custoPorKm != null && (
                  <Text className="text-sm text-muted-foreground">
                    Fora o diesel, seu caminhão custa {dinheiro(estimativa.custoPorKm)} por km
                    rodado (manutenção, alimentação e outros, dos últimos 90 dias).
                  </Text>
                )}
              </View>
            )}

            {estimativa?.km == null && temCoordenadas && !estimando && (
              <Text className="text-base text-muted-foreground">
                Não deu pra calcular o caminho agora. Você pode registrar o frete assim mesmo,
                informando o km.
              </Text>
            )}

            {/* O campo aparece SEMPRE que não houver km calculado — não só
                quando faltam coordenadas. Antes, com endereço resolvido mas o
                servidor de rotas fora do ar, a tela mandava "informe o km" e o
                campo pra informar não estava lá. */}
            {estimativa?.km == null && (
              <View className="gap-2">
                <Label>Km (se souber)</Label>
                <Input
                  value={kmManual}
                  onChangeText={(v) => setKmManual(v.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
              </View>
            )}

            <View className="gap-2">
              <Label>Quanto estão pagando</Label>
              <Input
                value={pagam}
                onChangeText={(v) => setPagam(v.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="0,00"
              />
            </View>

            <View className="gap-2">
              <Label>Quem está contratando (opcional)</Label>
              <Input
                value={contratante}
                onChangeText={setContratante}
                placeholder="Transportadora, agenciador, a obra…"
              />
              <Text className="text-sm text-muted-foreground">
                É o nome que aparece em “quem te deve” quando chegar o dia de cobrar.
              </Text>
            </View>

            {resultado?.sobra != null && (
              <View
                className={`gap-2 rounded-2xl border-2 p-4 ${
                  resultado.sobra > 0
                    ? "border-success bg-success/10"
                    : "border-destructive bg-destructive/10"
                }`}
              >
                <Text
                  className={`text-base font-medium ${
                    resultado.sobra > 0 ? "text-foreground" : "text-destructive"
                  }`}
                >
                  Sobra pra você
                </Text>
                <Text
                  className={`text-3xl font-extrabold ${
                    resultado.sobra > 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {dinheiro(resultado.sobra)}
                </Text>
                {resultado.sobraPorKm != null && (
                  <Text className="text-sm font-semibold text-muted-foreground">
                    {dinheiro(resultado.sobraPorKm)} por km rodado
                  </Text>
                )}

                {/* Mostrar a conta aberta é o que faz ele confiar no número —
                    e o que mostra onde falta dado. */}
                <View className="mt-1 gap-1 border-t border-border/60 pt-2">
                  <LinhaConta rotulo="Diesel do trecho" valor={resultado.diesel} />
                  <LinhaConta
                    rotulo={
                      estimativa?.pedagioParcial ? "Pedágio (pelo menos)" : "Pedágio"
                    }
                    valor={resultado.pedagio}
                  />
                  <LinhaConta rotulo="Custo de rodar" valor={resultado.custoDoTrecho} />
                </View>

                {resultado.incompleto && (
                  <Text className="text-sm text-muted-foreground">
                    Falta dado pra alguns custos, então essa sobra está por cima. Os itens
                    com “—” não entraram na conta.
                  </Text>
                )}
              </View>
            )}

            <View className="gap-2">
              <Label>O que vou carregar (opcional)</Label>
              <Input
                value={carga}
                onChangeText={setCarga}
                placeholder="Areia, brita, mudança…"
              />
            </View>
            <View className="gap-2">
              <Label>Toneladas (opcional)</Label>
              <Input
                value={peso}
                onChangeText={(v) => setPeso(v.replace(/[^\d.,]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="0"
              />
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            <Button size="lg" variant="success" className="h-16" loading={salvando} onPress={registrar}>
              <Text className="text-lg font-bold text-success-foreground">
                {salvando ? "Salvando..." : "Peguei esse frete"}
              </Text>
            </Button>
            <Text className="text-center text-sm text-muted-foreground">
              Fica no seu caderno. Nenhuma empresa vê.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Busca de cidade/endereço pelo geocoding.
 *
 * O texto vale por si: se a busca não achar (ou não houver sinal), o que ele
 * digitou é o que fica gravado — só não sai estimativa. Nunca trava o registro
 * esperando o mapa concordar.
 */
function BuscaLocal({
  rotulo,
  ponto,
  onEscolher,
}: {
  rotulo: string;
  ponto: Ponto;
  onEscolher: (p: Ponto) => void;
}) {
  const [sugestoes, setSugestoes] = useState<
    { placeId: string; nome: string; textoCompleto: string }[]
  >([]);
  const [buscando, setBuscando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function digitou(texto: string) {
    // Sem coordenada até ele escolher uma sugestão — digitar de novo invalida a
    // anterior, senão a estimativa seria de um lugar que ele já apagou da tela.
    onEscolher({ texto });
    if (timer.current) clearTimeout(timer.current);
    if (texto.trim().length < 3) return setSugestoes([]);
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        setSugestoes(await api.buscarEndereco(texto.trim()));
      } catch {
        setSugestoes([]);
      } finally {
        setBuscando(false);
      }
    }, 450);
  }

  async function escolher(s: { placeId: string; nome: string; textoCompleto: string }) {
    setSugestoes([]);
    onEscolher({ texto: s.textoCompleto || s.nome });
    try {
      const lugar = await api.resolverEndereco(s.placeId);
      if (lugar?.lat != null && lugar?.lng != null) {
        onEscolher({ texto: s.textoCompleto || s.nome, lat: lugar.lat, lng: lugar.lng });
      }
    } catch {
      /* fica só o texto: dá pra registrar o frete do mesmo jeito */
    }
  }

  return (
    <View className="gap-2">
      <Label>{rotulo}</Label>
      <Input
        value={ponto.texto}
        onChangeText={digitou}
        placeholder="Cidade, obra, pedreira…"
        autoCorrect={false}
      />
      {ponto.lat != null && (
        <View className="flex-row items-center gap-1">
          <MapPin size={14} color="#16a34a" />
          <Text className="text-sm font-medium text-success">no mapa</Text>
        </View>
      )}
      {buscando && (
        <View className="flex-row items-center gap-2">
          <Search size={14} color="#64748b" />
          <Text className="text-sm text-muted-foreground">procurando…</Text>
        </View>
      )}
      {sugestoes.map((s) => (
        <Pressable
          key={s.placeId}
          onPress={() => void escolher(s)}
          className="flex-row items-center gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
        >
          <ArrowRight size={16} color="#64748b" />
          <Text className="flex-1 text-base text-foreground">{s.textoCompleto || s.nome}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Uma linha da conta aberta.
 *
 * O "—" é informação: significa que aquele custo NÃO entrou, e é por isso que a
 * sobra está por cima. Esconder a linha faria parecer que o custo é zero.
 */
function LinhaConta({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-muted-foreground">{rotulo}</Text>
      <Text
        className="text-sm font-semibold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {valor != null ? `− ${dinheiro(valor)}` : "—"}
      </Text>
    </View>
  );
}
