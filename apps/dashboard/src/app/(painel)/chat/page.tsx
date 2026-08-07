"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag, Megaphone, Send, ShieldAlert, Trash2 } from "lucide-react";
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
  }[];
};

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
  const q = useApiQuery<ListaAvisos>("/admin/chat/avisos");

  const publicar = useMutation({
    mutationFn: (t: string) =>
      fetchApi<{ destinatarios: number; pushEnviadas: number }>("/admin/chat/avisos", {
        method: "POST",
        body: JSON.stringify({ texto: t }),
        token,
      }),
    onSuccess: () => {
      setTexto("");
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
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {texto.trim().length}/2000
            </span>
            <Button
              onClick={() => publicar.mutate(texto.trim())}
              disabled={texto.trim().length === 0 || publicar.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {publicar.isPending ? "Publicando…" : "Publicar aviso"}
            </Button>
          </div>
          {publicar.isSuccess ? (
            <p className="text-xs text-emerald-600">
              Publicado — {publicar.data.pushEnviadas} de {publicar.data.destinatarios}{" "}
              receberam a notificação agora (o resto vê ao abrir o app).
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
              <div className="flex-1">
                <p
                  className={`text-sm ${a.apagada ? "italic text-muted-foreground" : ""}`}
                >
                  {a.apagada ? "Aviso removido." : a.texto}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.autorNome} · {fmtDataHoraBR(a.criadoEm)}
                </p>
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
