import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, FileText, Image as ImageIcon, Paperclip } from "lucide-react-native";
import { PhotoCapture } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCapacidadeNova } from "@/lib/acessos-app";
import { escolherArquivo } from "@/lib/escolher-arquivo";
import { pegarCoordsRapido } from "@/lib/geo";
import { CAP_ETAPAS, MOTIVOS_SEGUIR_SEM, type MotivoSeguirSem } from "@/lib/etapas";
import {
  abrirRascunho,
  enviarRascunho,
  guardarArquivo,
  itensDaBarreira,
  lerEstadoEtapas,
  onEtapasChange,
  registrarSeguiuSem,
  revalidarBarreira,
  salvarItem,
  type ItemBarreira,
} from "@/lib/etapas-local";
import { usePodeEscolherArquivo } from "./arquivos-item";
import { abrirEtapa } from "./cartao-etapas-viagem";

function chave(i: ItemBarreira): string {
  return `${i.viagem.viagemClientId}|${i.modelo.id}|${i.item.chave}`;
}

function quando(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === hoje.toDateString()) return "hoje";
  if (d.toDateString() === ontem.toDateString()) return "ontem";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * "ANTES DE SEGUIR" — o documento que o escritório marcou como "não seguir
 * viagem sem este" e que ainda falta, na PRÓXIMA ação dele:
 * - FINALIZAR (finalizar a viagem): os da carga desta viagem;
 * - INICIAR (começar a próxima): os da descarga e do acerto da anterior.
 *
 * Nunca trava (decisão do dono): ele anexa agora ou segue dizendo o motivo, e
 * o motivo vai pro escritório. Com sinal, confere antes — se o escritório já
 * anexou ou dispensou, o cartão nem aparece. Amarelo, nunca vermelho; o texto
 * é "o escritório precisa", nunca "a empresa exige".
 *
 * `modo="AVISO"` (viagem lançada depois do fato): só avisa, sem pedir motivo
 * e sem segurar nada.
 *
 * `onLiberado(true)` quando não há (mais) nada a resolver — a tela só mostra o
 * botão final depois disso.
 */
export function BarreiraEtapas({
  acao,
  viagemClientIdAtual,
  modo = "MOTIVO",
  onLiberado,
}: {
  acao: "FINALIZAR" | "INICIAR";
  viagemClientIdAtual?: string | null;
  modo?: "MOTIVO" | "AVISO";
  onLiberado: (liberado: boolean) => void;
}) {
  const ligado = useCapacidadeNova(CAP_ETAPAS);
  const [itens, setItens] = useState<ItemBarreira[]>([]);
  // Tem item faltando no celular e está perguntando ao servidor (teto curto).
  const [conferindo, setConferindo] = useState(false);
  // O que o servidor disse que já está resolvido (só pergunta uma vez por tela).
  const resolvidosNoServidor = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!ligado) {
      setItens([]);
      return;
    }
    let vivo = true;
    const calcular = async () => {
      const estado = await lerEstadoEtapas();
      let lista = itensDaBarreira(estado, acao, viagemClientIdAtual);
      if (resolvidosNoServidor.current === null && lista.length > 0 && modo === "MOTIVO") {
        if (vivo) setConferindo(true);
        const confirmados = await revalidarBarreira(lista);
        const ficam = new Set(confirmados.map(chave));
        resolvidosNoServidor.current = new Set(lista.map(chave).filter((k) => !ficam.has(k)));
      }
      const fora = resolvidosNoServidor.current;
      if (fora) lista = lista.filter((i) => !fora.has(chave(i)));
      if (vivo) {
        setItens(lista);
        setConferindo(false);
      }
    };
    void calcular();
    const off = onEtapasChange(() => void calcular());
    return () => {
      vivo = false;
      off();
    };
  }, [ligado, acao, viagemClientIdAtual, modo]);

  // Sem nada no celular, nunca segura (nem por um instante); com algo, segura
  // só enquanto confere com o servidor e enquanto ele não anexa ou explica.
  const liberado = modo === "AVISO" || !ligado || (!conferindo && itens.length === 0);
  useEffect(() => {
    onLiberado(liberado);
  }, [liberado, onLiberado]);

  if (!ligado) return null;
  if (conferindo) {
    return (
      <Text className="text-center text-base text-muted-foreground">
        Conferindo os documentos com o escritório…
      </Text>
    );
  }
  if (itens.length === 0) return null;

  return (
    <View className="gap-3">
      {itens.map((i) =>
        modo === "AVISO" ? (
          <CartaoAviso key={chave(i)} i={i} acao={acao} />
        ) : (
          <CartaoBarreira key={chave(i)} i={i} acao={acao} />
        ),
      )}
    </View>
  );
}

function Cabecalho({ i, acao }: { i: ItemBarreira; acao: "FINALIZAR" | "INICIAR" }) {
  const de =
    acao === "INICIAR"
      ? `Falta da viagem anterior (${[i.viagem.rotulo, quando(i.viagem.finalizadaEm)].filter(Boolean).join(", ")}):`
      : `Falta em ${i.modelo.nome}:`;
  return (
    <>
      <View className="flex-row items-center gap-2">
        <AlertTriangle size={22} color="#b45309" />
        <Text className="flex-1 text-lg font-extrabold text-foreground">Antes de seguir</Text>
      </View>
      <Text className="text-base text-foreground">{de}</Text>
      <Text className="text-lg font-bold text-foreground">{i.item.rotulo}</Text>
      <Text className="text-base text-foreground">O escritório precisa deste documento.</Text>
    </>
  );
}

function CartaoAviso({ i, acao }: { i: ItemBarreira; acao: "FINALIZAR" | "INICIAR" }) {
  return (
    <View className="gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
      <Cabecalho i={i} acao={acao} />
      <Button variant="outline" onPress={() => abrirEtapa(i.viagem.viagemClientId, i.modelo.id)}>
        <FileText size={20} color="#0f172a" />
        <Text className="text-base font-semibold text-foreground">Abrir documentos</Text>
      </Button>
    </View>
  );
}

function CartaoBarreira({ i, acao }: { i: ItemBarreira; acao: "FINALIZAR" | "INICIAR" }) {
  const temSeletor = usePodeEscolherArquivo();
  const [seguindo, setSeguindo] = useState(false);
  const [motivo, setMotivo] = useState<MotivoSeguirSem | "">("");
  const [outro, setOutro] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const ehArquivo = i.item.tipo === "FOTO" || i.item.tipo === "ARQUIVO";
  const opcoes = useMemo(() => MOTIVOS_SEGUIR_SEM.map((m) => ({ value: m.value, label: m.label })), []);

  async function anexar(a: { uri: string; mime: string; nome?: string; tamanho?: number }) {
    setSalvando(true);
    try {
      const g = await guardarArquivo(a);
      if (!g.ok) {
        setErro(g.motivo);
        return;
      }
      await abrirRascunho(i.viagem, i.modelo);
      await salvarItem(i.viagem.viagemClientId, i.modelo.id, i.item.chave, (r) => ({
        ...r,
        arquivos: [...r.arquivos, g.arquivo],
      }));
      await enviarRascunho(i.viagem.viagemClientId, i.modelo.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSalvando(false);
    }
  }

  async function seguirSem() {
    if (!motivo) {
      setErro("Escolha o motivo");
      return;
    }
    if (motivo === "OUTRO" && outro.trim().length < 3) {
      setErro("Escreva o motivo");
      return;
    }
    setSalvando(true);
    try {
      const gps = await pegarCoordsRapido();
      await registrarSeguiuSem({
        viagemClientId: i.viagem.viagemClientId,
        modeloId: i.modelo.id,
        item: i.item,
        motivo,
        motivoTexto: outro,
        acao,
        gps,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <View className="gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
      <Cabecalho i={i} acao={acao} />

      {!seguindo ? (
        <>
          {ehArquivo ? (
            <PhotoCapture
              value={null}
              onChange={(p) => {
                if (p) void anexar({ uri: p.uri, mime: p.mime });
              }}
              renderVazio={({ abrirCamera, abrirGaleria, escolhendo }) => (
                <View className="gap-2">
                  <Button onPress={() => void abrirCamera()} loading={salvando}>
                    <Camera size={20} color="white" />
                    <Text className="text-base font-semibold text-primary-foreground">Tirar foto agora</Text>
                  </Button>
                  <Button
                    variant="outline"
                    loading={escolhendo}
                    onPress={() => {
                      if (i.item.tipo === "ARQUIVO" && temSeletor) {
                        void escolherArquivo().then((a) => {
                          if (a) void anexar({ uri: a.uri, mime: a.mime, nome: a.nome, tamanho: a.tamanho });
                        });
                      } else {
                        abrirGaleria();
                      }
                    }}
                  >
                    {i.item.tipo === "ARQUIVO" && temSeletor ? (
                      <Paperclip size={20} color="#0f172a" />
                    ) : (
                      <ImageIcon size={20} color="#0f172a" />
                    )}
                    <Text className="text-base font-semibold text-foreground">Escolher arquivo</Text>
                  </Button>
                </View>
              )}
            />
          ) : (
            <Button onPress={() => abrirEtapa(i.viagem.viagemClientId, i.modelo.id)}>
              <FileText size={20} color="white" />
              <Text className="text-base font-semibold text-primary-foreground">Preencher agora</Text>
            </Button>
          )}
          <Button
            variant="warning"
            onPress={() => {
              setErro(null);
              setSeguindo(true);
            }}
          >
            <ArrowRight size={20} color="#1f2937" />
            <Text className="text-base font-semibold text-warning-foreground">Seguir sem isso</Text>
          </Button>
        </>
      ) : (
        <View className="gap-3">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-base font-bold text-foreground">Por que vai seguir sem?</Text>
            <Text className="text-sm font-semibold text-muted-foreground">obrigatório</Text>
          </View>
          <Select
            value={motivo}
            onChange={(v) => {
              setErro(null);
              setMotivo(v as MotivoSeguirSem);
            }}
            options={opcoes}
            placeholder="Escolha…"
            title="Por que vai seguir sem?"
            error={!!erro && !motivo}
          />
          {motivo === "OUTRO" ? (
            <Input
              value={outro}
              onChangeText={(t) => {
                setErro(null);
                setOutro(t);
              }}
              placeholder="Escreva o motivo"
              maxLength={300}
              error={!!erro && motivo === "OUTRO"}
            />
          ) : null}
          {erro ? <Text className="text-base font-bold text-foreground">{erro}</Text> : null}
          <Text className="text-sm text-muted-foreground">O escritório vai ficar sabendo do motivo.</Text>
          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => setSeguindo(false)}>
              <ArrowLeft size={20} color="#0f172a" />
              <Text className="text-base font-semibold text-foreground">Voltar</Text>
            </Button>
            <Button variant="warning" className="flex-1" onPress={() => void seguirSem()} loading={salvando}>
              <ArrowRight size={20} color="#1f2937" />
              <Text className="text-base font-semibold text-warning-foreground">Seguir e avisar</Text>
            </Button>
          </View>
        </View>
      )}
      {!seguindo && erro ? <Text className="text-base font-bold text-foreground">{erro}</Text> : null}
    </View>
  );
}
