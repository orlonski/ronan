import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import {
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronRight,
  Plus,
  Send,
  Trash2,
} from "lucide-react-native";
import {
  AJUDA_DOCUMENTO_PESSOAL,
  DOCUMENTO_POR_PLACA,
  ROTULO_DOCUMENTO_PESSOAL,
  TIPOS_DOCUMENTO_PESSOAL,
  type DocumentoPessoal,
  type StatusDocumento,
  type TipoDocumentoPessoal,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { ScreenHeader } from "@/components/screen-header";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/api-url";
import { showAlert, showConfirm } from "@/lib/alert";
import { cacheDocumentos, carregarDocumentos } from "@/lib/pessoal";

/**
 * A carteira do motorista: o que a transportadora e a gerenciadora de risco
 * pedem antes de liberar carga.
 *
 * O autônomo refaz esse cadastro A CADA VIAGEM — então o valor aqui é duplo:
 * saber o que está vencendo antes de perder o frete, e mandar tudo de uma vez
 * pra quem pediu. Ver docs/motorista-sem-empresa.md.
 */
export default function MeusDocumentosScreen() {
  const [docs, setDocs] = useState<DocumentoPessoal[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [editando, setEditando] = useState<DocumentoPessoal | "novo" | null>(null);

  const recarregar = useCallback(async () => {
    try {
      setDocs(await carregarDocumentos());
    } catch {
      /* sem sinal: fica o cache, que já está na tela */
    }
  }, []);

  /** A rodinha só acende no gesto dele — revalidação de fundo é calada. */
  const puxarPraAtualizar = useCallback(async () => {
    setCarregando(true);
    try {
      await recarregar();
    } finally {
      setCarregando(false);
    }
  }, [recarregar]);

  // Cache primeiro, rede depois. A tela era 100% online: offline ela abria
  // VAZIA — e é na estrada, sem sinal, que ele precisa conferir se a CNH
  // venceu antes de aceitar a carga.
  useEffect(() => {
    void cacheDocumentos().then((c) => {
      if (c.length) setDocs(c);
    });
    void recarregar();
  }, [recarregar]);

  const vencidos = docs.filter((d) => d.status === "VENCIDO");
  const vencendo = docs.filter((d) => d.status === "VENCENDO");

  async function apagar(d: DocumentoPessoal) {
    const ok = await showConfirm({
      title: `Apagar ${ROTULO_DOCUMENTO_PESSOAL[d.tipo]}?`,
      message: "A foto guardada também sai.",
      confirmLabel: "Apagar",
      destructive: true,
    });
    if (!ok) return;
    await api.apagarDocumento(d.id).catch(() => {});
    await recarregar();
  }

  /** Gera o link do cadastro e abre o compartilhamento — vai pro WhatsApp de quem pediu. */
  async function mandarCadastro() {
    if (docs.length === 0) {
      void showAlert({
        title: "Cadastre seus documentos primeiro",
        message: "O link mostra o que você tem e as validades — sem documento não há o que mandar.",
      });
      return;
    }
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const c = await api.criarComprovantePessoal({ tipo: "CADASTRO", inicio: hoje, fim: hoje });
      await Share.share({
        message: `Meus documentos: ${API_URL}/publico/comprovante/${c.token}`,
      });
    } catch {
      void showAlert({
        title: "Não deu pra gerar o link",
        message: "Precisa de internet. Tente de novo quando tiver sinal.",
      });
    }
  }

  if (editando) {
    return (
      <Formulario
        documento={editando === "novo" ? null : editando}
        onFechar={() => setEditando(null)}
        onSalvo={async () => {
          setEditando(null);
          await recarregar();
        }}
        onApagar={async (d) => {
          await apagar(d);
          setEditando(null);
        }}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={carregando} onRefresh={() => void puxarPraAtualizar()} />
        }
      >
        <View>
          <ScreenHeader
            title="Meus documentos"
            subtitle="O que a transportadora pede pra liberar carga"
          />

          {(vencidos.length > 0 || vencendo.length > 0) && (
            <View className="-mt-1 flex-row items-center gap-2 bg-brand px-4 pb-4">
              <AlertTriangle size={20} color="#fff" />
              <Text className="flex-1 rounded-xl bg-white/20 p-3 text-sm font-semibold text-white">
                {vencidos.length > 0
                  ? `${vencidos.length} ${vencidos.length === 1 ? "documento vencido" : "documentos vencidos"}`
                  : `${vencendo.length} ${vencendo.length === 1 ? "documento vencendo" : "documentos vencendo"}`}
                {vencidos.length > 0 && vencendo.length > 0 ? ` · ${vencendo.length} vencendo` : ""}
              </Text>
            </View>
          )}
        </View>

        <View className="flex-1 gap-3 px-5 py-6">
          <Button size="lg" className="h-16" onPress={() => setEditando("novo")}>
            <Plus size={22} color="#fff" />
            <Text className="text-lg font-bold text-primary-foreground">Adicionar documento</Text>
          </Button>

          {docs.length > 0 && (
            <Button size="lg" variant="outline" onPress={() => void mandarCadastro()}>
              <Send size={18} color="#0f172a" />
              <Text className="text-base font-semibold text-foreground">
                Mandar meu cadastro
              </Text>
            </Button>
          )}

          {docs.length === 0 && !carregando && (
            <View className="rounded-2xl border-2 border-dashed border-border p-6">
              <Text className="text-center text-base font-semibold text-foreground">
                Sua carteira está vazia
              </Text>
              <Text className="mt-1 text-center text-sm text-muted-foreground">
                Cadastre CNH, toxicológico, RNTRC e o CRLV de cada placa. O app avisa antes de
                vencer — e você manda tudo de uma vez pra quem pedir.
              </Text>
            </View>
          )}

          {docs.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => setEditando(d)}
              className="flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
            >
              <Situacao status={d.status} />
              <View className="flex-1">
                <Text className="font-bold text-foreground">
                  {ROTULO_DOCUMENTO_PESSOAL[d.tipo]}
                  {d.placa ? ` · ${d.placa}` : ""}
                </Text>
                <Text className="text-sm text-muted-foreground">
                  {d.numero ? `nº ${d.numero}` : ""}
                  {d.numero && d.validade ? " · " : ""}
                  {textoValidade(d)}
                </Text>
              </View>
              {/* A foto ABRE. Antes o upload entrava e nunca voltava: ele
                  fotografava a CNH e não conseguia mais mandar pra quem pediu,
                  que é a razão de a carteira existir. A lixeira saiu daqui —
                  ação destrutiva de 18px em cinza, aninhada dentro de outro
                  toque, com caminhão sacudindo, é acidente esperando. Apagar
                  agora fica dentro do formulário de edição. */}
              {d.temArquivo && (
                <Pressable
                  onPress={() =>
                    router.push(
                      `/documento-foto?id=${d.id}&titulo=${encodeURIComponent(
                        ROTULO_DOCUMENTO_PESSOAL[d.tipo],
                      )}`,
                    )
                  }
                  hitSlop={8}
                  className="h-12 w-12 items-center justify-center rounded-full bg-success/15 active:opacity-70"
                >
                  <Camera size={22} color="#1d9a53" />
                </Pressable>
              )}
              <ChevronRight size={20} color="#94a3b8" />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function textoValidade(d: DocumentoPessoal): string {
  if (!d.validade) return "não vence";
  const data = d.validade.split("-").reverse().join("/");
  if (d.status === "VENCIDO") return `venceu em ${data}`;
  if (d.status === "VENCENDO") {
    return d.diasAteVencer === 0 ? `vence HOJE (${data})` : `vence em ${d.diasAteVencer} dias`;
  }
  return `vale até ${data}`;
}

function Situacao({ status }: { status: StatusDocumento }) {
  if (status === "VENCIDO") {
    return (
      <View className="h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle size={20} color="#dc2626" />
      </View>
    );
  }
  if (status === "VENCENDO") {
    return (
      <View className="h-10 w-10 items-center justify-center rounded-full bg-amber-50">
        <AlertTriangle size={20} color="#b45309" />
      </View>
    );
  }
  return (
    <View className="h-10 w-10 items-center justify-center rounded-full bg-green-50">
      <Check size={20} color="#16a34a" />
    </View>
  );
}

function Formulario({
  documento,
  onFechar,
  onSalvo,
  onApagar,
}: {
  documento: DocumentoPessoal | null;
  onFechar: () => void;
  onSalvo: () => void;
  onApagar: (d: DocumentoPessoal) => void | Promise<void>;
}) {
  const [tipo, setTipo] = useState<TipoDocumentoPessoal>(documento?.tipo ?? "CNH");
  const [numero, setNumero] = useState(documento?.numero ?? "");
  const [validade, setValidade] = useState(
    documento?.validade ? documento.validade.split("-").reverse().join("/") : "",
  );
  const [placa, setPlaca] = useState(documento?.placa ?? "");
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const pedePlaca = DOCUMENTO_POR_PLACA.includes(tipo);

  async function salvar() {
    setErro(null);
    // Data em DD/MM/AAAA porque é como ele lê no documento; o backend quer ISO.
    let iso: string | undefined;
    if (validade.trim()) {
      const [d, m, a] = validade.split("/");
      if (!d || !m || !a || a.length !== 4) return setErro("Data no formato DD/MM/AAAA.");
      iso = `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    if (pedePlaca && placa.trim().length < 7) return setErro("Informe a placa do veículo.");

    setSalvando(true);
    try {
      const salvo = documento
        ? await api.atualizarDocumento(documento.id, {
            tipo,
            numero: numero.trim() || undefined,
            validade: iso,
            placa: pedePlaca ? placa.trim().toUpperCase() : undefined,
          })
        : await api.salvarDocumento({
            tipo,
            numero: numero.trim() || undefined,
            validade: iso,
            placa: pedePlaca ? placa.trim().toUpperCase() : undefined,
          });
      // O upload da foto não pode falhar calado: antes era `.catch(() => {})`
      // — sumia o "foto guardada" e nenhum erro aparecia, então ele achava que
      // a CNH estava lá.
      if (foto) {
        try {
          await api.anexarArquivoDocumento(salvo.id, foto.uri);
        } catch {
          void showAlert({
            title: "O documento foi salvo, mas a foto não subiu",
            message:
              "Confira sua internet e anexe a foto de novo abrindo este documento. O resto já está guardado.",
          });
        }
      }
      onSalvo();
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
          <ScreenHeader title={documento ? "Editar documento" : "Novo documento"} />

          <View className="flex-1 gap-5 px-5 py-6">
            {!documento && (
              <View className="gap-2">
                <Label>Qual documento</Label>
                <View className="flex-row flex-wrap gap-2">
                  {TIPOS_DOCUMENTO_PESSOAL.map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setTipo(t)}
                      className={`rounded-xl border-2 px-4 py-3 ${
                        tipo === t ? "border-primary bg-primary/10" : "border-border bg-card"
                      }`}
                    >
                      <Text
                        className={`text-base font-bold ${
                          tipo === t ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {ROTULO_DOCUMENTO_PESSOAL[t]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {AJUDA_DOCUMENTO_PESSOAL[tipo] && (
              <Text className="text-sm text-muted-foreground">{AJUDA_DOCUMENTO_PESSOAL[tipo]}</Text>
            )}

            {pedePlaca && (
              <View className="gap-2">
                <Label>Placa</Label>
                <Input
                  value={placa}
                  onChangeText={(v) =>
                    setPlaca(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7))
                  }
                  autoCapitalize="characters"
                  placeholder="ABC1D23"
                  editable={!salvando}
                />
              </View>
            )}

            <View className="gap-2">
              <Label>Número (opcional)</Label>
              <Input
                value={numero}
                onChangeText={setNumero}
                placeholder="Número do documento"
                editable={!salvando}
              />
            </View>

            <View className="gap-2">
              <Label>Validade</Label>
              <Input
                value={validade}
                onChangeText={(v) => setValidade(mascaraData(v))}
                keyboardType="number-pad"
                placeholder="DD/MM/AAAA"
                editable={!salvando}
              />
              <Text className="text-xs text-muted-foreground">
                Deixe em branco se o documento não vence.
              </Text>
            </View>

            <View className="gap-2">
              <Label>Foto do documento (opcional)</Label>
              <PhotoCapture value={foto} onChange={setFoto} />
              {documento?.temArquivo && !foto && (
                <Text className="text-xs text-muted-foreground">
                  Já existe uma foto guardada. Tirar outra substitui a anterior.
                </Text>
              )}
              <Text className="text-xs text-muted-foreground">
                A foto fica só sua — o link que você manda mostra o documento e a validade, nunca
                a imagem.
              </Text>
            </View>

            {erro && (
              <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                <Text className="text-base font-medium text-destructive">{erro}</Text>
              </View>
            )}

            <View className="flex-row gap-2">
              <Button variant="outline" className="flex-1" onPress={onFechar} disabled={salvando}>
                <Text className="text-base font-semibold text-foreground">Cancelar</Text>
              </Button>
              <Button className="flex-1" loading={salvando} onPress={salvar}>
                <Text className="text-base font-bold text-primary-foreground">
                  {salvando ? "Salvando..." : "Salvar"}
                </Text>
              </Button>
            </View>

            {documento && (
              <Button size="lg" variant="destructive" onPress={() => void onApagar(documento)}>
                <Trash2 size={20} color="#fff" />
                <Text className="text-base font-bold text-white">Apagar documento</Text>
              </Button>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** DD/MM/AAAA enquanto ele digita — é como a data está impressa no documento. */
function mascaraData(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
