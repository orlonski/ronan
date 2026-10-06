import { useEffect, useMemo, useRef, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  FileX,
  Images,
  MapPinOff,
  Pencil,
  TriangleAlert,
  Undo2,
} from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { BotaoAcao, SemGastoDeViagem } from "@/components/gastos";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { HoraField } from "@/components/ui/hora-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { humanizeApiError } from "@/lib/api";
import { isoDeDataHoraBR } from "@/lib/datetime";
import {
  CAMPO_DESPESA_PERGUNTA_PADRAO,
  CAMPOS_DESPESA,
  corrigirDespesa,
  ehTipoOutro,
  montarCorpoDespesa,
  tipoDeReserva,
  type CampoDespesa,
  type NovaDespesa,
  type TipoDespesaApp,
} from "@/lib/despesas";
import {
  centavosDoTexto,
  diaFalado,
  diaSP,
  fmtReais,
  horaSP,
  marcarGastoSalvo,
  novoClientId,
  procurarRepetidos,
  sugerirViagem,
  useGastos,
  useModuloDespesas,
  useTiposDespesa,
  useViagensConhecidas,
  viagensRecentes,
  type GastoVisto,
  type ViagemConhecida,
} from "@/lib/gastos";
import { useCatalogos } from "@/lib/queries";
import { atualizarDespesaPendente, enqueueDespesa } from "@/lib/sync";
import { listPendingDespesas } from "@/db/database";

/**
 * [B] FORMULÁRIO DO GASTO, montado da configuração do tipo (painel).
 *
 * Ordem FIXA, a mesma pra todo tipo — ele aprende uma vez:
 *   viagem (se veio de dentro dela) → foto → valor → obrigatórios → "Foi nesta
 *   viagem?" → data → "Mais detalhes" (os opcionais) → Salvar.
 *
 * - A câmera NÃO abre sozinha (quem não tem o papel perderia um toque).
 * - Nada vem marcado: nem viagem, nem placa (`feedback_nunca_preselecionar`).
 * - "Foi nesta viagem?" não é obrigatória: sem resposta, nasce sem viagem.
 * - Validação guiada (rola até o campo, frase grande, vibra). Sem pop-up.
 * - Teto do tipo é só texto cinza; nunca valida nem avisa em vermelho.
 * - Funciona sem sinal: tudo vai pela fila do celular.
 */

/** Campo do valor: grande, mas sem cortar o texto em iOS nem Android. */
const ESTILO_VALOR = {
  height: 72,
  fontSize: 28,
  paddingVertical: 0,
  textAlignVertical: "center",
  includeFontPadding: false,
  // lineHeight em TextInput de uma linha empurra o texto pra baixo no iOS;
  // no Android ele segura a altura da linha dentro da caixa.
  ...(Platform.OS === "android" ? { lineHeight: 34 } : null),
} as const;

type Vinculo =
  | { modo: "aberto" }
  | { modo: "nesta"; viagem: ViagemConhecida }
  | { modo: "escolher"; viagem: ViagemConhecida | null }
  | { modo: "fora" };

/** Como o campo aparece no rótulo "Mais detalhes (…)". */
const NOME_CURTO: Record<CampoDespesa, string> = {
  descricao: "o que foi feito",
  placa: "caminhão",
  litros: "litros",
  odometro: "odômetro",
  onde: "onde foi",
};

export default function GastoNovo() {
  const params = useLocalSearchParams<{
    tipoId: string;
    viagemClientId?: string;
    viagemRotulo?: string;
    veiculoId?: string;
    voltar?: string;
    editarClientId?: string;
    /** "Tirar a foto de novo" (Pendentes): abre com o quadro da foto vazio. */
    fotoDeNovo?: string;
    /** Corrigir um gasto JÁ enviado (só enquanto está com o escritório). */
    despesaId?: string;
  }>();
  const qc = useQueryClient();
  const modulo = useModuloDespesas();
  const tipos = useTiposDespesa();
  const cat = useCatalogos();
  const { gastos } = useGastos();
  const viagens = useViagensConhecidas();
  const val = useValidacaoGuiada();

  const editando = !!params.editarClientId;
  const corrigindoEnviado = !!params.despesaId;
  const daViagem = !!params.viagemClientId;
  const [clientId] = useState(() => params.editarClientId ?? novoClientId());

  // ---- o tipo (com plano B pra quem está corrigindo e o tipo saiu do catálogo)
  const [tipoReserva, setTipoReserva] = useState<TipoDespesaApp | null>(null);
  const tipo = tipos.porId(params.tipoId) ?? tipoReserva;

  // ---- campos
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [semComprovante, setSemComprovante] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [cameraNegada, setCameraNegada] = useState(false);
  const [centavos, setCentavos] = useState(0);
  const [descricao, setDescricao] = useState("");
  const [onde, setOnde] = useState("");
  const [litros, setLitros] = useState("");
  const [odometro, setOdometro] = useState("");
  const [veiculoId, setVeiculoId] = useState("");
  const [trocouPlaca, setTrocouPlaca] = useState(false);
  const [vinculo, setVinculo] = useState<Vinculo>({ modo: "aberto" });
  const [dataISO, setDataISO] = useState(() => new Date().toISOString());
  const [outroDia, setOutroDia] = useState(false);
  const [maisDetalhes, setMaisDetalhes] = useState(false);
  const [repetidos, setRepetidos] = useState<GastoVisto[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const hidratou = useRef(false);
  /** Corrigindo um pendente que já subiu (ou foi apagado) enquanto a tela abria. */
  const [pendenteSumiu, setPendenteSumiu] = useState(false);

  // ---- corrigir um pendente: carrega o que estava guardado
  useEffect(() => {
    if (!params.editarClientId || hidratou.current) return;
    let vivo = true;
    void (async () => {
      const item = (await listPendingDespesas()).find((x) => x.clientId === params.editarClientId);
      if (!vivo) return;
      if (!item) {
        setPendenteSumiu(true);
        return;
      }
      hidratou.current = true;
      const p = item.payload;
      if (typeof p.valor === "number") setCentavos(Math.round(p.valor * 100));
      if (typeof p.descricao === "string") setDescricao(p.descricao);
      if (typeof p.onde === "string") setOnde(p.onde);
      if (typeof p.litros === "number") setLitros(String(p.litros).replace(".", ","));
      if (typeof p.odometro === "number") setOdometro(String(p.odometro));
      if (typeof p.veiculoId === "string") {
        setVeiculoId(p.veiculoId);
        setTrocouPlaca(true);
      }
      if (typeof p.data === "string") setDataISO(p.data);
      if (typeof p.semComprovanteMotivo === "string") {
        setJustificativa(p.semComprovanteMotivo);
        setSemComprovante(true);
      }
      if (params.fotoDeNovo !== "1" && item.fotos[0]) {
        setFoto({ uri: item.fotos[0].uri, mime: item.fotos[0].mime });
      }
      if (p.foraDeViagem === true) setVinculo({ modo: "fora" });
      else if (typeof p.viagemId === "string" || typeof p.viagemClientId === "string") {
        setVinculo({
          modo: "nesta",
          viagem: {
            chave: "editando",
            viagemId: typeof p.viagemId === "string" ? p.viagemId : null,
            clientId: typeof p.viagemClientId === "string" ? p.viagemClientId : null,
            rotulo: item.resumo.viagemRotulo ?? "Viagem escolhida",
            dia: diaSP(String(p.data ?? Date.now())),
            inicio: null,
            emAndamento: false,
            veiculoId: null,
            placa: null,
          },
        });
      }
      setTipoReserva(
        tipoDeReserva({
          id: String(p.tipoDespesaId ?? params.tipoId),
          nome: item.resumo.tipoNome,
          icone: item.resumo.tipoIcone,
          reembolsa: item.resumo.reembolsa,
          campos: item.resumo.campos,
          camposVersao: typeof p.camposVersao === "number" ? p.camposVersao : 1,
        }),
      );
    })();
    return () => {
      vivo = false;
    };
  }, [params.editarClientId, params.fotoDeNovo, params.tipoId]);

  // ---- corrigir um enviado: carrega da lista do servidor (cache)
  useEffect(() => {
    if (!params.despesaId || hidratou.current) return;
    const g = gastos.find((x) => x.despesaId === params.despesaId);
    if (!g?.servidor) return;
    hidratou.current = true;
    const d = g.servidor;
    setTipoReserva(
      tipoDeReserva({ id: d.tipoId ?? params.tipoId, nome: d.tipoNome, icone: d.tipoIcone, reembolsa: g.reembolsa }),
    );
    setCentavos(Math.round(d.valorInformado * 100));
    if (d.descricao) setDescricao(d.descricao);
    if (d.onde) setOnde(d.onde);
    if (d.litros != null) setLitros(String(d.litros).replace(".", ","));
    if (d.odometro != null) setOdometro(String(d.odometro));
    if (d.veiculo) {
      setVeiculoId(d.veiculo.id);
      setTrocouPlaca(true);
    }
    setDataISO(d.data);
    if (d.semComprovanteMotivo) {
      setJustificativa(d.semComprovanteMotivo);
      setSemComprovante(true);
    }
  }, [params.despesaId, gastos]);

  // ---- a viagem
  const viagemDoContexto: ViagemConhecida | null = useMemo(() => {
    if (!params.viagemClientId) return null;
    return {
      chave: "contexto",
      viagemId: null,
      clientId: params.viagemClientId,
      rotulo: params.viagemRotulo ?? "Esta viagem",
      dia: diaSP(Date.now()),
      inicio: null,
      emAndamento: true,
      veiculoId: params.veiculoId ?? null,
      placa: null,
    };
  }, [params.viagemClientId, params.viagemRotulo, params.veiculoId]);
  const candidata = useMemo(
    () => (daViagem || corrigindoEnviado ? null : sugerirViagem(viagens, dataISO)),
    [daViagem, corrigindoEnviado, viagens, dataISO],
  );
  const viagemEscolhida: ViagemConhecida | null =
    viagemDoContexto ??
    (vinculo.modo === "nesta" ? vinculo.viagem : vinculo.modo === "escolher" ? vinculo.viagem : null);

  const placas = useMemo(
    () => new Map((cat.data?.veiculos ?? []).map((v) => [v.id, v.placa])),
    [cat.data?.veiculos],
  );
  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );
  // A placa da viagem é FATO da viagem, não escolha feita pelo app.
  const placaDaViagem =
    !trocouPlaca && viagemEscolhida?.veiculoId ? viagemEscolhida.veiculoId : null;
  const veiculoFinal = placaDaViagem ?? (veiculoId || null);

  const opcoesViagem: SelectOption[] = useMemo(
    () =>
      viagensRecentes(viagens, 7).map((v) => ({
        value: v.chave,
        label: `${diaFalado(v.dia)} · ${v.rotulo}`,
        sublabel: v.placa ?? undefined,
      })),
    [viagens],
  );

  if (!modulo.lancar) return <SemGastoDeViagem titulo="Gasto de viagem" />;

  if (!tipo) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Gasto de viagem" />
        <View className="flex-1 items-center justify-center gap-4 p-6">
          {pendenteSumiu ? (
            <>
              <Text className="text-center text-base text-foreground">
                Esse gasto já foi pro escritório. Pra mudar, abra ele em Meus gastos.
              </Text>
              <Button variant="outline" onPress={() => router.back()}>
                Voltar
              </Button>
            </>
          ) : tipos.carregando || editando || corrigindoEnviado ? (
            <ActivityIndicator />
          ) : (
            <>
              <Text className="text-center text-base text-foreground">
                Esse tipo de gasto saiu da lista do escritório. Escolha outro.
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

  const cfg = tipo.cfg;
  const campos = cfg.campos;
  const outro = ehTipoOutro(tipo);
  const pergunta = (c: CampoDespesa) => campos[c].pergunta ?? CAMPO_DESPESA_PERGUNTA_PADRAO[c];
  const exemploObs =
    campos.descricao.exemplo ?? (outro ? "ex.: taxa da balança" : "ex.: remendo no pneu traseiro");
  const obrigatorios = CAMPOS_DESPESA.filter((c) => campos[c].modo === "OBRIGATORIO");
  const opcionais = CAMPOS_DESPESA.filter((c) => campos[c].modo === "OPCIONAL");
  const valor = centavos / 100;
  const hoje = diaSP(Date.now());
  const diaDoGasto = diaSP(dataISO);

  function rolarProFim() {
    setTimeout(() => val.scrollRef.current?.scrollToEnd({ animated: true }), 250);
  }

  // ---- validação (ordem visual, um por vez)
  function validar(): boolean {
    val.limpar();
    if (cfg.foto === "EXIGE" && !foto && !(semComprovante && justificativa.trim())) {
      return val.apontar("foto", "Fotografe o comprovante ou conte o que aconteceu");
    }
    if (!(centavos > 0)) return val.apontar("valor", "Digite quanto você pagou");
    // Mesmo teto do servidor (CriarDespesaInput.valor ≤ 50.000): sem isto o
    // gasto ia pra fila e voltava 400 pros Pendentes, sem dizer o porquê na hora.
    if (centavos > 5_000_000) return val.apontar("valor", "Confira o valor: passou de R$ 50.000,00");
    for (const c of obrigatorios) {
      if (c === "descricao" && !descricao.trim()) {
        return val.apontar(
          "descricao",
          outro ? "Conte o que você pagou" : `Conte ${pergunta("descricao").replace(/\?$/, "").toLowerCase()}`,
        );
      }
      if (c === "placa" && !veiculoFinal) return val.apontar("placa", "Escolha o caminhão");
      if (c === "litros" && !(parseFloat(litros.replace(",", ".")) > 0)) {
        return val.apontar("litros", "Digite quantos litros");
      }
      if (c === "odometro" && !(parseInt(odometro.replace(/\D/g, ""), 10) > 0)) {
        return val.apontar("odometro", "Digite o odômetro");
      }
      if (c === "onde" && !onde.trim()) {
        return val.apontar("onde", "Diga onde foi");
      }
    }
    return true;
  }

  function montar(confirmouNaoRepetido: boolean): NovaDespesa {
    const v = viagemEscolhida;
    return {
      clientId,
      tipoDespesaId: tipo!.id,
      data: dataISO,
      valor,
      veiculoId: campos.placa.modo !== "OCULTO" ? veiculoFinal : null,
      viagemId: v?.viagemId ?? null,
      viagemClientId: v ? (v.viagemId ? null : v.clientId) : null,
      foraDeViagem: !daViagem && vinculo.modo === "fora",
      descricao: campos.descricao.modo !== "OCULTO" ? descricao : null,
      onde: campos.onde.modo !== "OCULTO" ? onde : null,
      litros:
        campos.litros.modo !== "OCULTO" && litros.trim()
          ? parseFloat(litros.replace(",", ".")) || null
          : null,
      odometro:
        campos.odometro.modo !== "OCULTO" && odometro.trim()
          ? parseInt(odometro.replace(/\D/g, ""), 10) || null
          : null,
      semComprovanteMotivo: !foto && semComprovante ? justificativa : null,
      camposVersao: tipo!.camposVersao,
      confirmouQueEOutro: confirmouNaoRepetido,
      criadoOfflineEm: new Date().toISOString(),
    };
  }

  function voltarPraOrigem() {
    const n = Math.max(1, parseInt(params.voltar ?? "1", 10) || 1);
    try {
      if (n > 1) router.dismiss(n);
      else router.back();
    } catch {
      router.back();
    }
  }

  async function salvar(confirmouNaoRepetido = false) {
    if (salvando) return;
    setErro(null);
    if (!validar()) return;
    if (!confirmouNaoRepetido && !corrigindoEnviado) {
      const iguais = procurarRepetidos(gastos, {
        tipoId: tipo!.id,
        valor,
        dia: diaDoGasto,
        ignorarClientId: params.editarClientId ?? null,
      });
      if (iguais.length > 0) {
        setRepetidos(iguais);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        rolarProFim();
        return;
      }
    }
    setSalvando(true);
    try {
      const nova = montar(confirmouNaoRepetido);
      const corpo = montarCorpoDespesa(nova);
      const resumo = {
        tipoNome: tipo!.nome,
        tipoIcone: tipo!.icone,
        reembolsa: tipo!.reembolsa,
        viagemRotulo: viagemEscolhida?.rotulo ?? null,
        campos: cfg,
      };
      if (corrigindoEnviado) {
        // Gasto já está com o escritório: a correção precisa de internet.
        const { clientId: _c, criadoOfflineEm: _o, ...resto } = corpo;
        await corrigirDespesa(params.despesaId!, resto);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Sem isto a lista e o detalhe seguiam mostrando o valor de antes.
        await qc.invalidateQueries({ queryKey: ["despesas"] });
        router.back();
        return;
      }
      const fotos = foto ? [foto] : [];
      if (editando) {
        const r = await atualizarDespesaPendente({ clientId, payload: corpo, fotos, resumo });
        if (r.removed) {
          setErro("Esse gasto já tinha ido pro escritório. Pra mudar, abra ele em Meus gastos.");
          return;
        }
      } else {
        await enqueueDespesa({ clientId, payload: corpo, fotos, resumo });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const ctx: Record<string, string> = {};
      if (params.viagemClientId) ctx.viagemClientId = params.viagemClientId;
      if (params.viagemRotulo) ctx.viagemRotulo = params.viagemRotulo;
      if (params.veiculoId) ctx.veiculoId = params.veiculoId;
      if (params.viagemClientId) ctx.voltar = "2";
      marcarGastoSalvo({ clientId, params: ctx });
      if (editando) router.back();
      else voltarPraOrigem();
    } catch (err) {
      setErro(
        corrigindoEnviado
          ? `Não deu pra corrigir agora. ${humanizeApiError(err)}`
          : humanizeApiError(err),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSalvando(false);
    }
  }

  // ---- pedaços da tela -------------------------------------------------------

  const linhaViagemFixa = viagemDoContexto ? (
    <View className="rounded-xl bg-secondary px-4 py-3">
      <Text className="text-base text-foreground">
        <Text className="font-semibold">Viagem: </Text>
        {viagemDoContexto.rotulo}
      </Text>
    </View>
  ) : null;

  const blocoFoto =
    cfg.foto === "NAO_PEDE" || corrigindoEnviado ? null : (
      <View ref={val.refCampo("foto")} onLayout={val.onLayoutCampo("foto")} className="gap-2">
        <Label error={!!val.erroDe("foto")}>Foto do comprovante</Label>
        {semComprovante && !foto ? (
          cfg.foto === "EXIGE" ? (
            <View className="gap-2">
              <Text className="text-base font-semibold text-foreground">O que aconteceu?</Text>
              <Input
                value={justificativa}
                onChangeText={(t) => {
                  val.limpar();
                  setJustificativa(t);
                }}
                placeholder="ex.: o borracheiro não deu nota"
                multiline
                className="h-auto min-h-[64px]"
                maxLength={300}
                error={!!val.erroDe("foto")}
              />
              <BotaoAcao Icone={Camera} onPress={() => setSemComprovante(false)}>
                Fotografar o comprovante
              </BotaoAcao>
            </View>
          ) : (
            <View className="gap-2">
              <Text className="text-base text-muted-foreground">Sem comprovante.</Text>
              <BotaoAcao Icone={Camera} onPress={() => setSemComprovante(false)}>
                Fotografar o comprovante
              </BotaoAcao>
            </View>
          )
        ) : (
          <PhotoCapture
            value={foto}
            onChange={(f) => {
              val.limpar();
              setFoto(f);
              if (f) {
                setSemComprovante(false);
                setCameraNegada(false);
              }
            }}
            renderComFoto={({ abrirCamera }) => (
              <View className="flex-row items-center gap-3 rounded-xl border-2 border-border p-2">
                {foto ? (
                  <Image
                    source={{ uri: foto.uri }}
                    style={{ width: 96, height: 96, borderRadius: 8 }}
                    resizeMode="cover"
                  />
                ) : null}
                <View className="flex-1 gap-2">
                  <View className="flex-row items-center gap-1.5">
                    <Check size={18} color="#15803d" />
                    <Text className="text-base font-semibold text-green-800">Foto guardada</Text>
                  </View>
                  <BotaoAcao Icone={Camera} className="px-3" onPress={() => void abrirCamera()}>
                    Tirar outra foto
                  </BotaoAcao>
                </View>
              </View>
            )}
            renderVazio={({ abrirCamera, abrirGaleria, escolhendo }) => (
              <View className="gap-2">
                <Pressable
                  onPress={() =>
                    void abrirCamera().then((ok) => {
                      setCameraNegada(!ok);
                    })
                  }
                  accessibilityRole="button"
                  className={`items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted/30 px-4 ${
                    val.erroDe("foto") ? "border-destructive" : "border-border"
                  }`}
                  style={{ height: 180 }}
                >
                  <Camera size={32} color="#475569" />
                  {cameraNegada ? (
                    <Text className="text-center text-base text-foreground">
                      O celular não deixou abrir a câmera.
                    </Text>
                  ) : (
                    <Text className="text-lg font-semibold text-foreground">Fotografar o papel</Text>
                  )}
                </Pressable>
                {cameraNegada ? (
                  <Button variant="outline" onPress={() => void Linking.openSettings().catch(() => {})}>
                    Abrir ajustes do celular
                  </Button>
                ) : null}
                <BotaoAcao Icone={Images} onPress={abrirGaleria} disabled={escolhendo}>
                  Escolher da galeria
                </BotaoAcao>
                {!cameraNegada ? (
                  <BotaoAcao
                    Icone={FileX}
                    onPress={() => {
                      val.limpar();
                      setSemComprovante(true);
                    }}
                  >
                    Não tenho o comprovante
                  </BotaoAcao>
                ) : null}
              </View>
            )}
          />
        )}
        {val.erroDe("foto") ? <ErroCampo msg={val.erroDe("foto")!} /> : null}
      </View>
    );

  const blocoValor = (
    <View ref={val.refCampo("valor")} onLayout={val.onLayoutCampo("valor")} className="gap-2">
      <Label error={!!val.erroDe("valor")}>Valor</Label>
      <Input
        value={centavos > 0 ? fmtReais(valor) : ""}
        onChangeText={(t) => {
          val.limpar();
          setRepetidos(null);
          setCentavos(centavosDoTexto(t));
        }}
        keyboardType="number-pad"
        placeholder="R$ 0,00"
        className="font-bold"
        // Altura e métrica da fonte no `style` (vence o className): com
        // h-16 + py-2 + 28px o "R$ 0,00" saía cortado ao meio no celular.
        style={ESTILO_VALOR}
        error={!!val.erroDe("valor")}
        accessibilityLabel="Valor que você pagou"
      />
      {tipo.tetoValor ? (
        <Text className="text-[13px] text-muted-foreground">
          Devolvido até {fmtReais(tipo.tetoValor)} por gasto.
        </Text>
      ) : null}
      {val.erroDe("valor") ? <ErroCampo msg={val.erroDe("valor")!} /> : null}
    </View>
  );

  function campoTexto(c: CampoDespesa, opcional: boolean) {
    const erroDe = val.erroDe(c);
    const wrap = (children: React.ReactNode) => (
      <View key={c} ref={val.refCampo(c)} onLayout={val.onLayoutCampo(c)} className="gap-2">
        {children}
        {erroDe ? <ErroCampo msg={erroDe} /> : null}
      </View>
    );
    const aoFocar = opcional ? rolarProFim : undefined;
    if (c === "descricao") {
      return wrap(
        <>
          <Label error={!!erroDe}>{pergunta("descricao")}</Label>
          <Input
            value={descricao}
            onChangeText={(t) => {
              val.limpar();
              setDescricao(t);
            }}
            placeholder={exemploObs}
            multiline
            className="h-auto min-h-[64px]"
            maxLength={500}
            onFocus={aoFocar}
            error={!!erroDe}
          />
        </>,
      );
    }
    if (c === "placa") {
      return wrap(
        <>
          <Label error={!!erroDe}>{pergunta("placa")}</Label>
          {placaDaViagem ? (
            <View className="gap-2">
              <Text className="text-base text-foreground">
                Caminhão: <Text className="font-semibold">{placas.get(placaDaViagem) ?? viagemEscolhida?.placa ?? "da viagem"}</Text> (da viagem)
              </Text>
              <BotaoAcao Icone={Pencil} onPress={() => setTrocouPlaca(true)}>
                Trocar o caminhão
              </BotaoAcao>
            </View>
          ) : (
            <Select
              value={veiculoId}
              onChange={(v) => {
                val.limpar();
                setVeiculoId(v);
                setTrocouPlaca(true);
              }}
              options={veiculoOptions}
              placeholder="Escolha a placa"
              searchable
              error={!!erroDe}
            />
          )}
          {tipo!.manutencao ? (
            <Text className="text-[13px] text-muted-foreground">Vai pro histórico deste caminhão.</Text>
          ) : null}
        </>,
      );
    }
    if (c === "litros") {
      return wrap(
        <>
          <Label error={!!erroDe}>{pergunta("litros")}</Label>
          <Input
            value={litros}
            onChangeText={(t) => {
              val.limpar();
              setLitros(t);
            }}
            keyboardType="decimal-pad"
            placeholder="0,0"
            maxLength={8}
            onFocus={aoFocar}
            error={!!erroDe}
          />
        </>,
      );
    }
    if (c === "odometro") {
      return wrap(
        <>
          <Label error={!!erroDe}>{pergunta("odometro")}</Label>
          <Input
            value={odometro}
            onChangeText={(t) => {
              val.limpar();
              setOdometro(t.replace(/\D/g, ""));
            }}
            keyboardType="number-pad"
            placeholder="ex.: 412330"
            maxLength={8}
            onFocus={aoFocar}
            error={!!erroDe}
          />
        </>,
      );
    }
    return wrap(
      <>
        <Label error={!!erroDe}>{pergunta("onde")}</Label>
        <Input
          value={onde}
          onChangeText={(t) => {
            val.limpar();
            setOnde(t);
          }}
          placeholder={campos.onde.exemplo ?? "ex.: Borracharia do Zé, BR-376"}
          maxLength={160}
          onFocus={aoFocar}
          error={!!erroDe}
        />
      </>,
    );
  }

  // "Foi nesta viagem?" — dois botões contorno iguais, NENHUM marcado.
  const cardViagem =
    daViagem || corrigindoEnviado || (!candidata && vinculo.modo === "aberto") ? null : (
      <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
        {vinculo.modo === "aberto" && candidata ? (
          <>
            <Text className="text-base font-semibold text-foreground">Foi nesta viagem?</Text>
            <View>
              <Text className="text-base font-semibold text-foreground">{candidata.rotulo}</Text>
              <Text className="text-sm text-muted-foreground">
                {candidata.emAndamento
                  ? `em andamento${candidata.inicio ? ` · começou ${horaSP(candidata.inicio)}` : ""}`
                  : `${diaFalado(candidata.dia)}${candidata.placa ? ` · ${candidata.placa}` : ""}`}
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => {
                  setRepetidos(null);
                  setVinculo({ modo: "nesta", viagem: candidata });
                }}
              >
                Foi nesta viagem
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => setVinculo({ modo: "escolher", viagem: null })}
              >
                Não foi nesta
              </Button>
            </View>
          </>
        ) : vinculo.modo === "nesta" ? (
          <>
            <Text className="text-base font-semibold text-foreground">{vinculo.viagem.rotulo}</Text>
            <View className="flex-row items-center gap-3">
              <View className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-success py-4">
                <Check size={20} color="white" />
                <Text className="text-base font-semibold text-white">Foi nesta viagem</Text>
              </View>
              <BotaoAcao
                Icone={Undo2}
                onPress={() => {
                  setTrocouPlaca(false);
                  setVinculo({ modo: "aberto" });
                }}
              >
                Desfazer
              </BotaoAcao>
            </View>
          </>
        ) : vinculo.modo === "escolher" ? (
          <>
            <Text className="text-base font-semibold text-foreground">Em qual viagem foi?</Text>
            <Select
              value={vinculo.viagem?.chave ?? ""}
              onChange={(k) => {
                const v = viagens.find((x) => x.chave === k) ?? null;
                setTrocouPlaca(false);
                setVinculo({ modo: "escolher", viagem: v });
              }}
              options={opcoesViagem}
              placeholder="Escolha a viagem"
              searchable
              emptyMessage="Nenhuma viagem dos últimos 7 dias neste celular."
            />
            <BotaoAcao Icone={MapPinOff} onPress={() => setVinculo({ modo: "fora" })}>
              Não foi em viagem
            </BotaoAcao>
          </>
        ) : (
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 text-base text-muted-foreground">Fora de viagem</Text>
            <BotaoAcao Icone={Pencil} onPress={() => setVinculo({ modo: "aberto" })}>
              Mudar
            </BotaoAcao>
          </View>
        )}
      </View>
    );

  const linhaData = (
    <View className="gap-2">
      <Text className="text-base text-muted-foreground">
        {diaDoGasto === hoje ? "Hoje" : diaFalado(diaDoGasto)}, {horaSP(dataISO)}
      </Text>
      {!outroDia ? (
        <BotaoAcao Icone={CalendarDays} onPress={() => setOutroDia(true)}>
          Foi em outro dia
        </BotaoAcao>
      ) : null}
      {outroDia ? (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <DateField
              value={diaDoGasto}
              onChange={(d) => {
                setRepetidos(null);
                setDataISO(isoDeDataHoraBR(d, horaSP(dataISO)) ?? dataISO);
              }}
            />
          </View>
          <View className="flex-1">
            <HoraField
              value={dataISO}
              data={diaDoGasto}
              onChange={(iso) => setDataISO(iso)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  const blocoMaisDetalhes =
    opcionais.length === 0 ? null : (
      <View className="gap-4">
        <Pressable
          onPress={() => {
            setMaisDetalhes((m) => !m);
            if (!maisDetalhes) rolarProFim();
          }}
          className="flex-row items-center gap-2"
          style={{ minHeight: 56 }}
          accessibilityRole="button"
        >
          {maisDetalhes ? <ChevronDown size={20} color="#475569" /> : <ChevronRight size={20} color="#475569" />}
          <Text className="flex-1 text-base font-semibold text-foreground">
            Mais detalhes ({opcionais.map((c) => NOME_CURTO[c]).join(", ")})
          </Text>
        </Pressable>
        {maisDetalhes ? opcionais.map((c) => campoTexto(c, true)) : null}
      </View>
    );

  const repetidoTexto = repetidos
    ? repetidos.length === 1
      ? `Você já lançou ${tipo.nome} de ${fmtReais(valor)} ${diaDoGasto === hoje ? "hoje" : `em ${diaFalado(diaDoGasto)}`} às ${horaSP(repetidos[0]!.data)}. É outro?`
      : `Você já lançou ${repetidos.length} de ${tipo.nome} de ${fmtReais(valor)} ${diaDoGasto === hoje ? "hoje" : `em ${diaFalado(diaDoGasto)}`} (${repetidos.map((r) => horaSP(r.data)).join(" e ")}). É outro?`
    : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={corrigindoEnviado || editando ? `Corrigir ${tipo.nome.toLowerCase()}` : tipo.nome} />
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          ref={val.scrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          <View ref={val.conteudoRef} className="gap-4">
            {linhaViagemFixa}
            {blocoFoto}
            {blocoValor}
            {obrigatorios.map((c) => campoTexto(c, false))}
            {cardViagem}
            {linhaData}
            {blocoMaisDetalhes}
            {erro ? <ErroCampo msg={erro} /> : null}

            {repetidoTexto ? (
              <View className="gap-3 rounded-2xl border-2 border-amber-500 bg-amber-50 p-4">
                <View className="flex-row items-start gap-2">
                  <TriangleAlert size={20} color="#b45309" />
                  <Text className="flex-1 text-[17px] font-semibold text-amber-900">{repetidoTexto}</Text>
                </View>
                <Button variant="warning" className="h-16" onPress={() => void salvar(true)} loading={salvando}>
                  É outro — salvar este
                </Button>
                <Button
                  variant="outline"
                  onPress={() => {
                    // Não grava nada; o lançado antes continua.
                    setRepetidos(null);
                    router.back();
                  }}
                >
                  É o mesmo — não salvar
                </Button>
              </View>
            ) : (
              <Button size="lg" className="h-20" onPress={() => void salvar(false)} loading={salvando}>
                <Check size={24} color="white" />
                <Text className="text-xl font-bold text-primary-foreground">
                  {salvando ? "Salvando..." : corrigindoEnviado || editando ? "Salvar correção" : "Salvar gasto"}
                </Text>
              </Button>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
