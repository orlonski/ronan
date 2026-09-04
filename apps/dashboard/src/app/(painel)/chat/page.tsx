"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Clock,
  Flag,
  ImagePlus,
  Megaphone,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  MOTIVO_DENUNCIA_LABEL,
  type DenunciaChatAdmin,
  type MotivoDenuncia,
} from "@ronan/shared-types";
import { RequerTela } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { comprimirImagem, formatarBytes } from "@/lib/imagem";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";

type ListaAvisos = {
  alcance: number;
  avisos: {
    id: string;
    autorNome: string;
    texto: string | null;
    apagada: boolean;
    criadoEm: string;
    temFoto: boolean;
    story: { id: string; expiraEm: string; expirado: boolean; vistos: number } | null;
  }[];
};

/** Teto do que a API aceita — o arquivo que sobe já é o comprimido. */
const MAX_FOTO_MB = 10;
/** Teto do arquivo de ENTRADA: só pra não travar o navegador num absurdo. */
const MAX_ORIGINAL_MB = 40;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * O lado da operação no chat dos motoristas.
 *
 * O que NÃO tem aqui, de propósito: leitura de conversa entre motoristas. O
 * painel enxerga o canal de Avisos (que ele mesmo escreve) e o trecho que
 * alguém denunciou — nada além. Chat de parceiro autônomo não é
 * correspondência da empresa, e quebrar isso queimaria a confiança no app.
 */
export default function ChatPage() {
  const { temPermissao } = usePermissoes();
  const [aba, setAba] = useState<"avisos" | "denuncias">("avisos");

  const denunciasAbertas = useApiQuery<{ abertas: number }>("/admin/chat/denuncias/contar", {
    refetchInterval: 60_000,
  });

  return (
    <RequerTela chave="chat.ver">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Chat dos motoristas</h1>
          <p className="text-sm text-muted-foreground">
            Publique avisos pro canal que todo mundo lê e trate as denúncias. Conversa
            entre motoristas é privada — o painel não abre.
          </p>
        </div>

        <div className="flex gap-2 border-b">
          <BotaoAba ativo={aba === "avisos"} onClick={() => setAba("avisos")}>
            <Megaphone className="h-4 w-4" /> Avisos
          </BotaoAba>
          <BotaoAba ativo={aba === "denuncias"} onClick={() => setAba("denuncias")}>
            <Flag className="h-4 w-4" /> Denúncias
            {(denunciasAbertas.data?.abertas ?? 0) > 0 ? (
              <Badge className="border-destructive bg-destructive/10 text-destructive">
                {denunciasAbertas.data!.abertas}
              </Badge>
            ) : null}
          </BotaoAba>
        </div>

        {aba === "avisos" ? (
          <AbaAvisos podeAvisar={temPermissao("chat.avisar")} />
        ) : (
          <AbaDenuncias podeModerar={temPermissao("chat.moderar")} />
        )}
      </div>
    </RequerTela>
  );
}

function BotaoAba({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ${
        ativo
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function AbaAvisos({ podeAvisar }: { podeAvisar: boolean }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [tamanhos, setTamanhos] = useState<{ de: number; para: number } | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [tambemStory, setTambemStory] = useState(true);
  const inputFoto = useRef<HTMLInputElement>(null);
  const q = useApiQuery<ListaAvisos>("/admin/chat/avisos");

  // A prévia é um object URL local: revogar ao trocar de foto evita segurar
  // o arquivo inteiro na memória a cada anexo.
  useEffect(() => {
    if (!foto) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  /**
   * Comprime ANTES de validar tamanho: essa imagem vai ser baixada por dezenas
   * de celulares em 4G de estrada, no chat e no story, então o que importa é o
   * peso do arquivo que SOBE — recusar uma foto de 12 MB que viraria 300 KB
   * seria barrar o admin por um problema que a compressão já resolveu.
   */
  async function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.size > MAX_ORIGINAL_MB * 1024 * 1024) {
      toast.error(`Essa imagem tem mais de ${MAX_ORIGINAL_MB} MB — escolha outra.`);
      return;
    }
    try {
      const { arquivo: leve, bytesOriginais, bytesFinais } = await comprimirImagem(arquivo);
      setFoto(leve);
      setTamanhos({ de: bytesOriginais, para: bytesFinais });
    } catch {
      // Navegador sem canvas utilizável: manda como veio, se couber no teto.
      if (arquivo.size > MAX_FOTO_MB * 1024 * 1024) {
        toast.error(`Não consegui otimizar a foto aqui, e ela passa de ${MAX_FOTO_MB} MB.`);
        return;
      }
      setFoto(arquivo);
      setTamanhos(null);
    }
  }

  function limparFoto() {
    setFoto(null);
    setTamanhos(null);
    if (inputFoto.current) inputFoto.current.value = "";
  }

  const publicar = useMutation({
    mutationFn: async (t: string) => {
      // A foto sobe antes; só com a chave em mãos o aviso é publicado. Assim um
      // upload que falha no 4G do escritório não vira aviso sem imagem.
      let fotoKey: string | undefined;
      if (foto) {
        const form = new FormData();
        form.append("foto", foto);
        const r = await fetchApi<{ fotoKey: string }>("/admin/chat/avisos/foto", {
          method: "POST",
          body: form,
          token,
        });
        fotoKey = r.fotoKey;
      }
      return fetchApi<{ destinatarios: number; pushEnviadas: number; storyId: string | null }>(
        "/admin/chat/avisos",
        {
          method: "POST",
          body: JSON.stringify({
            texto: t,
            ...(fotoKey ? { fotoKey, tambemStory } : {}),
          }),
          token,
        },
      );
    },
    onSuccess: () => {
      setTexto("");
      limparFoto();
      void qc.invalidateQueries({ queryKey: ["/admin/chat/avisos"] });
    },
  });

  const remover = useMutation({
    mutationFn: (id: string) =>
      fetchApi<void>(`/admin/chat/avisos/${id}`, { method: "DELETE", token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/admin/chat/avisos"] }),
  });

  return (
    <div className="space-y-4">
      {podeAvisar ? (
        <Card className="space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Publicar aviso</h2>
            <p className="text-xs text-muted-foreground">
              Chega como notificação pra {q.data?.alcance ?? 0} motorista(s) com o chat
              liberado. Eles leem, não respondem.
            </p>
          </div>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Ex.: Amanhã a balança da pedreira abre às 6h."
          />

          {/* Foto opcional — e, com ela, o story. */}
          <input
            ref={inputFoto}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void escolherFoto(e.target.files?.[0])}
          />
          {previa ? (
            <div className="flex items-start gap-3 rounded-lg border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previa}
                alt="Prévia da foto do aviso"
                className="h-24 w-24 rounded object-cover"
              />
              <div className="flex-1 space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tambemStory}
                    onChange={(e) => setTambemStory(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    Publicar também no story
                    <span className="block text-xs text-muted-foreground">
                      A foto aparece por 24h no topo do app, com o nome da empresa. Só
                      quem tem stories liberado vê.
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={limparFoto}>
                    <X className="mr-2 h-4 w-4" />
                    Tirar a foto
                  </Button>
                  {tamanhos ? (
                    <span className="text-xs text-muted-foreground">
                      Otimizada pro 4G: {formatarBytes(tamanhos.de)} →{" "}
                      <strong>{formatarBytes(tamanhos.para)}</strong>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => inputFoto.current?.click()}>
              <ImagePlus className="mr-2 h-4 w-4" />
              Anexar foto
            </Button>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {texto.trim().length}/2000
            </span>
            <Button
              onClick={() => publicar.mutate(texto.trim())}
              disabled={texto.trim().length === 0 || publicar.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {publicar.isPending
                ? "Publicando…"
                : foto && tambemStory
                  ? "Publicar aviso e story"
                  : "Publicar aviso"}
            </Button>
          </div>
          {publicar.isSuccess ? (
            <p className="text-xs text-emerald-600">
              Publicado — {publicar.data.pushEnviadas} de {publicar.data.destinatarios}{" "}
              receberam a notificação agora (o resto vê ao abrir o app).
              {publicar.data.storyId ? " O story fica no ar por 24h." : ""}
            </p>
          ) : null}
          {publicar.isError ? (
            <p className="text-xs text-destructive">
              {(publicar.error as Error).message}
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="space-y-2">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (q.data?.avisos.length ?? 0) === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Nenhum aviso publicado ainda.
          </Card>
        ) : (
          q.data!.avisos.map((a) => (
            <Card key={a.id} className="flex items-start gap-3 p-4">
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {a.temFoto ? <FotoAviso avisoId={a.id} /> : null}
              <div className="flex-1">
                <p
                  className={`text-sm ${a.apagada ? "italic text-muted-foreground" : ""}`}
                >
                  {a.apagada ? "Aviso removido." : a.texto}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.autorNome} · {fmtDataHoraBR(a.criadoEm)}
                </p>
                {a.story ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 text-primary" />
                    {a.story.expirado
                      ? `Story encerrado · visto por ${a.story.vistos}`
                      : `No story até ${fmtDataHoraBR(a.story.expiraEm)} · visto por ${a.story.vistos}`}
                  </p>
                ) : null}
              </div>
              {podeAvisar && !a.apagada ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remover.mutate(a.id)}
                  disabled={remover.isPending}
                  title="Remover aviso"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              ) : null}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Miniatura da foto do aviso. A rota é autenticada por Bearer, e `<img src>`
 * não manda header — então baixa por fetch e vira object URL, igual às fotos
 * de ticket na tela de viagem.
 */
function FotoAviso({ avisoId }: { avisoId: string }) {
  const token = useAuthToken();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let objectUrl: string | null = null;
    let vivo = true;
    void fetch(`${API_URL}/admin/chat/avisos/${avisoId}/foto`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || !vivo) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      vivo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avisoId, token]);

  if (!url) return <div className="h-16 w-16 shrink-0 rounded bg-muted" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="Foto do aviso" className="h-16 w-16 shrink-0 rounded object-cover" />
  );
}

function AbaDenuncias({ podeModerar }: { podeModerar: boolean }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const q = useApiQuery<DenunciaChatAdmin[]>("/admin/chat/denuncias");

  const resolver = useMutation({
    mutationFn: (args: { id: string; status: "ARQUIVADA" | "REMOVIDA" }) =>
      fetchApi<void>(`/admin/chat/denuncias/${args.id}/resolver`, {
        method: "POST",
        body: JSON.stringify({ status: args.status }),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/admin/chat/denuncias"] });
      void qc.invalidateQueries({ queryKey: ["/admin/chat/denuncias/contar"] });
    },
  });

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if ((q.data?.length ?? 0) === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Nenhuma denúncia. Bom sinal.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {q.data!.map((d) => (
        <Card key={d.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <span className="font-semibold">
              {MOTIVO_DENUNCIA_LABEL[d.motivo as MotivoDenuncia] ?? d.motivo}
            </span>
            <Badge
              className={
                d.status === "ABERTA"
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-muted-foreground"
              }
            >
              {d.status === "ABERTA"
                ? "Aberta"
                : d.status === "REMOVIDA"
                  ? "Mensagem removida"
                  : "Arquivada"}
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {fmtDataHoraBR(d.criadoEm)}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            <strong>{d.denunciante.nome}</strong> denunciou uma mensagem de{" "}
            <strong>{d.autor.nome}</strong>
            {d.detalhe ? ` — “${d.detalhe}”` : ""}
          </p>

          <div className="space-y-1 rounded-lg bg-muted/50 p-3">
            {d.contexto.map((c, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                <strong>{c.autorNome}:</strong> {c.texto ?? "(apagada)"}
              </p>
            ))}
            <p className="rounded border-l-2 border-destructive bg-background p-2 text-sm">
              <strong>{d.autor.nome}:</strong>{" "}
              {d.mensagem.apagada ? (
                <em className="text-muted-foreground">mensagem já removida</em>
              ) : (
                d.mensagem.texto
              )}
            </p>
          </div>

          {podeModerar && d.status === "ABERTA" ? (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => resolver.mutate({ id: d.id, status: "REMOVIDA" })}
                disabled={resolver.isPending}
              >
                Remover mensagem
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resolver.mutate({ id: d.id, status: "ARQUIVADA" })}
                disabled={resolver.isPending}
              >
                Sem violação — arquivar
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
