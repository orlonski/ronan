"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { LIMITE_ANEXO_PEDIDO, type AnexoPedidoAdmin } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusToggle } from "@/components/status-toggle";
import { useConfirm } from "@/components/confirm-dialog";
import { VisualizadorFotos, type FotoVisualizavel } from "@/components/visualizador-fotos";
import { apiBaseUrl, fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

const ehImagem = (mime: string) => mime.startsWith("image/");

/**
 * Os papéis do pedido: croqui de acesso, OS do cliente, autorização de
 * entrada, mapa do bota-fora.
 *
 * Existe porque esse papel morava no grupo de WhatsApp e o motorista chegava
 * na portaria sem ele. O que fica marcado "o motorista vê" aparece no app de
 * quem tem programação deste pedido — inclusive sem sinal, depois do primeiro
 * download.
 *
 * Foto abre NA PRÓPRIA TELA (visualizador), nunca em aba nova. PDF abre numa
 * aba, porque o leitor de PDF do navegador é melhor que qualquer um nosso.
 */
export function AnexosPedido({ pedidoId }: { pedidoId: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = temPermissao("pedidos.editar");
  const { confirmar, ConfirmDialog } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [mexendo, setMexendo] = useState<string | null>(null);
  const [fotoAberta, setFotoAberta] = useState<number | null>(null);

  const chave = ["pedido-anexos", pedidoId];
  const lista = useQuery({
    queryKey: chave,
    enabled: !!token,
    queryFn: () => fetchApi<AnexoPedidoAdmin[]>(`/admin/pedidos/${pedidoId}/anexos`, { token }),
  });
  const anexos = lista.data ?? [];
  const caminho = (a: AnexoPedidoAdmin) => `/admin/pedidos/${pedidoId}/anexos/${a.id}/arquivo`;
  const imagens = anexos.filter((a) => ehImagem(a.mime));
  const fotos: FotoVisualizavel[] = imagens.map((a) => ({ id: a.id, caminho: caminho(a), rotacao: 0 }));

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length || !token) return;
    setEnviando(true);
    try {
      for (const arquivo of Array.from(arquivos)) {
        // Confere antes de subir: 40 MB de PDF não deve atravessar a internet
        // do escritório só pra ouvir "grande demais" no fim.
        if (!LIMITE_ANEXO_PEDIDO.mimes.includes(arquivo.type)) {
          toast.error(`"${arquivo.name}": mande um PDF ou uma foto (JPG ou PNG).`);
          continue;
        }
        if (arquivo.size > LIMITE_ANEXO_PEDIDO.bytes) {
          toast.error(`"${arquivo.name}" passa de ${LIMITE_ANEXO_PEDIDO.rotulo}.`);
          continue;
        }
        const fd = new FormData();
        fd.append("arquivo", arquivo);
        try {
          await fetchApi(`/admin/pedidos/${pedidoId}/anexos`, { token, method: "POST", body: fd });
          toast.success(`"${arquivo.name}" anexado.`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      }
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
      await qc.invalidateQueries({ queryKey: chave });
    }
  }

  async function alternar(a: AnexoPedidoAdmin, visivel: boolean) {
    setMexendo(a.id);
    try {
      await fetchApi(`/admin/pedidos/${pedidoId}/anexos/${a.id}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ visivelMotorista: visivel }),
      });
      await qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMexendo(null);
    }
  }

  async function excluir(a: AnexoPedidoAdmin) {
    const ok = await confirmar({
      title: `Excluir "${a.nome}"?`,
      description: a.visivelMotorista
        ? "O arquivo some do pedido e do app dos motoristas. Quem já abriu continua com a cópia no celular."
        : "O arquivo some do pedido.",
      confirmLabel: "Excluir anexo",
      variant: "destructive",
    });
    if (!ok) return;
    setMexendo(a.id);
    try {
      await fetchApi(`/admin/pedidos/${pedidoId}/anexos/${a.id}`, { token, method: "DELETE" });
      toast.success("Anexo excluído.");
      await qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMexendo(null);
    }
  }

  async function abrir(a: AnexoPedidoAdmin) {
    if (ehImagem(a.mime)) {
      setFotoAberta(imagens.findIndex((i) => i.id === a.id));
      return;
    }
    if (!token) return;
    // A aba abre JÁ, no clique; o arquivo chega depois. Abrir só depois do
    // `await` faz o bloqueador de pop-up do navegador engolir a aba.
    const aba = window.open("", "_blank");
    try {
      const res = await fetch(`${apiBaseUrl}${caminho(a)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (aba) aba.location.href = url;
      else window.location.assign(url);
    } catch {
      aba?.close();
      toast.error("Não deu pra abrir o arquivo agora. Tente de novo.");
    }
  }

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Paperclip className="h-5 w-5 text-muted-foreground" />
            Anexos
          </h2>
          <p className="text-sm text-muted-foreground">
            Croqui de acesso, ordem de serviço do cliente, autorização de entrada. O que estiver
            marcado aparece no app de quem tem programação deste pedido.
          </p>
        </div>
        {podeEditar && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => void enviar(e.target.files)}
            />
            <Button type="button" disabled={enviando} onClick={() => inputRef.current?.click()}>
              {enviando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {enviando ? "Enviando…" : "Anexar arquivo"}
            </Button>
          </>
        )}
      </div>

      {lista.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {lista.isError && (
        <p className="text-sm text-destructive">Não deu pra carregar os anexos. Recarregue a página.</p>
      )}
      {!lista.isLoading && !lista.isError && anexos.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhum anexo ainda. PDF, JPG ou PNG, até {LIMITE_ANEXO_PEDIDO.rotulo} cada.
        </p>
      )}

      {anexos.length > 0 && (
        <ul className="divide-y rounded-md border">
          {anexos.map((a) => {
            const Icone = ehImagem(a.mime) ? ImageIcon : FileText;
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => void abrir(a)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left hover:underline"
                  title={ehImagem(a.mime) ? "Ver a foto" : "Abrir o PDF"}
                >
                  <Icone className="h-5 w-5 shrink-0 text-blue-700" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {tamanhoLegivel(a.tamanho)} · {dataCurta(a.criadoEm)}
                      {a.enviadoPor ? ` · ${a.enviadoPor.nome}` : ""}
                    </span>
                  </span>
                </button>
                <label className="flex items-center gap-2 text-sm">
                  <StatusToggle
                    size="sm"
                    active={a.visivelMotorista}
                    disabled={!podeEditar || mexendo === a.id}
                    onChange={(v) => void alternar(a, v)}
                  />
                  <span className={a.visivelMotorista ? "" : "text-muted-foreground"}>
                    O motorista vê
                  </span>
                </label>
                {podeEditar && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${a.nome}`}
                    disabled={mexendo === a.id}
                    onClick={() => void excluir(a)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <VisualizadorFotos
        fotos={fotos}
        indice={fotoAberta}
        onIndice={setFotoAberta}
        onFechar={() => setFotoAberta(null)}
        titulo="Anexo do pedido"
      />
      <ConfirmDialog />
    </Card>
  );
}
