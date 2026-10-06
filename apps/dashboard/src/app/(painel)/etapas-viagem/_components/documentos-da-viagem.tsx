"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, MapPin, Paperclip, Undo2 } from "lucide-react";
import {
  itensDaDefinicao,
  MARCA_RESPOSTA_ETAPA_LABEL,
  MOTIVO_SEGUIR_SEM_LABEL,
  type AcaoEtapaPainel,
  type ArquivoEtapaPainel,
  type DocumentosDaViagemPainel,
  type EtapaDaViagemPainel,
  type ItemEtapa,
  type ItemRespostaPainel,
} from "@ronan/shared-types";
import { VisualizadorFotos } from "@/components/visualizador-fotos";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

const hora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O arquivo autenticado em blob URL (o bucket nunca é público; iframe/img não mandam token). */
function useArquivoBlob(url: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["arquivo-etapa", url],
    enabled: !!token && !!url,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    },
  });
}

/**
 * Ficha da viagem › "Documentos" (módulo `etapas`).
 *
 * Mostra o que chegou e o que FALTA — inclusive do formulário que o motorista
 * nem abriu (a pendência é calculada na leitura). Foto e PDF abrem NA PRÓPRIA
 * TELA. O que falta aparece em amarelo, com o motivo se ele seguiu sem; o
 * escritório pode anexar (nos itens marcados) ou dispensar com motivo.
 * Documento faltando NÃO segura o faturamento (decisão do dono).
 */
export function DocumentosDaViagem({ viagemId }: { viagemId: string }) {
  const { temPermissao, temModulo } = usePermissoes();
  const pode = (c: string) => temPermissao(c) && temModulo(c);
  const ver = pode("etapas-respostas.ver");
  const editar = pode("etapas-respostas.editar");
  const token = useAuthToken();
  const qc = useQueryClient();
  const chave = ["etapas-da-viagem", viagemId];
  const q = useQuery({
    queryKey: chave,
    enabled: !!token && ver,
    queryFn: () => fetchApi<DocumentosDaViagemPainel>(`/admin/etapas/viagem/${viagemId}`, { token }),
  });
  const [fotos, setFotos] = React.useState<{ lista: ArquivoEtapaPainel[]; indice: number; titulo: string } | null>(null);
  const [pdf, setPdf] = React.useState<ArquivoEtapaPainel | null>(null);

  if (!ver || !q.data || q.data.etapas.length === 0) return null;
  const dados = q.data;

  const atualizar = (d: DocumentosDaViagemPainel) => qc.setQueryData(chave, d);

  function abrirArquivo(lista: ArquivoEtapaPainel[], a: ArquivoEtapaPainel, titulo: string) {
    if (a.mime === "application/pdf") return setPdf(a);
    const imagens = lista.filter((x) => x.mime.startsWith("image/"));
    setFotos({ lista: imagens, indice: Math.max(0, imagens.findIndex((x) => x.id === a.id)), titulo });
  }

  return (
    <Card className="p-4 sm:p-5">
      {fotos && (
        <VisualizadorFotos
          fotos={fotos.lista.map((f) => ({ id: f.id, caminho: f.url, rotacao: 0 }))}
          indice={fotos.indice}
          onIndice={(i) => setFotos({ ...fotos, indice: i })}
          onFechar={() => setFotos(null)}
          titulo={fotos.titulo}
        />
      )}
      <VisualizadorPdf arquivo={pdf} onFechar={() => setPdf(null)} />
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-medium">Documentos</h3>
        {dados.documentosFaltando > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            {dados.documentosFaltando} {dados.documentosFaltando === 1 ? "documento faltando" : "documentos faltando"}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Tudo em dia</span>
        )}
      </div>
      <div className="space-y-4">
        {dados.etapas.map((e) => (
          <EtapaCartao
            key={e.modeloId}
            etapa={e}
            viagemId={viagemId}
            editar={editar}
            onAtualizar={atualizar}
            onAbrir={abrirArquivo}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Documento faltando não segura o faturamento da viagem.</p>
    </Card>
  );
}

function SituacaoChip({ e }: { e: EtapaDaViagemPainel }) {
  const s = e.estado.situacao;
  const [txt, cor] =
    s === "COMPLETA"
      ? ["Completa", "bg-emerald-100 text-emerald-800"]
      : s === "FALTANDO"
        ? [`Falta ${e.estado.faltando.length}`, "bg-amber-100 text-amber-900"]
        : ["Ainda não é a hora", "bg-slate-100 text-slate-600"];
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", cor)}>{txt}</span>;
}

function EtapaCartao({
  etapa,
  viagemId,
  editar,
  onAtualizar,
  onAbrir,
}: {
  etapa: EtapaDaViagemPainel;
  viagemId: string;
  editar: boolean;
  onAtualizar: (d: DocumentosDaViagemPainel) => void;
  onAbrir: (lista: ArquivoEtapaPainel[], a: ArquivoEtapaPainel, titulo: string) => void;
}) {
  const r = etapa.resposta;
  const itens = itensDaDefinicao(etapa.definicao);
  const areas = [...new Set(itens.map((i) => i.area))];
  const [dispensandoTudo, setDispensandoTudo] = React.useState(false);
  return (
    <section className="rounded-md border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="flex items-center gap-2 font-medium">
          {etapa.nome} <SituacaoChip e={etapa} />
        </span>
        <span className="text-xs text-muted-foreground">
          {r ? (
            <>
              {r.concluidaEm ? `concluída ${hora(r.concluidaEm)}` : `recebida ${hora(r.atualizadoEm)} · não concluída`}
              {r.motoristaNome ? ` · ${r.motoristaNome}` : ""}
              {r.placa ? ` · ${r.placa}` : ""}
              {r.lat != null && r.lng != null && (
                <a
                  className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
                  href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-3 w-3" /> onde
                </a>
              )}
              {r.criadoOfflineEm ? " · guardado no celular sem sinal" : ""}
            </>
          ) : etapa.estado.situacao === "AINDA_NAO" ? (
            "O motorista ainda não chegou neste momento da viagem."
          ) : (
            "O motorista ainda não abriu este formulário."
          )}
        </span>
      </header>
      {r && r.marcas.length > 0 && (
        <p className="px-3 pt-2 text-xs text-muted-foreground">{r.marcas.map((m) => MARCA_RESPOSTA_ETAPA_LABEL[m] ?? m).join(" · ")}</p>
      )}
      <div className="divide-y">
        {areas.map((area) => (
          <div key={area} className="px-3 py-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{area}</p>
            <ul className="space-y-2">
              {itens
                .filter((i) => i.area === area)
                .map((it) => (
                  <ItemLinha
                    key={it.chave}
                    item={it}
                    etapa={etapa}
                    viagemId={viagemId}
                    editar={editar}
                    onAtualizar={onAtualizar}
                    onAbrir={onAbrir}
                  />
                ))}
            </ul>
          </div>
        ))}
      </div>
      {editar && etapa.estado.situacao === "FALTANDO" && (
        <div className="border-t px-3 py-2">
          {dispensandoTudo ? (
            <Dispensar
              viagemId={viagemId}
              modeloId={etapa.modeloId}
              itemChave={null}
              texto={`Dispensar o formulário inteiro (${etapa.nome})`}
              onFeito={(d) => {
                setDispensandoTudo(false);
                onAtualizar(d);
              }}
              onCancelar={() => setDispensandoTudo(false)}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDispensandoTudo(true)}>
              Dispensar o formulário inteiro
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Valor({ item, resp, tarifa }: { item: ItemEtapa; resp: ItemRespostaPainel; tarifa?: EtapaDaViagemPainel["tarifas"][number] }) {
  const partes: React.ReactNode[] = [];
  if (resp.simNao != null) partes.push(<strong key="sn">{resp.simNao ? "Sim" : "Não"}</strong>);
  if (resp.texto) partes.push(<span key="t">{resp.texto}</span>);
  if (resp.valor != null) partes.push(<strong key="v">{brl(resp.valor)}</strong>);
  if (resp.numero != null)
    partes.push(
      <strong key="n">
        {resp.numero.toLocaleString("pt-BR", { maximumFractionDigits: item.numero.casas })} {item.numero.unidade ?? ""}
      </strong>,
    );
  if (resp.comentario) partes.push(<span key="c" className="text-muted-foreground">“{resp.comentario}”</span>);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {partes}
      {tarifa?.diferente && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          Diferente da tabela ({brl(tarifa.tabela!)} por tonelada)
        </span>
      )}
      {tarifa && tarifa.diferente === false && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Igual à tabela</span>
      )}
    </span>
  );
}

function Assinatura({ d, nome }: { d: string; nome: string | null }) {
  return (
    <span className="inline-flex flex-col">
      <svg viewBox="0 0 300 150" className="h-16 w-32 rounded border bg-white" aria-label="Assinatura">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {nome && <span className="text-xs text-muted-foreground">{nome}</span>}
    </span>
  );
}

function Miniatura({ a, onAbrir }: { a: ArquivoEtapaPainel; onAbrir: () => void }) {
  const ehImagem = a.mime.startsWith("image/");
  const blob = useArquivoBlob(ehImagem ? a.url : undefined);
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={a.nome ?? (ehImagem ? "Ver a foto" : "Ver o PDF")}
      className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted text-[10px] font-semibold"
    >
      {ehImagem ? (
        blob.data && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={blob.data} alt="" className="h-full w-full object-cover" />
        )
      ) : (
        <span className="flex flex-col items-center text-muted-foreground">
          <FileText className="h-4 w-4" /> PDF
        </span>
      )}
    </button>
  );
}

function ItemLinha({
  item,
  etapa,
  viagemId,
  editar,
  onAtualizar,
  onAbrir,
}: {
  item: ItemEtapa & { area: string };
  etapa: EtapaDaViagemPainel;
  viagemId: string;
  editar: boolean;
  onAtualizar: (d: DocumentosDaViagemPainel) => void;
  onAbrir: (lista: ArquivoEtapaPainel[], a: ArquivoEtapaPainel, titulo: string) => void;
}) {
  const token = useAuthToken();
  const estado = etapa.estado.itens.find((i) => i.chave === item.chave)?.estado ?? "OPCIONAL_VAZIO";
  const resp = etapa.resposta?.itens.find((i) => i.chave === item.chave) ?? null;
  const falta = etapa.estado.faltando.find((f) => f.itemChave === item.chave) ?? null;
  const acoes = etapa.acoes.filter((a) => a.itemChave === item.chave && !a.desfeitoEm);
  const anexos = acoes.filter((a) => a.tipo === "ANEXADO_ESCRITORIO" && a.arquivo).map((a) => a.arquivo!);
  const dispensa = acoes.find((a) => a.tipo === "DISPENSADO") ?? etapa.acoes.find((a) => a.tipo === "DISPENSADO" && a.itemChave == null && !a.desfeitoEm);
  const arquivos = [...(resp?.arquivosPainel.filter((a) => !a.removidoEm) ?? []), ...anexos];
  const tarifa = etapa.tarifas.find((t) => t.itemChave === item.chave);
  const [dispensando, setDispensando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const momentoChegou = etapa.estado.situacao !== "AINDA_NAO";

  async function anexar(f: File) {
    if (!token) return;
    const fd = new FormData();
    fd.append("arquivo", f);
    fd.append("modeloId", etapa.modeloId);
    fd.append("itemChave", item.chave);
    setEnviando(true);
    try {
      const d = await fetchApi<DocumentosDaViagemPainel>(`/admin/etapas/viagem/${viagemId}/anexar`, {
        token,
        method: "POST",
        body: fd,
      });
      toast.success("Documento anexado. Some da lista do motorista na próxima conexão dele.");
      onAtualizar(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function desfazer(a: AcaoEtapaPainel) {
    if (!token) return;
    try {
      onAtualizar(await fetchApi<DocumentosDaViagemPainel>(`/admin/etapas/acoes/${a.id}/desfazer`, { token, method: "POST" }));
      toast.success(a.tipo === "DISPENSADO" ? "Dispensa desfeita." : "Anexo desfeito.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <li className={cn("rounded px-2 py-1.5", estado === "FALTANDO" && momentoChegou && "bg-amber-50")}>
      <div className="grid gap-1 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-3">
        <span className="text-sm">
          {item.rotulo}
          {item.obrigatorio && <span className="ml-1 text-[11px] text-muted-foreground">obrigatório</span>}
        </span>
        <div className="min-w-0 space-y-1 text-sm">
          {resp && <Valor item={item} resp={resp} tarifa={tarifa} />}
          {resp?.assinatura && <Assinatura d={resp.assinatura} nome={resp.assinanteNome} />}
          {arquivos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {arquivos.map((a) => (
                <Miniatura key={a.id} a={a} onAbrir={() => onAbrir(arquivos, a, item.rotulo)} />
              ))}
            </div>
          )}
          {resp?.corrigidoEm && <p className="text-xs text-muted-foreground">corrigido às {hora(resp.corrigidoEm)}</p>}
          {estado === "OPCIONAL_VAZIO" && !resp && <p className="text-xs text-muted-foreground">—</p>}
          {estado === "FALTANDO" && (
            <p className={cn("text-xs font-medium", momentoChegou ? "text-amber-900" : "text-muted-foreground")}>
              {momentoChegou ? "Falta" : "Ainda não"}
              {item.seFaltar === "NAO_SEGUIR" ? " · o escritório precisa deste documento" : ""}
            </p>
          )}
          {falta?.seguiuSem && (
            <p className="text-xs text-amber-900">
              Seguiu sem em {hora(falta.seguiuSem.em)} —{" "}
              {falta.seguiuSem.motivoCodigo ? MOTIVO_SEGUIR_SEM_LABEL[falta.seguiuSem.motivoCodigo] : "motivo"}
              {falta.seguiuSem.motivo ? `: ${falta.seguiuSem.motivo}` : ""}
            </p>
          )}
          {estado === "ANEXADO_ESCRITORIO" &&
            acoes
              .filter((a) => a.tipo === "ANEXADO_ESCRITORIO")
              .map((a) => (
                <p key={a.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Anexado pelo escritório{a.autor ? ` (${a.autor})` : ""} em {hora(a.em)}
                  {editar && (
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void desfazer(a)}>
                      <Undo2 className="h-3 w-3" /> Desfazer
                    </Button>
                  )}
                </p>
              ))}
          {estado === "DISPENSADO" && dispensa && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Dispensado{dispensa.autor ? ` por ${dispensa.autor}` : ""} em {hora(dispensa.em)}
              {dispensa.motivo ? `: ${dispensa.motivo}` : ""}
              {editar && (
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void desfazer(dispensa)}>
                  <Undo2 className="h-3 w-3" /> Desfazer
                </Button>
              )}
            </p>
          )}
          {editar && estado === "FALTANDO" && (
            <div className="flex flex-wrap gap-2 pt-1">
              {item.escritorioPodeAnexar && (
                <>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (f) void anexar(f);
                    }}
                  />
                  <Button size="sm" disabled={enviando} onClick={() => inputRef.current?.click()}>
                    <Paperclip className="h-3.5 w-3.5" /> {enviando ? "Enviando…" : "Anexar pelo escritório"}
                  </Button>
                </>
              )}
              {!dispensando && (
                <Button size="sm" variant="outline" onClick={() => setDispensando(true)}>
                  Dispensar
                </Button>
              )}
            </div>
          )}
          {dispensando && (
            <Dispensar
              viagemId={viagemId}
              modeloId={etapa.modeloId}
              itemChave={item.chave}
              texto={`Dispensar “${item.rotulo}”`}
              onFeito={(d) => {
                setDispensando(false);
                onAtualizar(d);
              }}
              onCancelar={() => setDispensando(false)}
            />
          )}
        </div>
      </div>
    </li>
  );
}

/** Confirmação inline com motivo (nunca pop-up): dispensa fecha a pendência, e o motivo fica gravado. */
function Dispensar({
  viagemId,
  modeloId,
  itemChave,
  texto,
  onFeito,
  onCancelar,
}: {
  viagemId: string;
  modeloId: string;
  itemChave: string | null;
  texto: string;
  onFeito: (d: DocumentosDaViagemPainel) => void;
  onCancelar: () => void;
}) {
  const token = useAuthToken();
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  async function confirmar() {
    if (!token) return;
    setEnviando(true);
    try {
      const d = await fetchApi<DocumentosDaViagemPainel>(`/admin/etapas/viagem/${viagemId}/dispensar`, {
        token,
        method: "POST",
        body: JSON.stringify({ modeloId, itemChave, motivo: motivo.trim() }),
      });
      toast.success("Dispensado. O motivo fica gravado na viagem.");
      onFeito(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2">
      <p className="text-xs font-medium text-amber-900">{texto}</p>
      <Input placeholder="Por quê? (fica gravado)" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancelar}>
          Voltar
        </Button>
        <Button size="sm" variant="warning" disabled={motivo.trim().length < 3 || enviando} onClick={() => void confirmar()}>
          Dispensar com este motivo
        </Button>
      </div>
    </div>
  );
}

/** PDF na própria tela: baixado como blob (o iframe não manda o token). */
function VisualizadorPdf({ arquivo, onFechar }: { arquivo: ArquivoEtapaPainel | null; onFechar: () => void }) {
  const blob = useArquivoBlob(arquivo?.url);
  return (
    <Dialog open={!!arquivo} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[95vw] max-w-5xl flex-col gap-3 p-4 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">{arquivo?.nome ?? "Documento"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          {blob.isLoading ? (
            <span className="text-sm text-muted-foreground">Carregando o arquivo…</span>
          ) : blob.isError ? (
            <span className="text-sm text-destructive">Não consegui abrir o arquivo.</span>
          ) : blob.data ? (
            <iframe src={blob.data} title={arquivo?.nome ?? "Documento"} className="h-full w-full border-0" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
