import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  CirclePlus,
  FileText,
  Flag,
  MapPin,
  Trash2,
  User,
} from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TipoEventoViagem } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { LocalPorGps, type SelecaoLocal } from "@/components/local-por-gps";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { humanizeApiError } from "@/lib/api";
import type { FonteGps } from "@ronan/shared-types";
import { mensagemGpsFalha, pegarCoordsPrecisa } from "@/lib/geo";
import {
  descartarViagemGuiada,
  extras,
  getLifecycleLocal,
  proximoPassoObrigatorio,
  encerrarOcorrenciaGuiada,
  registrarEventoGuiado,
  type LifecycleLocal,
} from "@/lib/lifecycle";
import { useCatalogoEventos, useCatalogoOcorrencias, useCatalogos, useModelosEtapa } from "@/lib/queries";
import { storage } from "@/lib/storage";
import { DocumentosDaViagem } from "@/components/documentos-da-viagem";
import { GastosDaViagem } from "@/components/gastos";
import { useModuloDespesas } from "@/lib/gastos";
import { useCapacidadeNova } from "@/lib/acessos-app";
import { CAP_ETAPAS } from "@/lib/etapas";
import {
  etapasAbertas,
  lerEstadoEtapas,
  registrarViagemComEtapas,
  useEstadoEtapas,
} from "@/lib/etapas-local";
import { abrirEtapa, CartaoEtapa, etapaConcluida } from "@/components/etapas/cartao-etapas-viagem";

/**
 * Lembrete dos documentos da carga: aparece UMA vez por viagem. Guarda o
 * clientId da última viagem lembrada (só existe uma viagem guiada aberta por
 * vez, então uma chave basta — e não acumula lixo).
 */
const CHAVE_LEMBRETE_CARGA = "viagemGuiada.lembreteCarga";

/** Onde o lembrete aparece: junto do botão que ele tocou. */
type OndeLembrete = "principal" | "problema" | "outros";

export default function ViagemGuiada() {
  const catalogo = useCatalogoEventos();
  const ocorrencias = useCatalogoOcorrencias();
  const catalogos = useCatalogos();
  const [local, setLocal] = useState<LifecycleLocal | null>(null);
  // "Confirmar carga" chega aqui com `iniciou`: liga a faixa "Viagem começou
  // às HH:MM". A tela NÃO abre nada sozinha — os documentos da carga ficam no
  // cartão "Agora" e ele toca quando quiser (o salto automático piscava 3
  // telas em menos de um segundo).
  const params = useLocalSearchParams<{ iniciou?: string }>();
  const etapasLigado = useCapacidadeNova(CAP_ETAPAS);
  const modelosEtapa = useModelosEtapa(etapasLigado);
  const estadoEtapas = useEstadoEtapas();
  // Gasto de viagem (módulo `despesas`): sem o módulo a tela fica como sempre.
  const moduloGastos = useModuloDespesas();
  const [carregando, setCarregando] = useState(true);
  const [sheetTipo, setSheetTipo] = useState<TipoEventoViagem | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Registro sem duração ("Parada", "Pesagem") não vira cartão aberto: sem
  // esta faixa ele toca e não vê nada mudar — e registra de novo.
  const [ultimoRegistro, setUltimoRegistro] = useState<{ nome: string; em: string } | null>(null);
  // Lembrete dos documentos da carga (inline, uma vez): a ação que ele pediu
  // fica guardada e segue no "Depois".
  const [lembrete, setLembrete] = useState<{ onde: OndeLembrete; seguir: () => void } | null>(
    null,
  );
  const [jaLembrou, setJaLembrou] = useState(true);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);

  // Recarrega o espelho local sempre que a tela ganha foco (volta do sheet,
  // do finalizar etc). Se não há viagem, volta pra home.
  const recarregar = useCallback(() => {
    let alive = true;
    void getLifecycleLocal().then((atual) => {
      if (!alive) return;
      if (!atual) {
        router.replace("/");
        return;
      }
      setLocal(atual);
      setCarregando(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(recarregar);

  // Já lembrou dos documentos da carga nesta viagem?
  const clientId = local?.clientId;
  useEffect(() => {
    if (!clientId) return;
    let vivo = true;
    void storage
      .getItem(CHAVE_LEMBRETE_CARGA)
      .then((v) => vivo && setJaLembrou(v === clientId))
      .catch(() => vivo && setJaLembrou(false));
    return () => {
      vivo = false;
    };
  }, [clientId]);

  // Viagem retomada do servidor (outro celular, app reinstalado) com a função
  // ligada: anota com os formulários de agora, pra o cartão e a barreira
  // existirem também nela.
  useEffect(() => {
    if (!local || !etapasLigado || modelosEtapa.length === 0) return;
    void lerEstadoEtapas().then((e) => {
      if (e.viagens.some((v) => v.viagemClientId === local.clientId)) return;
      void registrarViagemComEtapas({
        viagemClientId: local.clientId,
        rotulo: [local.clienteNome, local.localCargaNome].filter(Boolean).join(" · ") || "Viagem",
        placa: catalogos.data?.veiculos.find((x) => x.id === local.veiculoId)?.placa ?? null,
        origem: "GUIADA",
        iniciadaEm: local.iniciadoEm,
        modelos: modelosEtapa,
      });
    });
  }, [local, etapasLigado, modelosEtapa, catalogos.data?.veiculos]);

  const cat = catalogo.data ?? [];
  const slugsRegistrados = useMemo(
    () => (local ? local.eventos.map((e) => e.tipoSlug) : []),
    [local],
  );

  const proximo = useMemo(
    () => proximoPassoObrigatorio(cat, slugsRegistrados),
    [cat, slugsRegistrados],
  );
  const opcionais = useMemo(() => extras(cat), [cat]);
  const tiposOcorrencia = useMemo(
    () => (ocorrencias.data ?? []).filter((t) => t.ativo),
    [ocorrencias.data],
  );
  // O que ainda está correndo: fila que não acabou, quebra que não foi
  // resolvida. Fica no topo porque é o que exige uma ação AGORA — e porque é o
  // relógio que vira estadia.
  const abertas = useMemo(
    () => (local?.eventos ?? []).filter((e) => e.temDuracao && !e.terminouEm),
    [local?.eventos],
  );

  // Documentos da viagem (só com a função ligada). "Agora" = os da carga ainda
  // por fazer: só dá pra fazer no pátio, então ficam no topo. O resto (carga
  // concluída, acerto do frete) desce pra lista de documentos.
  const etapas = useMemo(
    () => (etapasLigado && estadoEtapas && local ? etapasAbertas(estadoEtapas, local.clientId) : []),
    [etapasLigado, estadoEtapas, local],
  );
  const etapasAgora = useMemo(
    () => etapas.filter((e) => e.modelo.momento === "INICIO" && !etapaConcluida(e)),
    [etapas],
  );
  const etapasOutras = useMemo(
    () => etapas.filter((e) => !etapasAgora.includes(e)),
    [etapas, etapasAgora],
  );
  // Os documentos só viram O botão principal quando não há passo da empresa
  // antes (ex.: "Pesagem" obrigatória: o ticket que o documento pede só existe
  // depois dela). Senão ficam no "Agora" como botão contorno.
  const docsPrincipal = etapasAgora.length > 0 && !proximo;
  // Lembrete: documentos da carga ainda intocados (0 de N).
  const cargaIntocada = etapasAgora.find((e) => e.contagem.feitos === 0) ?? null;

  // Relógio da ocorrência aberta. Sem isto o tempo só mudaria quando a tela
  // recebesse foco de novo — e o motorista na fila fica olhando pra ela parada.
  const [, tick] = useState(0);
  useEffect(() => {
    if (abertas.length === 0) return;
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [abertas.length]);

  async function encerrar(eventoId: string) {
    await encerrarOcorrenciaGuiada(eventoId);
    setLocal(await getLifecycleLocal());
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  const placa = useMemo(() => {
    const v = catalogos.data?.veiculos.find((x) => x.id === local?.veiculoId);
    return v?.placa ?? null;
  }, [catalogos.data?.veiculos, local?.veiculoId]);

  // Resumo do que já foi preenchido no fechamento (rascunho): descarga + campos.
  const descargaNome = useMemo(() => {
    const d = local?.finalizarDraft;
    if (!d?.localDescargaId) return null;
    return (
      d.descargaNome ??
      catalogos.data?.locais.find((l) => l.id === d.localDescargaId)?.nome ??
      "Local de descarga"
    );
  }, [local?.finalizarDraft, catalogos.data?.locais]);

  const resumoCampos = useMemo(() => {
    const d = local?.finalizarDraft;
    if (!d) return [] as { label: string; valor: string }[];
    const materialNome = catalogos.data?.materiais.find((m) => m.id === d.materialId)?.nome;
    const itens: { label: string; valor: string }[] = [];
    if (materialNome) itens.push({ label: "Material", valor: materialNome });
    if (d.toneladas?.trim()) itens.push({ label: "Toneladas", valor: `${d.toneladas} t` });
    if (d.ticket?.trim()) itens.push({ label: "Ticket", valor: d.ticket });
    if (d.km?.trim()) itens.push({ label: "Km", valor: `${d.km} km` });
    if (d.valorPedagio?.trim()) itens.push({ label: "Pedágio", valor: `R$ ${d.valorPedagio}` });
    return itens;
  }, [local?.finalizarDraft, catalogos.data?.materiais]);
  // Já começou a fechar? O botão diz "Continuar o fechamento" — "Finalizar
  // viagem" com a descarga já marcada logo abaixo seriam dois sinais opostos.
  const fechamentoComecado = !!descargaNome || resumoCampos.length > 0;

  /**
   * Toda ação da tela que não é "preencher os documentos" passa por aqui: com
   * os documentos da carga em 0 de N, lembra UMA vez (inline, sem pop-up) que
   * eles só dá pra fazer no pátio. "Depois" segue a ação que ele pediu.
   */
  function comLembrete(onde: OndeLembrete, acao: () => void) {
    if (!cargaIntocada || jaLembrou) {
      setLembrete(null);
      acao();
      return;
    }
    setJaLembrou(true);
    if (local) void storage.setItem(CHAVE_LEMBRETE_CARGA, local.clientId).catch(() => {});
    setLembrete({ onde, seguir: acao });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }

  function renderLembrete(onde: OndeLembrete) {
    if (!lembrete || lembrete.onde !== onde || !cargaIntocada) return null;
    return (
      <View className="gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
        <View className="flex-row items-start gap-2">
          <AlertTriangle size={20} color="#b45309" style={{ marginTop: 2 }} />
          <Text className="flex-1 text-base font-bold text-foreground">
            Os documentos da carga só dá pra fazer aqui no pátio. Preencher agora?
          </Text>
        </View>
        <Button
          onPress={() => {
            setLembrete(null);
            abrirEtapa(cargaIntocada.viagem.viagemClientId, cargaIntocada.modelo.id);
          }}
        >
          <FileText size={20} color="white" />
          <Text className="text-base font-semibold text-primary-foreground">Preencher agora</Text>
        </Button>
        <Button
          variant="outline"
          onPress={() => {
            const seguir = lembrete.seguir;
            setLembrete(null);
            seguir();
          }}
        >
          <Text className="text-base font-semibold text-foreground">Depois</Text>
        </Button>
      </View>
    );
  }

  async function onEventoRegistrado() {
    const nome = sheetTipo?.nome ?? null;
    setSheetTipo(null);
    const atual = await getLifecycleLocal();
    setLocal(atual);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // O que fica aberto (fila, quebra) já aparece como cartão no topo; o resto
    // ganha a faixa "X registrada às HH:MM" — e a tela sobe até ela.
    const ultimo = atual?.eventos[atual.eventos.length - 1];
    if (ultimo && !(ultimo.temDuracao && !ultimo.terminouEm)) {
      setUltimoRegistro({ nome: ultimo.nome ?? nome ?? "Registro", em: ultimo.ocorridoEm });
    } else {
      setUltimoRegistro(null);
    }
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function descartar() {
    if (!local) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // Limpa a fila local E cancela no servidor (idempotente, enfileirado).
    await descartarViagemGuiada(local.clientId);
    router.replace("/");
  }

  if (carregando || catalogo.isLoading) {
    // Mesmo cabeçalho da tela pronta: chegando do "Confirmar carga", o que
    // troca é só o miolo, não a tela inteira.
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Viagem em andamento" />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!local) return null; // recarregar já redirecionou

  const clienteIdCarga = null; // lifecycle não amarra cliente até finalizar
  const acabouDeComecar = params.iniciou === "1";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Viagem em andamento" />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
      >
        {/* Resposta ao toque: a viagem começou. Fica — nada some sozinho. */}
        {acabouDeComecar ? (
          <FaixaOk texto={`Viagem começou às ${fmtHora(local.iniciadoEm)}`} />
        ) : null}
        {ultimoRegistro ? (
          <FaixaOk
            texto={`${ultimoRegistro.nome} ${registradoA(ultimoRegistro.nome)} às ${fmtHora(ultimoRegistro.em)}`}
          />
        ) : null}

        {/* Resumo: placa + cliente + local de carga + quando carregou. O nome
            da tela já está no cabeçalho — não repete aqui. */}
        <View className="rounded-2xl border-2 border-primary/30 bg-primary/10 p-4">
          {placa ? (
            <Text
              className="text-2xl font-extrabold text-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {placa}
            </Text>
          ) : null}
          <View className={placa ? "mt-2 gap-1.5" : "gap-1.5"}>
            {local.clienteNome ? (
              <View className="flex-row items-start gap-2">
                <User size={16} color="#64748b" style={{ marginTop: 2 }} />
                <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={2}>
                  {local.clienteNome}
                </Text>
              </View>
            ) : null}
            <View className="flex-row items-start gap-2">
              <MapPin size={16} color="#64748b" style={{ marginTop: 2 }} />
              <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={2}>
                {local.localCargaNome ?? "Local de carga não informado"}
              </Text>
            </View>
            <Text className="text-sm text-muted-foreground">
              Carregou {fmtDataHora(local.iniciadoEm)} · {tempoDesde(local.iniciadoEm)}
            </Text>
          </View>
        </View>

        {/* O que está correndo agora (fila, quebra): exige ação já. */}
        {abertas.map((e) => (
          <View
            key={e.id}
            className="gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4"
          >
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <AlertTriangle size={20} color="#b45309" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-extrabold text-foreground">{e.nome}</Text>
                <Text
                  className="text-sm text-muted-foreground"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  Começou {fmtHora(e.ocorridoEm)} · já faz {tempoDesde(e.ocorridoEm)}
                </Text>
              </View>
            </View>
            <Button variant="success" onPress={() => void encerrar(e.id)}>
              <CheckCircle2 size={20} color="white" />
              <Text className="text-base font-semibold text-success-foreground">
                Já resolveu
              </Text>
            </Button>
          </View>
        ))}

        {/* AGORA: documentos da carga ainda por fazer (só dá no pátio). */}
        {etapasAgora.length > 0 ? (
          <View className="gap-3">
            <Text className="text-xs font-bold uppercase tracking-wider text-primary">
              Agora
            </Text>
            {etapasAgora.map((e, i) => (
              <CartaoEtapa
                key={e.modelo.id}
                e={e}
                destaque
                botao={docsPrincipal && i === 0 ? "principal" : "contorno"}
              />
            ))}
          </View>
        ) : null}

        {/* Próximo passo: passo obrigatório da empresa, ou fechar a viagem.
            Tamanho padrão (lg), um ícone — é o mesmo botão das outras telas. */}
        <View className="gap-3">
          {proximo ? (
            <Button
              size="lg"
              onPress={() => comLembrete("principal", () => setSheetTipo(proximo))}
            >
              <Circle size={22} color="white" strokeWidth={2.5} />
              <Text
                className="shrink text-lg font-bold text-primary-foreground"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {rotuloPrimario(proximo)}
              </Text>
            </Button>
          ) : (
            <Button
              size="lg"
              variant={docsPrincipal ? "outline" : "success"}
              onPress={() => comLembrete("principal", () => router.push("/finalizar-viagem"))}
            >
              <Flag size={22} color={docsPrincipal ? "#0f172a" : "white"} />
              <Text
                className={`shrink text-lg font-bold ${
                  docsPrincipal ? "text-foreground" : "text-success-foreground"
                }`}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {fechamentoComecado ? "Continuar o fechamento" : "Finalizar viagem"}
              </Text>
            </Button>
          )}

          {renderLembrete("principal")}

          {/* O que já foi preenchido no fechamento: perto do botão, pra ele
              ver que já começou a finalizar. */}
          {fechamentoComecado ? (
            <View className="gap-1.5 rounded-2xl border-2 border-border bg-card p-4">
              <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Já preenchido no fechamento
              </Text>
              {descargaNome ? (
                <View className="flex-row items-start gap-2">
                  <CheckCircle2 size={18} color="#16a34a" style={{ marginTop: 1 }} />
                  <Text className="flex-1 text-base font-semibold text-foreground">
                    Descarga · {descargaNome}
                  </Text>
                </View>
              ) : null}
              {resumoCampos.map((r) => (
                <View key={r.label} className="flex-row justify-between gap-3">
                  <Text className="text-sm text-muted-foreground">{r.label}</Text>
                  <Text
                    className="flex-1 text-right text-sm font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {r.valor}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Croqui/autorização do pedido que esta viagem cumpre, se houver.
            Depois do "Agora" e do próximo passo — nunca empurrando os dois. */}
        <DocumentosDaViagem viagem={local} />

        {/* Os outros documentos da viagem (carga já concluída, acerto do frete). */}
        {etapasOutras.length > 0 ? (
          <View className="gap-3">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Documentos da viagem
            </Text>
            {etapasOutras.map((e) => (
              <CartaoEtapa key={e.modelo.id} e={e} botao="contorno" />
            ))}
          </View>
        ) : null}

        {/* Deu problema. Separado dos "outros registros" de propósito: fila,
            quebra e carga recusada não são passos da viagem, são o contrário —
            e é isso que a transportadora precisa saber na hora, não no fim.
            Coluna de botões iguais: os nomes vêm do catálogo de cada empresa,
            e linha a linha cada um ocupa sempre o mesmo lugar. */}
        {tiposOcorrencia.length > 0 && (
          <View className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Deu problema?
            </Text>
            <Text className="text-sm text-muted-foreground">
              O escritório fica sabendo na hora. Fila e espera contam o tempo.
            </Text>
            {renderLembrete("problema")}
            {tiposOcorrencia.map((t) => (
              <BotaoLinha
                key={t.id}
                icone={<AlertTriangle size={22} color="#b45309" />}
                nome={t.nome}
                onPress={() => comLembrete("problema", () => setSheetTipo(t))}
              />
            ))}
          </View>
        )}

        {/* Outros registros = eventos opcionais/repetíveis. */}
        {opcionais.length > 0 && (
          <View className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Outros registros
            </Text>
            {renderLembrete("outros")}
            {opcionais.map((t) => (
              <BotaoLinha
                key={t.id}
                icone={<CirclePlus size={22} color="#0f172a" />}
                nome={t.nome}
                onPress={() => comLembrete("outros", () => setSheetTipo(t))}
              />
            ))}
          </View>
        )}

        {/* Gastos desta viagem: abaixo dos eventos, compacto. O vínculo é
            do contexto (ele tocou de dentro da viagem), não escolha do app. */}
        {moduloGastos.lancar && local ? (
          <GastosDaViagem
            viagemClientId={local.clientId}
            viagemRotulo={local.localCargaNome ?? local.clienteNome ?? null}
            veiculoId={local.veiculoId}
          />
        ) : null}

        {/* Linha do tempo: consulta, não ação — por isso fica embaixo. */}
        <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            O que já foi feito
          </Text>
          <LinhaFeito
            titulo={`Carga${local.localCargaNome ? ` · ${local.localCargaNome}` : ""}`}
            quando={fmtDataHora(local.iniciadoEm)}
          />
          {local.eventos.map((e) => (
            <LinhaFeito
              key={e.id}
              titulo={`${e.nome}${e.localNome ? ` · ${e.localNome}` : ""}`}
              quando={fmtHora(e.ocorridoEm)}
            />
          ))}
          {descargaNome ? (
            <LinhaFeito
              titulo={`Descarga · ${descargaNome}`}
              quando={
                local.finalizarDraft?.descargaEm
                  ? fmtDataHora(local.finalizarDraft.descargaEm)
                  : null
              }
            />
          ) : null}
        </View>

        {/* Descartar — discreto, com confirmação na própria tela (sem pop-up). */}
        {confirmandoDescarte ? (
          <View className="gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4">
            <Text className="text-base font-bold text-foreground">Descartar esta viagem?</Text>
            <Text className="text-sm text-muted-foreground">
              Os passos registrados neste celular serão apagados. Isso não dá pra desfazer.
            </Text>
            <Button variant="destructive" onPress={() => void descartar()}>
              <Trash2 size={20} color="white" />
              <Text className="text-base font-semibold text-destructive-foreground">
                Descartar viagem
              </Text>
            </Button>
            <Button variant="outline" onPress={() => setConfirmandoDescarte(false)}>
              <Text className="text-base font-semibold text-foreground">Manter viagem</Text>
            </Button>
          </View>
        ) : (
          // Botão de verdade (contorno vermelho), não texto solto: ação é botão.
          <Button
            variant="outline"
            className="border-destructive/60"
            onPress={() => {
              setConfirmandoDescarte(true);
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
            }}
          >
            <Trash2 size={20} color="#dc2626" />
            <Text className="text-base font-semibold text-destructive">Descartar viagem</Text>
          </Button>
        )}
      </ScrollView>

      {/* Sheet de coleta do evento */}
      <EventoSheet
        tipo={sheetTipo}
        clienteId={clienteIdCarga}
        onFechar={() => setSheetTipo(null)}
        onRegistrado={onEventoRegistrado}
      />

    </SafeAreaView>
  );
}

/** Faixa verde de confirmação ("Viagem começou às 10:12"). */
function FaixaOk({ texto }: { texto: string }) {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border-2 border-success/40 bg-success/15 px-4 py-3">
      <CheckCircle2 size={22} color="#16a34a" />
      <Text className="flex-1 text-base font-bold text-foreground">{texto}</Text>
    </View>
  );
}

/**
 * Uma ação de "Deu problema"/"Outros registros": botão contorno de largura
 * cheia, tamanho padrão, ícone + nome. Todos iguais — sem grade, sem esticar.
 */
function BotaoLinha({
  icone,
  nome,
  onPress,
}: {
  icone: ReactNode;
  nome: string;
  onPress: () => void;
}) {
  return (
    <Button variant="outline" className="w-full justify-start" onPress={onPress}>
      {icone}
      <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={1}>
        {nome}
      </Text>
    </Button>
  );
}

function LinhaFeito({ titulo, quando }: { titulo: string; quando: string | null }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="mt-0.5">
        <CheckCircle2 size={20} color="#16a34a" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-foreground">{titulo}</Text>
        {quando ? (
          <Text
            className="text-xs text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {quando}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * "Parada registrada" / "Abastecimento registrado": os nomes vêm do catálogo da
 * empresa, então o gênero sai da terminação (o caso comum do português).
 */
function registradoA(nome: string): string {
  const n = nome.trim().toLowerCase();
  return /(a|ção|gem|dade)$/.test(n) && !/(dia|mapa|problema|sistema)$/.test(n)
    ? "registrada"
    : "registrado";
}


/**
 * Modal que coleta só o que o TipoEventoViagem pede (pede*) e registra o
 * evento. Se ehCarga/ehDescarga + pedeGps, detecta o local por proximidade.
 */
function EventoSheet({
  tipo,
  clienteId,
  onFechar,
  onRegistrado,
}: {
  tipo: TipoEventoViagem | null;
  clienteId: string | null;
  onFechar: () => void;
  onRegistrado: () => void;
}) {
  const [local, setLocal] = useState<SelecaoLocal | null>(null);
  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    precisao?: number;
    fonte?: FonteGps;
  } | null>(null);
  const [capturandoGps, setCapturandoGps] = useState(false);
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [toneladas, setToneladas] = useState("");
  const [valor, setValor] = useState("");
  const [ticket, setTicket] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Botão "Abrir ajustes" só quando a falha de GPS é de permissão (1 toque).
  const [erroAjustes, setErroAjustes] = useState(false);
  const val = useValidacaoGuiada();

  const visivel = tipo != null;
  const detectaLocal = !!tipo && tipo.pedeGps && (tipo.ehCarga || tipo.ehDescarga);
  // pedeGps sem ser carga/descarga: captura coords "solta" (ex: parada).
  const gpsSolto = !!tipo && tipo.pedeGps && !tipo.ehCarga && !tipo.ehDescarga;

  function reset() {
    setLocal(null);
    setCoords(null);
    setCapturandoGps(false);
    setFoto(null);
    setToneladas("");
    setValor("");
    setTicket("");
    setObservacao("");
    setSalvando(false);
    setErro(null);
    val.limpar();
  }

  function fechar() {
    reset();
    onFechar();
  }

  async function capturarGpsSolto() {
    setErro(null);
    setErroAjustes(false);
    setCapturandoGps(true);
    const res = await pegarCoordsPrecisa();
    setCapturandoGps(false);
    if (!res.ok) {
      const { msg, ajustes } = mensagemGpsFalha(res.motivo);
      setErro(msg);
      setErroAjustes(ajustes);
      return;
    }
    const c = res.coords;
    val.limpar();
    setCoords({ lat: c.lat, lng: c.lng, precisao: c.precisao ?? undefined, fonte: c.fonte });
  }

  async function salvar() {
    if (!tipo) return;
    setErro(null);
    setErroAjustes(false);

    if (detectaLocal && !local)
      return void val.apontar("local", "Marque o local por GPS");
    if (gpsSolto && !coords)
      return void val.apontar("gps", "Toque em “Marcar minha posição”");
    if (tipo.pedeToneladas && !toneladas.trim())
      return void val.apontar("toneladas", "Informe as toneladas");
    if (tipo.pedeValor && !valor.trim())
      return void val.apontar("valor", "Informe o valor");
    if (tipo.pedeTicket && !ticket.trim())
      return void val.apontar("ticket", "Informe o número do ticket");
    if (tipo.pedeFoto && !foto)
      return void val.apontar("foto", "Tire a foto pra continuar");
    val.limpar();

    setSalvando(true);
    try {
      // Coords do evento: do local detectado (carga/descarga) ou do gps solto.
      const coordsEvento =
        local?.lat != null && local?.lng != null
          ? { lat: local.lat, lng: local.lng, precisao: local.precisao ?? undefined, fonte: local.fonte }
          : coords ?? undefined;

      await registrarEventoGuiado({
        tipo,
        coords: coordsEvento,
        raioUsadoM: local?.raioUsadoM,
        local: local
          ? {
              id: local.id,
              nome: local.nome,
              lat: local.lat,
              lng: local.lng,
              criarOffline: local.criarOffline,
            }
          : undefined,
        foto: foto ? { uri: foto.uri, mime: foto.mime } : undefined,
        toneladas: tipo.pedeToneladas
          ? parseFloat(toneladas.replace(",", "."))
          : undefined,
        valor: tipo.pedeValor ? parseFloat(valor.replace(",", ".")) : undefined,
        ticket: tipo.pedeTicket ? ticket.trim() : undefined,
        observacao: tipo.pedeObservacao ? observacao.trim() || undefined : undefined,
      });
      reset();
      onRegistrado();
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSalvando(false);
    }
  }

  return (
    <Modal
      visible={visivel}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={fechar}
      statusBarTranslucent
    >
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        {tipo && (
          <>
            <ScreenHeaderLike title={`Registrar ${tipo.nome}`} onBack={fechar} />
            <KeyboardAvoidingView
              behavior="padding"
              className="flex-1"
            >
              <ScrollView
                ref={val.scrollRef}
                contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
                keyboardShouldPersistTaps="handled"
              >
                {/* Local por GPS (carga/descarga) */}
                {detectaLocal && (
                  <View
                    className={
                      val.erroDe("local")
                        ? "rounded-2xl border-2 border-destructive bg-destructive/5 p-3"
                        : undefined
                    }
                    onLayout={val.onLayoutCampo("local")}
                  >
                    <LocalPorGps
                      lado={tipo.ehDescarga ? "descarga" : "carga"}
                      ctaLabel={
                        tipo.ehDescarga
                          ? "Estou no local de descarga"
                          : "Estou no local de carga"
                      }
                      clienteId={clienteId}
                      value={local}
                      onSelect={(sel) => {
                        val.limpar();
                        setLocal(sel);
                      }}
                      onLimpar={() => setLocal(null)}
                    />
                    {val.erroDe("local") ? <ErroCampo msg={val.erroDe("local")!} /> : null}
                  </View>
                )}

                {/* GPS solto (parada etc) */}
                {gpsSolto && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("gps")}>
                    <Label error={!!val.erroDe("gps")}>Onde você está</Label>
                    {coords ? (
                      <View className="flex-row items-center gap-3 rounded-2xl border-2 border-success/40 bg-success/15 p-4">
                        <CheckCircle2 size={20} color="#16a34a" />
                        <Text className="flex-1 text-base font-medium text-foreground">
                          Posição registrada
                        </Text>
                      </View>
                    ) : (
                      <Button
                        size="lg"
                        className="h-16"
                        onPress={capturarGpsSolto}
                        loading={capturandoGps}
                      >
                        <MapPin size={22} color="white" />
                        <Text className="text-base font-bold text-primary-foreground">
                          {capturandoGps ? "Buscando GPS…" : "Marcar minha posição"}
                        </Text>
                      </Button>
                    )}
                    {val.erroDe("gps") ? <ErroCampo msg={val.erroDe("gps")!} /> : null}
                  </View>
                )}

                {tipo.pedeToneladas && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("toneladas")}>
                    <Label error={!!val.erroDe("toneladas")}>Toneladas</Label>
                    <Input
                      value={toneladas}
                      onChangeText={(v) => {
                        val.limpar();
                        setToneladas(v);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0,000"
                      maxLength={8}
                      error={!!val.erroDe("toneladas")}
                    />
                    {val.erroDe("toneladas") ? <ErroCampo msg={val.erroDe("toneladas")!} /> : null}
                  </View>
                )}

                {tipo.pedeValor && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("valor")}>
                    <Label error={!!val.erroDe("valor")}>Valor (R$)</Label>
                    <Input
                      value={valor}
                      onChangeText={(v) => {
                        val.limpar();
                        setValor(v);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0,00"
                      maxLength={10}
                      error={!!val.erroDe("valor")}
                    />
                    {val.erroDe("valor") ? <ErroCampo msg={val.erroDe("valor")!} /> : null}
                  </View>
                )}

                {tipo.pedeTicket && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("ticket")}>
                    <Label error={!!val.erroDe("ticket")}>Ticket</Label>
                    <Input
                      value={ticket}
                      onChangeText={(v) => {
                        val.limpar();
                        setTicket(v.toUpperCase());
                      }}
                      placeholder="número"
                      maxLength={50}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      error={!!val.erroDe("ticket")}
                    />
                    {val.erroDe("ticket") ? <ErroCampo msg={val.erroDe("ticket")!} /> : null}
                  </View>
                )}

                {tipo.pedeFoto && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("foto")}>
                    <Label error={!!val.erroDe("foto")}>Foto</Label>
                    <PhotoCapture
                      value={foto}
                      onChange={(f) => {
                        val.limpar();
                        setFoto(f);
                      }}
                    />
                    {val.erroDe("foto") ? <ErroCampo msg={val.erroDe("foto")!} /> : null}
                  </View>
                )}

                {tipo.pedeObservacao && (
                  <View className="gap-2">
                    <Label>Observação</Label>
                    <Input
                      value={observacao}
                      onChangeText={setObservacao}
                      placeholder="opcional"
                      maxLength={500}
                    />
                  </View>
                )}

                {erro ? (
                  <View className="gap-2">
                    <ErroCampo msg={erro} />
                    {erroAjustes && (
                      <Button
                        variant="outline"
                        onPress={() => void Linking.openSettings()}
                      >
                        <Text className="text-sm font-semibold text-foreground">
                          Abrir ajustes
                        </Text>
                      </Button>
                    )}
                  </View>
                ) : null}

                <Button size="lg" onPress={salvar} loading={salvando}>
                  <Check size={22} color="white" />
                  <Text
                    className="shrink text-lg font-bold text-primary-foreground"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {salvando ? "Salvando…" : `Registrar ${tipo.nome}`}
                  </Text>
                </Button>
              </ScrollView>
            </KeyboardAvoidingView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Header idêntico ao ScreenHeader mas com onBack custom (o do ScreenHeader
 * chama router.back(), que não fecha o Modal).
 */
function ScreenHeaderLike({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View className="bg-brand px-4 pb-4 pt-14">
      <View className="flex-row items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 rounded-full bg-white/15"
          onPress={onBack}
        >
          <Text className="text-2xl text-white">✕</Text>
        </Button>
        <Text className="flex-1 text-2xl font-bold text-white" numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

// Rótulo do botão primário. Frases guiadas pra carga/descarga; senão o nome.
function rotuloPrimario(t: TipoEventoViagem): string {
  return `Registrar ${t.nome}`;
}

function tempoDesde(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `há ${h}h${m > 0 ? ` ${m}min` : ""}`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "14:30 de 02/07" — hora + dia/mês locais. */
function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} de ${dd}/${mo}`;
}
