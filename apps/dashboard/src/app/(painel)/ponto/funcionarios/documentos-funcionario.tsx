"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiBaseUrl, fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type DocRegistrado = {
  exigenciaId: string;
  titulo: string;
  obrigatorio: boolean;
  exigeAssinatura: boolean;
  comoAssinar: "NAO" | "NO_APP" | "JA_ASSINADO";
  recebido: boolean;
  recebidoEm: string | null;
  conferido: boolean;
  recusado: boolean;
  recusaMotivo: string | null;
  nomeArquivo: string | null;
  origem: string | null;
  assinado: boolean;
  assinadoEm: string | null;
  assinaturaConfere: boolean | null;
};

type Estado = { documentos: DocRegistrado[]; faltamDele: number; comOEscritorio: number };

const fmt = (d: string) => new Date(d).toLocaleDateString("pt-BR");

/**
 * OS DOCUMENTOS DE UM REGISTRADO, do lado do escritório.
 *
 * Mesmo trato da ficha do motorista: o que chegou, conferir (quem olhou
 * assina), devolver com motivo (que aparece no app dele, no próprio item) e
 * subir o papel que a empresa emitiu pra ele assinar pelo app.
 */
export function DocumentosDoFuncionario({
  funcionarioId,
  nome,
  onFechar,
}: {
  funcionarioId: string;
  nome: string;
  onFechar: () => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = temPermissao("funcionarios.editar");
  const chave = ["documentos-funcionario", funcionarioId];
  const estado = useQuery({
    queryKey: chave,
    enabled: !!token,
    queryFn: () =>
      fetchApi<Estado>(`/admin/ponto/funcionarios/${funcionarioId}/documentos`, { token }),
  });
  const [recusando, setRecusando] = useState<DocRegistrado | null>(null);
  const [subindo, setSubindo] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const alvoUpload = useRef<string | null>(null);
  const base = `/admin/ponto/funcionarios/${funcionarioId}/documentos`;

  async function acao(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function baixar(d: DocRegistrado) {
    const r = await fetch(`${apiBaseUrl}${base}/${d.exigenciaId}/download`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return toast.error("Não deu pra baixar o arquivo.");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = d.nomeArquivo ?? `${d.titulo}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  async function subir(file: File) {
    const exigenciaId = alvoUpload.current;
    if (!exigenciaId) return;
    setSubindo(exigenciaId);
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      const r = await fetch(`${apiBaseUrl}${base}/${exigenciaId}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(j?.message ?? "Não deu pra subir o arquivo.");
      }
      toast.success("Arquivo guardado.");
      void qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubindo(null);
    }
  }

  const docs = estado.data?.documentos ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Documentos de {nome}</DialogTitle>
        </DialogHeader>

        {estado.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {estado.data && docs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            A empresa ainda não pede nenhum papel de quem é registrado. Crie em{" "}
            <Link href="/documentos-exigidos" className="underline">
              Documentos exigidos
            </Link>
            , com “De quem é registrado em carteira”.
          </p>
        )}

        <input
          ref={arquivoRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,.p7s,.p7m"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void subir(f);
          }}
        />

        <div className="divide-y divide-border">
          {docs.map((d) => (
            <div key={d.exigenciaId} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {d.titulo}
                  {!d.obrigatorio && <span className="ml-1 text-xs text-muted-foreground">(opcional)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {!d.recebido
                    ? "Ainda não chegou."
                    : d.recusado
                      ? `Devolvido: “${d.recusaMotivo}”`
                      : d.conferido
                        ? "Conferido."
                        : `Chegou em ${fmt(d.recebidoEm!)}${d.origem === "PAINEL" ? " (subido pelo escritório)" : ""}. Falta alguém olhar.`}
                  {d.exigeAssinatura &&
                    d.recebido &&
                    (d.assinado
                      ? ` · Assinado em ${fmt(d.assinadoEm!)}${d.assinaturaConfere === false ? " — o arquivo mudou depois da assinatura" : ""}`
                      : d.comoAssinar === "NO_APP"
                        ? " · Falta ele assinar pelo app."
                        : "")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {d.recebido && (
                  <Button size="sm" variant="ghost" onClick={() => void baixar(d)} title="Baixar">
                    <Download className="h-4 w-4" />
                  </Button>
                )}
                {podeEditar && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={subindo === d.exigenciaId}
                    onClick={() => {
                      alvoUpload.current = d.exigenciaId;
                      arquivoRef.current?.click();
                    }}
                  >
                    <Upload className="mr-1 h-4 w-4" />
                    {subindo === d.exigenciaId ? "Subindo…" : d.recebido ? "Trocar" : "Subir"}
                  </Button>
                )}
                {podeEditar && d.recebido && !d.conferido && (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() =>
                      void acao(
                        () => fetchApi(`${base}/${d.exigenciaId}/conferir`, { method: "POST", token }),
                        "Conferido.",
                      )
                    }
                  >
                    <Check className="mr-1 h-4 w-4" />
                    Conferir
                  </Button>
                )}
                {podeEditar && d.recebido && !d.recusado && (
                  <Button size="sm" variant="outline" onClick={() => setRecusando(d)}>
                    Devolver
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {recusando && (
          <Devolver
            doc={recusando}
            onFechar={() => setRecusando(null)}
            onDevolver={(motivo) =>
              acao(
                () =>
                  fetchApi(`${base}/${recusando.exigenciaId}/recusar`, {
                    method: "POST",
                    token,
                    body: JSON.stringify({ motivo }),
                  }),
                "Devolvido. Ele vê o motivo no app, no próprio documento.",
              ).then(() => setRecusando(null))
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Devolver({
  doc,
  onFechar,
  onDevolver,
}: {
  doc: DocRegistrado;
  onFechar: () => void;
  onDevolver: (motivo: string) => Promise<unknown>;
}) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Devolver “{doc.titulo}”</DialogTitle>
        </DialogHeader>
        <Textarea
          rows={3}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="O que ele precisa corrigir. Aparece pra ele no app."
        />
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="warning"
            disabled={enviando || motivo.trim().length < 3}
            onClick={async () => {
              setEnviando(true);
              await onDevolver(motivo.trim());
              setEnviando(false);
            }}
          >
            Devolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
