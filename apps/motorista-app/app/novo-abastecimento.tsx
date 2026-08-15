import { useEffect, useMemo, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { fmtDataBR, hojeISO } from "@/lib/datetime";
import { humanizeZodError } from "@/lib/validation";
import { CriarAbastecimentoInput } from "@ronan/shared-types";
import {
  useAbastecimentos,
  useCatalogos,
  useCriarAbastecimento,
  useMe,
  usePostosRecentes,
} from "@/lib/queries";
import { atualizarAbastecimentoPendente } from "@/lib/sync";
import { listPendingAbastecimentos } from "@/db/database";
import { usePendingAbastecimentos } from "@/hooks/use-pending-abastecimentos";
import { pegarCoordsPrecisa } from "@/lib/geo";

type TipoCombustivel =
  | "DIESEL_S10"
  | "DIESEL_S500"
  | "ARLA_32"
  | "GASOLINA"
  | "ETANOL";

const TIPOS: { value: TipoCombustivel; label: string }[] = [
  { value: "DIESEL_S10", label: "Diesel S10" },
  { value: "DIESEL_S500", label: "Diesel S500" },
  { value: "ARLA_32", label: "ARLA 32" },
  { value: "GASOLINA", label: "Gasolina" },
  { value: "ETANOL", label: "Etanol" },
];

const today = hojeISO;

export default function NovoAbastecimento() {
  // Modo edição: quando vem da tela de Pendentes com um abastecimento travado,
  // pré-preenche pra o motorista corrigir (ex: odômetro recusado pelo servidor)
  // e reenviar — sem redigitar tudo.
  const { editarClientId } = useLocalSearchParams<{ editarClientId?: string }>();
  const editando = !!editarClientId;

  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarAbastecimento();
  const postos = usePostosRecentes();
  // Pra validação de odômetro local: lista de abastecimentos do mês atual.
  // Não é 100% (motorista pode ter abastecido no mês passado e estar sem net),
  // mas cobre 95% dos casos. Server-side faz checagem definitiva.
  const recentes = useAbastecimentos();
  // Abastecimentos pendentes no outbox — entram no cálculo do último odômetro
  // pra barrar 2 seguidos offline com odômetro decrescente.
  const pendentes = usePendingAbastecimentos();

  const [veiculoId, setVeiculoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [data, setData] = useState(today());
  const [tipo, setTipo] = useState<TipoCombustivel>("DIESEL_S10");
  const [litros, setLitros] = useState("");
  const [valor, setValor] = useState("");
  const [emComboio, setEmComboio] = useState(false);
  const [odometro, setOdometro] = useState("");
  const [postoNome, setPostoNome] = useState("");
  const [tanqueCheio, setTanqueCheio] = useState(true);
  const [observacao, setObservacao] = useState("");
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  // Válvula pra quem não consegue fotografar — ver nova-viagem.tsx.
  const [justificativaSemFoto, setJustificativaSemFoto] = useState("");
  const [pedindoJustificativa, setPedindoJustificativa] = useState(false);

  /**
   * A transportadora exige a foto do cupom? Roda offline (bloco `config` do
   * catálogo). Ausência da flag nunca exige.
   *
   * Mudou de eixo: antes vinha da empresa que paga, e como ela é opcional no
   * abastecimento, quem lançava sem empresa nunca era cobrado.
   */
  const exigeFoto = cat.data?.config?.exigeFotoAbastecimento === true;
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const val = useValidacaoGuiada();
  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    precisao?: number;
  } | null>(null);

  useEffect(() => {
    // Não força o veículo default no modo edição (o pré-preenchimento manda).
    if (!editando && me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega o abastecimento pendente pra editar e preenche os campos.
  useEffect(() => {
    if (!editarClientId) return;
    let alive = true;
    void (async () => {
      const list = await listPendingAbastecimentos();
      const it = list.find((x) => x.clientId === editarClientId);
      if (!alive || !it) return;
      const p = it.payload as Record<string, unknown>;
      if (p.veiculoId) setVeiculoId(String(p.veiculoId));
      if (p.empresaId) setEmpresaId(String(p.empresaId));
      if (p.data) setData(isoParaDataLocal(String(p.data)));
      if (p.tipo) setTipo(p.tipo as TipoCombustivel);
      if (p.litros != null) setLitros(String(p.litros));
      if (p.valorTotal != null) setValor(String(p.valorTotal));
      setEmComboio(!!p.emComboio);
      if (p.odometro != null) setOdometro(String(p.odometro));
      if (p.postoNome) setPostoNome(String(p.postoNome));
      setTanqueCheio(p.tanqueCheio !== false);
      if (p.observacao) setObservacao(String(p.observacao));
    })();
    return () => {
      alive = false;
    };
  }, [editarClientId]);

  // GPS pré-aquece em background
  useEffect(() => {
    let alive = true;
    void pegarCoordsPrecisa().then((res) => {
      if (alive && res.ok) {
        const c = res.coords;
        setCoords({ lat: c.lat, lng: c.lng, precisao: c.precisao ?? undefined });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );

  const empresaOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.empresas ?? []).map((e) => ({
        value: e.id,
        label: e.nome,
      })),
    [cat.data?.empresas],
  );

  const tipoOptions: SelectOption[] = useMemo(
    () => TIPOS.map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  // Preço por litro calculado (R$)
  const precoLitro = useMemo(() => {
    const l = parseFloat(litros.replace(",", "."));
    const v = parseFloat(valor.replace(",", "."));
    if (!Number.isFinite(l) || !Number.isFinite(v) || l <= 0) return null;
    return v / l;
  }, [litros, valor]);

  // Último odômetro efetivo do veículo, combinando 3 fontes: o valor
  // autoritativo do servidor (catálogo, disponível offline pelo cache), os
  // abastecimentos já sincronizados em cache, e os PENDENTES no outbox (fecha
  // o caso de 2 seguidos offline). Editando, ignora o próprio item pra não
  // comparar consigo mesmo.
  //
  // Só conta registro ANTERIOR OU IGUAL à data do lançamento — mesma janela do
  // servidor (abastecimentos.service.ts). Sem isso, lançar um abastecimento
  // retroativo era barrado por um registro posterior do mesmo caminhão.
  const ultimoOdometroDoVeiculo = useMemo<number | null>(() => {
    if (!veiculoId) return null;
    const candidatos: number[] = [];

    // O catálogo traz o odômetro mais recente do veículo, sem data junto — só
    // serve de referência quando o lançamento é de hoje.
    const doCatalogo = cat.data?.veiculos.find((v) => v.id === veiculoId)?.ultimoOdometro;
    if (typeof doCatalogo === "number" && data >= hojeISO()) candidatos.push(doCatalogo);

    for (const a of recentes.data ?? []) {
      if (a.veiculo.id === veiculoId && a.data.slice(0, 10) <= data) {
        candidatos.push(a.odometro);
      }
    }

    for (const p of pendentes) {
      if (p.clientId === editarClientId) continue;
      const pl = p.payload as {
        veiculoId?: unknown;
        odometro?: unknown;
        data?: unknown;
      };
      const dataPendente = String(pl.data ?? "").slice(0, 10);
      if (
        String(pl.veiculoId) === veiculoId &&
        typeof pl.odometro === "number" &&
        (!dataPendente || dataPendente <= data)
      ) {
        candidatos.push(pl.odometro);
      }
    }

    return candidatos.length > 0 ? Math.max(...candidatos) : null;
  }, [veiculoId, cat.data, recentes.data, pendentes, editarClientId, data]);

  async function salvar() {
    setErro(null);
    val.limpar();

    if (!veiculoId) return void val.apontar("veiculoId", "Escolha a placa");
    if (!empresaId) return void val.apontar("empresaId", "Escolha a empresa");
    const litrosNum = parseFloat(litros.replace(",", "."));
    if (!Number.isFinite(litrosNum) || litrosNum <= 0) {
      return void val.apontar("litros", "Informe os litros");
    }
    const valorNum = parseFloat(valor.replace(",", "."));
    if (!emComboio && (!Number.isFinite(valorNum) || valorNum <= 0)) {
      return void val.apontar("valor", 'Informe o valor (ou marque "em comboio")');
    }
    const odometroNum = parseInt(odometro.replace(/\D/g, ""), 10);
    if (!Number.isFinite(odometroNum) || odometroNum < 0) {
      return void val.apontar("odometro", "Informe o odômetro");
    }
    // Foto do cupom exigida pela empresa (com saída pela justificativa).
    if (exigeFoto && !foto) {
      const texto = justificativaSemFoto.trim();
      if (!texto) {
        return void val.apontar(
          "foto",
          "A foto do cupom é obrigatória. Tire a foto ou explique por que não dá.",
        );
      }
      if (texto.length < 10) {
        return void val.apontar(
          "justificativaSemFoto",
          "Escreva um pouco mais — o escritório precisa entender o motivo.",
        );
      }
    }
    if (
      ultimoOdometroDoVeiculo !== null &&
      odometroNum < ultimoOdometroDoVeiculo
    ) {
      return void val.apontar(
        "odometro",
        `Odômetro (${odometroNum} km) é menor que o último registrado pra esse veículo (${ultimoOdometroDoVeiculo} km)`,
      );
    }

    let dataFinal = data;
    if (dataFinal !== hojeISO()) {
      const escolha = await showAlert({
        title: "Data diferente de hoje",
        message: `O abastecimento está marcado como ${fmtDataBR(dataFinal)}. Hoje é ${fmtDataBR(hojeISO())}. Tem certeza?`,
        variant: "warning",
        buttons: [
          { label: "Cancelar", value: "cancel", style: "cancel" },
          { label: "Marcar hoje", value: "today" },
          { label: "Confirmar", value: "ok" },
        ],
      });
      if (escolha === "cancel" || escolha === null) return;
      if (escolha === "today") {
        dataFinal = hojeISO();
        setData(dataFinal);
      }
    }

    setSubmitting(true);
    try {
      const c = coords ?? (await pegarCoordsRapido());

      const payload = {
        // Editando: mantém o MESMO clientId (idempotência no servidor).
        clientId: editarClientId ?? makeUuid(),
        veiculoId,
        empresaId,
        justificativaSemFoto:
          exigeFoto && !foto ? justificativaSemFoto.trim() || undefined : undefined,
        // Combina data (YYYY-MM-DD) com hora atual pra timestamp completo
        data: combinarDataComHoraAtual(dataFinal),
        tipo,
        litros: litrosNum,
        valorTotal: emComboio ? undefined : valorNum,
        emComboio,
        odometro: odometroNum,
        postoNome: postoNome.trim() || undefined,
        tanqueCheio,
        observacao: observacao.trim() || undefined,
        criadoOfflineEm: new Date().toISOString(),
        ...(c
          ? { lat: c.lat, lng: c.lng, ...(c.precisao ? { precisao: c.precisao } : {}) }
          : {}),
      };
      const parsed = CriarAbastecimentoInput.safeParse(payload);
      if (!parsed.success) {
        setErro(humanizeZodError(parsed.error));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setSubmitting(false);
        return;
      }

      if (editando) {
        const res = await atualizarAbastecimentoPendente({
          clientId: editarClientId!,
          payload,
          foto: foto ?? undefined,
        });
        if (res.removed) {
          void showAlert({
            title: "Já sincronizado",
            message: "Esse abastecimento já tinha sido enviado. Nada a corrigir.",
            variant: "default",
          });
        }
      } else {
        await criar({ payload, foto: foto ?? undefined });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader title={editando ? "Editar abastecimento" : "Novo abastecimento"} />

      {(cat.isLoading || me.isLoading) && !cat.data && !me.data && (
        <View className="items-center py-8">
          <ActivityIndicator />
          <Text className="mt-2 text-sm text-muted-foreground">
            Carregando dados...
          </Text>
        </View>
      )}

      {cat.data && (
        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
          <ScrollView
            ref={val.scrollRef}
            contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="gap-2" onLayout={val.onLayoutCampo("veiculoId")}>
              <Label error={!!val.erroDe("veiculoId")}>Placa</Label>
              <Select
                value={veiculoId}
                onChange={(v) => {
                  val.limpar();
                  setVeiculoId(v);
                }}
                options={veiculoOptions}
                placeholder="Escolha a placa"
                searchable
                error={!!val.erroDe("veiculoId")}
              />
              {val.erroDe("veiculoId") ? (
                <ErroCampo msg={val.erroDe("veiculoId")!} />
              ) : null}
            </View>

            <View className="gap-2" onLayout={val.onLayoutCampo("empresaId")}>
              <Label error={!!val.erroDe("empresaId")}>Empresa</Label>
              <Select
                value={empresaId}
                onChange={(v) => {
                  val.limpar();
                  setEmpresaId(v);
                }}
                options={empresaOptions}
                placeholder="Escolha a empresa"
                searchable
                emptyMessage="Nenhuma empresa cadastrada"
                error={!!val.erroDe("empresaId")}
              />
              {val.erroDe("empresaId") ? (
                <ErroCampo msg={val.erroDe("empresaId")!} />
              ) : null}
            </View>

            <View className="gap-2">
              <Label>Data</Label>
              <DateField value={data} onChange={setData} disabled={submitting} />
            </View>

            <View className="gap-2">
              <Label>Tipo de combustível</Label>
              <Select
                value={tipo}
                onChange={(v) => setTipo(v as TipoCombustivel)}
                options={tipoOptions}
                placeholder="Tipo"
              />
            </View>

            <View
              onLayout={(e) => {
                // litros + valor dividem a mesma row → mesma posição de scroll
                val.onLayoutCampo("litros")(e);
                val.onLayoutCampo("valor")(e);
              }}
            >
              <View className="flex-row gap-3">
                <View className="flex-1 gap-2">
                  <Label error={!!val.erroDe("litros")}>Litros</Label>
                  <Input
                    value={litros}
                    onChangeText={(v) => {
                      val.limpar();
                      setLitros(v);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0,000"
                    editable={!submitting}
                    maxLength={8}
                    error={!!val.erroDe("litros")}
                  />
                  <Text className="text-xs text-muted-foreground">
                    Em litros (máx 2000)
                  </Text>
                </View>
                <View className="flex-1 gap-2">
                  <Label error={!!val.erroDe("valor")}>Valor (R$)</Label>
                  <Input
                    value={emComboio ? "" : valor}
                    onChangeText={(v) => {
                      val.limpar();
                      setValor(v);
                    }}
                    keyboardType="decimal-pad"
                    placeholder={emComboio ? "—" : "0,00"}
                    editable={!submitting && !emComboio}
                    maxLength={8}
                    error={!!val.erroDe("valor")}
                  />
                  <Text className="text-xs text-muted-foreground">
                    {emComboio ? "Preenchido depois pelo escritório" : "Em R$ (máx 50000)"}
                  </Text>
                </View>
              </View>
              {val.erroDe("litros") ? (
                <ErroCampo msg={val.erroDe("litros")!} />
              ) : null}
              {val.erroDe("valor") ? (
                <ErroCampo msg={val.erroDe("valor")!} />
              ) : null}
            </View>

            <View className="flex-row items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Switch
                value={emComboio}
                onValueChange={setEmComboio}
                disabled={submitting}
              />
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  Abastecimento em comboio
                </Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  Marque se ainda não soube o valor. O escritório completa depois.
                </Text>
              </View>
            </View>

            {!emComboio && precoLitro !== null && (
              <View className="rounded-md bg-muted px-3 py-2">
                <Text className="text-xs text-muted-foreground">
                  Preço por litro
                </Text>
                <Text className="text-base font-semibold">
                  R$ {precoLitro.toFixed(3).replace(".", ",")}/L
                </Text>
              </View>
            )}

            <View className="gap-2" onLayout={val.onLayoutCampo("odometro")}>
              <Label error={!!val.erroDe("odometro")}>Odômetro (km)</Label>
              <Input
                value={odometro}
                onChangeText={(v) => {
                  val.limpar();
                  setOdometro(v.replace(/\D/g, ""));
                }}
                keyboardType="number-pad"
                placeholder="123456"
                editable={!submitting}
                maxLength={8}
                error={!!val.erroDe("odometro")}
              />
              {val.erroDe("odometro") ? (
                <ErroCampo msg={val.erroDe("odometro")!} />
              ) : null}
              {ultimoOdometroDoVeiculo !== null &&
                (() => {
                  const n = parseInt(odometro.replace(/\D/g, ""), 10);
                  const abaixo = Number.isFinite(n) && n < ultimoOdometroDoVeiculo;
                  return abaixo ? (
                    <Text className="text-xs font-semibold text-destructive">
                      Odômetro menor que o último registrado (
                      {ultimoOdometroDoVeiculo.toLocaleString("pt-BR")} km). Confira o valor.
                    </Text>
                  ) : (
                    <Text className="text-xs text-muted-foreground">
                      Último registrado: {ultimoOdometroDoVeiculo.toLocaleString("pt-BR")} km
                    </Text>
                  );
                })()}
            </View>

            <View className="gap-2">
              <Label>Posto</Label>
              <Input
                value={postoNome}
                onChangeText={setPostoNome}
                placeholder='ex: "Posto Trevo BR-376"'
                autoCapitalize="words"
                editable={!submitting}
                maxLength={120}
              />
              {postos.data && postos.data.length > 0 && (
                <View className="flex-row flex-wrap gap-1">
                  {postos.data.slice(0, 5).map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setPostoNome(p)}
                      className="rounded-full border border-border bg-muted/40 px-3 py-1"
                    >
                      <Text className="text-xs">{p}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View className="flex-row items-center justify-between rounded-lg border border-border p-3">
              <View className="flex-1 pr-2">
                <Text className="font-medium">Tanque cheio</Text>
                <Text className="text-xs text-muted-foreground">
                  Marque se completou o tanque — usado pra calcular consumo médio.
                </Text>
              </View>
              <Switch
                value={tanqueCheio}
                onValueChange={setTanqueCheio}
                disabled={submitting}
              />
            </View>

            <View className="gap-2">
              <Label>Observação</Label>
              <Input
                value={observacao}
                onChangeText={setObservacao}
                placeholder="opcional"
                editable={!submitting}
                maxLength={500}
              />
            </View>

            <View
              className="gap-2"
              ref={val.refCampo("foto")}
              onLayout={val.onLayoutCampo("foto")}
            >
              <Label error={!!val.erroDe("foto")}>Foto do comprovante</Label>
              <Text className="text-xs text-muted-foreground">
                {exigeFoto ? "obrigatória neste lançamento" : "opcional"}
              </Text>
              <PhotoCapture value={foto} onChange={setFoto} />
              {val.erroDe("foto") ? <ErroCampo msg={val.erroDe("foto")!} /> : null}
              {exigeFoto &&
                !foto &&
                (pedindoJustificativa ? (
                  <View className="gap-2">
                    <Label error={!!val.erroDe("justificativaSemFoto")}>
                      Por que não dá pra tirar a foto?
                    </Label>
                    <Input
                      value={justificativaSemFoto}
                      onChangeText={(v) => {
                        val.limpar();
                        setJustificativaSemFoto(v);
                      }}
                      placeholder="Ex.: a impressora do posto falhou"
                      multiline
                      maxLength={500}
                      error={!!val.erroDe("justificativaSemFoto")}
                    />
                    {val.erroDe("justificativaSemFoto") ? (
                      <ErroCampo msg={val.erroDe("justificativaSemFoto")!} />
                    ) : null}
                  </View>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => setPedindoJustificativa(true)}
                  >
                    <Text className="text-sm font-medium text-foreground">
                      Não consigo tirar a foto agora
                    </Text>
                  </Button>
                ))}
            </View>

            {erro && <Text className="text-sm text-destructive">{erro}</Text>}

            <Button size="lg" className="h-20" onPress={salvar} loading={submitting}>
              <Check size={24} color="white" />
              <Text className="text-xl font-bold text-primary-foreground">
                {submitting ? "Salvando..." : "Salvar abastecimento"}
              </Text>
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

/** ISO datetime → "YYYY-MM-DD" no fuso local (pra repopular o DateField). */
function isoParaDataLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

function combinarDataComHoraAtual(dataYmd: string): string {
  const agora = new Date();
  const [y, m, d] = dataYmd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, agora.getHours(), agora.getMinutes(), agora.getSeconds());
  return dt.toISOString();
}

function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function pegarCoordsRapido(): Promise<{
  lat: number;
  lng: number;
  precisao?: number;
} | null> {
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") return null;
    const last = await Promise.race([
      Location.getLastKnownPositionAsync({
        maxAge: 5 * 60_000,
        requiredAccuracy: 500,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (!last || !("coords" in last)) return null;
    return {
      lat: last.coords.latitude,
      lng: last.coords.longitude,
      precisao: last.coords.accuracy ?? undefined,
    };
  } catch {
    return null;
  }
}
