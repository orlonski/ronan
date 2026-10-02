import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { CheckCircle2, CloudOff, FileText, Image as ImageIcon, Paperclip } from "lucide-react-native";
import type { AnexoPedidoMotorista } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { VerDePerto } from "@/components/miniatura-documento";
import { usePermite } from "@/lib/acessos-app";
import {
  abrirPdf,
  ehImagem,
  jaGuardado,
  obterImagem,
  salvarNoCelular,
  tamanhoLegivel,
} from "@/lib/anexos-pedido";

/**
 * "Documentos do pedido": croqui de acesso, autorização de entrada, OS do
 * cliente — o que o escritório anexou e deixou visível.
 *
 * Tocar abre: foto no visualizador do próprio app, PDF no leitor do celular.
 * Depois da primeira vez o arquivo fica guardado e abre sem sinal; o selo
 * "guardado" diz isso pra ele ANTES de entrar na estrada de terra.
 *
 * O tamanho aparece na linha porque é o 4G dele que paga o download.
 */
export function DocumentosDoPedido({
  anexos,
  compacto,
}: {
  anexos: AnexoPedidoMotorista[];
  /** Dentro de um cartão que já tem borda: sem moldura própria. */
  compacto?: boolean;
}) {
  const pode = usePermite("app.pedido.anexos");
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [guardados, setGuardados] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const [paraSalvar, setParaSalvar] = useState<AnexoPedidoMotorista | null>(null);
  const [foto, setFoto] = useState<{ titulo: string; uri: string } | null>(null);

  const ids = anexos.map((a) => a.id).join("|");
  useEffect(() => {
    let vivo = true;
    void Promise.all(anexos.map(async (a) => ((await jaGuardado(a)) ? a.id : null))).then((r) => {
      if (vivo) setGuardados(new Set(r.filter((x): x is string => !!x)));
    });
    return () => {
      vivo = false;
    };
    // `ids` resume a lista; o array em si é novo a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (!pode || anexos.length === 0) return null;

  async function abrir(a: AnexoPedidoMotorista) {
    setAviso(null);
    setParaSalvar(null);
    setAbrindo(a.id);
    try {
      if (ehImagem(a.mime)) {
        const uri = await obterImagem(a);
        setFoto({ titulo: a.nome, uri });
        setGuardados((g) => new Set(g).add(a.id));
      } else {
        const r = await abrirPdf(a);
        if (r === "salvar") setParaSalvar(a);
        // Com sinal o PDF abre pelo link e a cópia baixa em segundo plano: o
        // selo só acende quando ela existir de verdade, nunca na promessa.
        setTimeout(() => {
          void jaGuardado(a).then((ok) => {
            if (ok) setGuardados((g) => new Set(g).add(a.id));
          });
        }, 5000);
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não deu pra abrir agora. Tente de novo.");
    } finally {
      setAbrindo(null);
    }
  }

  async function salvar(a: AnexoPedidoMotorista) {
    try {
      const ok = await salvarNoCelular(a);
      setParaSalvar(null);
      setAviso(ok ? `"${a.nome}" salvo. Abra pelo app de arquivos do celular.` : null);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não deu pra salvar agora.");
    }
  }

  return (
    <View className={compacto ? "mt-3 gap-2 border-t border-border pt-3" : "gap-2 rounded-2xl border border-border bg-card p-4"}>
      <View className="flex-row items-center gap-1.5">
        <Paperclip size={14} color="#64748b" />
        <Text className="text-sm font-bold text-foreground">Documentos do pedido</Text>
      </View>

      {anexos.map((a) => {
        const Icone = ehImagem(a.mime) ? ImageIcon : FileText;
        const guardado = guardados.has(a.id);
        return (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityLabel={`Abrir ${a.nome}`}
            onPress={() => void abrir(a)}
            disabled={abrindo !== null}
            className="min-h-14 flex-row items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 active:opacity-70"
          >
            <Icone size={22} color="#B4501A" />
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                {a.nome}
              </Text>
              <View className="flex-row items-center gap-1">
                {guardado ? (
                  <>
                    <CheckCircle2 size={12} color="#16a34a" />
                    <Text className="text-xs text-muted-foreground">
                      Guardado no celular · abre sem sinal
                    </Text>
                  </>
                ) : (
                  <Text className="text-xs text-muted-foreground">
                    {ehImagem(a.mime) ? "Foto" : "PDF"} · {tamanhoLegivel(a.tamanho)}
                  </Text>
                )}
              </View>
            </View>
            {abrindo === a.id ? <ActivityIndicator size="small" /> : null}
          </Pressable>
        );
      })}

      {paraSalvar ? (
        <View className="gap-2 rounded-xl border border-warning bg-warning/10 p-3">
          <Text className="text-sm text-foreground">
            Sem internet pra abrir o PDF agora, mas ele já está guardado no celular. Salve numa
            pasta (Downloads, por exemplo) e abra pelo app de arquivos.
          </Text>
          <View className="flex-row gap-2">
            <Button size="sm" className="flex-1" onPress={() => void salvar(paraSalvar)}>
              Salvar no celular
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onPress={() => setParaSalvar(null)}>
              Agora não
            </Button>
          </View>
        </View>
      ) : null}

      {aviso ? (
        <View className="flex-row items-start gap-2 rounded-xl bg-muted p-3">
          <CloudOff size={16} color="#64748b" style={{ marginTop: 2 }} />
          <Text className="flex-1 text-sm text-foreground">{aviso}</Text>
        </View>
      ) : null}

      {/* Arquivo LOCAL (file://): não precisa de token, então não cai na
          armadilha do Fresco cacheando o 401 da imagem autenticada. */}
      <VerDePerto
        titulo={foto?.titulo ?? ""}
        aberta={foto !== null}
        fechar={() => setFoto(null)}
        source={foto ? { uri: foto.uri } : null}
      />
    </View>
  );
}
