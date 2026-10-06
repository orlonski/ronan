"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, FileText, TriangleAlert, Upload, XCircle } from "lucide-react";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingCard } from "@/components/loading";
import { ApiError, fetchApi, useAuthToken } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { RaioXFatura } from "./raio-x";
import { brl, dia, type Extrato } from "./tipos";

const MAX_ARQUIVOS = 12;

export const STATUS_FATURA: Record<Extrato["status"], { rotulo: string; classe: string; icone: typeof CheckCircle2 }> = {
  LIDO: { rotulo: "Lida e conferida", classe: "border-green-200 bg-green-100 text-green-800", icone: CheckCircle2 },
  LIDO_COM_DIVERGENCIA: { rotulo: "Lida, com conferência que não fechou", classe: "border-amber-300 bg-amber-100 text-amber-900", icone: TriangleAlert },
  FALHOU: { rotulo: "Não entrou", classe: "border-red-200 bg-red-100 text-red-800", icone: XCircle },
};

export function Faturas({
  extratoId,
  onEscolher,
  onCasar,
}: {
  extratoId: string | null;
  onEscolher: (id: string) => void;
  onCasar: (placa: string) => void;
}) {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["tag-extratos"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Extrato[]>("/admin/tag-pedagio/extratos", { token: token! }),
  });
  const lista = q.data ?? [];
  const escolhido = lista.find((e) => e.id === extratoId) ?? lista.find((e) => e.status !== "FALHOU") ?? null;

  return (
    <div className="space-y-4 max-2xl:space-y-3">
      <Permitido chave="tag.importar">
        <SubirFaturas />
      </Permitido>

      {q.isLoading && <LoadingCard />}
      {q.error && <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(q.error as Error).message}</Card>}
      {q.data && lista.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhuma fatura ainda. Suba o PDF da fatura mensal do Sem Parar acima — pode ser vários meses de uma vez.
        </Card>
      )}

      {lista.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Faturas importadas</h2>
          </div>
          <ul className="divide-y text-sm">
            {lista.map((e) => (
              <LinhaFatura key={e.id} e={e} ativa={escolhido?.id === e.id} onEscolher={() => onEscolher(e.id)} />
            ))}
          </ul>
        </Card>
      )}

      {escolhido && escolhido.status !== "FALHOU" && <RaioXFatura extratoId={escolhido.id} onCasar={onCasar} />}
    </div>
  );
}

function LinhaFatura({ e, ativa, onEscolher }: { e: Extrato; ativa: boolean; onEscolher: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [desfazendo, setDesfazendo] = React.useState(false);
  const [vendoNaoLidas, setVendoNaoLidas] = React.useState(false);
  const s = STATUS_FATURA[e.status];

  async function desfazer() {
    if (!token) return;
    try {
      await fetchApi(`/admin/tag-pedagio/extratos/${e.id}`, { token, method: "DELETE" });
      toast.success("Importação desfeita.");
      await qc.invalidateQueries({ queryKey: ["tag-extratos"] });
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (err) {
      toast.error("Não consegui desfazer", { description: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <li className={cn("space-y-2 px-4 py-3", ativa && "bg-muted/40")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onEscolher} disabled={e.status === "FALHOU"} className="min-w-0 text-left">
          <span className="font-medium">
            {e.periodoDe ? `${dia(e.periodoDe)} a ${dia(e.periodoAte)}` : e.nomeArquivo}
          </span>
          {e.numeroFatura && <span className="text-muted-foreground"> · fatura {e.numeroFatura}</span>}
          <span className="block text-xs text-muted-foreground">
            {e.status !== "FALHOU" && (
              <>
                {e.passagens} linhas · {e.placas.length} caminhão(ões) · pedágio {brl(e.totalPedagio)} ·{" "}
              </>
            )}
            {e.nomeArquivo} · importada em {new Date(e.importadoEm).toLocaleDateString("pt-BR")}
            {e.importadoPor && ` por ${e.importadoPor}`}
            {e.cnpjConfirmado && " · CNPJ diferente, confirmado por quem subiu"}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", s.classe)}>
            <s.icone className="h-3.5 w-3.5" aria-hidden />
            {s.rotulo}
          </span>
          {e.status !== "FALHOU" && !ativa && (
            <Button size="sm" variant="outline" onClick={onEscolher}>
              Ver raio-x
            </Button>
          )}
          <Permitido chave="tag.importar">
            <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setDesfazendo(true)}>
              {e.status === "FALHOU" ? "Tirar da lista" : "Desfazer importação"}
            </Button>
          </Permitido>
        </div>
      </div>
      {e.motivo && (
        <p className={cn("text-sm", e.status === "FALHOU" ? "text-red-700" : "text-amber-800")}>
          <CircleAlert className="mr-1 inline h-4 w-4" aria-hidden />
          {e.motivo}
        </p>
      )}
      {e.naoLidas.length > 0 && (
        <div className="text-xs">
          <button type="button" className="underline" onClick={() => setVendoNaoLidas((v) => !v)}>
            {vendoNaoLidas ? "Esconder" : "Ver"} as {e.naoLidas.length} linha(s) que não li
          </button>
          {vendoNaoLidas && (
            <ul className="mt-1 space-y-1 rounded-md bg-muted/50 p-2 font-mono">
              {e.naoLidas.map((n) => (
                <li key={`${n.linha}-${n.texto}`}>
                  linha {n.linha}: {n.texto} <span className="font-sans text-muted-foreground">— {n.motivo}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {desfazendo && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2 text-sm dark:bg-red-950/30">
          <span>
            {e.status === "FALHOU"
              ? "O registro da tentativa sai da lista."
              : `As ${e.passagens} linhas desta fatura, o PDF guardado e o que foi calculado delas saem. As decisões já tomadas ficam guardadas.`}
          </span>
          <Button size="sm" variant="outline" onClick={() => setDesfazendo(false)}>
            Voltar
          </Button>
          <Button size="sm" variant="destructive" onClick={desfazer}>
            {e.status === "FALHOU" ? "Tirar da lista" : "Desfazer importação"}
          </Button>
        </div>
      )}
    </li>
  );
}

type ResultadoImport = { jaImportado: boolean; extrato: { id: string; status: Extrato["status"] }; motivo: string | null };
type Item = { arquivo: File; estado: "fila" | "lendo" | "ok" | "ja" | "falhou" | "cnpj" | "erro"; texto?: string };

/** Sobe vários PDFs, um de cada vez. CNPJ que não bate pede "é nossa" inline, arquivo a arquivo. */
function SubirFaturas() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [itens, setItens] = React.useState<Item[]>([]);
  const [ocupado, setOcupado] = React.useState(false);

  const atualizar = (i: number, x: Partial<Item>) => setItens((l) => l.map((it, k) => (k === i ? { ...it, ...x } : it)));

  async function enviar(i: number, arquivo: File, confirmarCnpj: boolean) {
    if (!token) return;
    atualizar(i, { estado: "lendo", texto: undefined });
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    if (confirmarCnpj) fd.append("confirmarCnpj", "true");
    try {
      const r = await fetchApi<ResultadoImport>("/admin/tag-pedagio/importar", { token, method: "POST", body: fd });
      if (r.jaImportado) atualizar(i, { estado: "ja", texto: r.motivo ?? "Já importada." });
      else if (r.extrato.status === "FALHOU") atualizar(i, { estado: "falhou", texto: r.motivo ?? "Não entrou." });
      else atualizar(i, { estado: "ok", texto: r.extrato.status === "LIDO" ? "Lida e conferida." : r.motivo ?? "Lida, com divergência." });
    } catch (e) {
      if (e instanceof ApiError && e.code === "CNPJ_DIFERENTE") atualizar(i, { estado: "cnpj", texto: e.message });
      else atualizar(i, { estado: "erro", texto: e instanceof Error ? e.message : "Erro ao enviar." });
    }
  }

  async function subir(files: File[]) {
    const lista = files.slice(0, MAX_ARQUIVOS).map((arquivo) => ({ arquivo, estado: "fila" as const }));
    if (files.length > MAX_ARQUIVOS) toast.warning(`Até ${MAX_ARQUIVOS} faturas por vez (um ano). Subi as ${MAX_ARQUIVOS} primeiras.`);
    setItens(lista);
    setOcupado(true);
    for (let i = 0; i < lista.length; i++) await enviar(i, lista[i]!.arquivo, false);
    setOcupado(false);
    if (inputRef.current) inputRef.current.value = "";
    await qc.invalidateQueries({ queryKey: ["tag-extratos"] });
    await qc.invalidateQueries({ queryKey: ["tag"] });
  }

  async function confirmar(i: number) {
    setOcupado(true);
    await enviar(i, itens[i]!.arquivo, true);
    setOcupado(false);
    await qc.invalidateQueries({ queryKey: ["tag-extratos"] });
    await qc.invalidateQueries({ queryKey: ["tag"] });
  }

  const COR: Record<Item["estado"], string> = {
    fila: "text-muted-foreground",
    lendo: "text-muted-foreground",
    ok: "text-green-700",
    ja: "text-muted-foreground",
    falhou: "text-red-700",
    cnpj: "text-amber-800",
    erro: "text-red-700",
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Subir a fatura do Sem Parar</h2>
          <p className="text-sm text-muted-foreground">
            O PDF da fatura mensal, como o Sem Parar manda. Pode subir até {MAX_ARQUIVOS} meses de uma vez. O arquivo só
            entra se as 6 conferências fecharem — se não fechar, a gente diz qual e mostra a linha. A mesma fatura subida
            de novo não duplica nada.
          </p>
        </div>
        <Button onClick={() => inputRef.current?.click()} disabled={ocupado}>
          <Upload className="h-4 w-4" aria-hidden />
          Escolher PDFs
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          aria-label="PDFs da fatura"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) void subir(fs);
          }}
        />
      </div>
      {itens.length > 0 && (
        <ul className="space-y-2 text-sm">
          {itens.map((it, i) => (
            <li key={`${it.arquivo.name}-${i}`} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="font-medium">{it.arquivo.name}</span>
                <span className={cn("text-xs", COR[it.estado])}>
                  {it.estado === "fila" ? "na fila" : it.estado === "lendo" ? "lendo e conferindo…" : it.texto}
                </span>
              </div>
              {it.estado === "cnpj" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 dark:bg-amber-950/30">
                  <span className="text-amber-900 dark:text-amber-200">Só entra se você confirmar que a fatura é desta empresa.</span>
                  <Button size="sm" variant="outline" disabled={ocupado} onClick={() => atualizar(i, { estado: "erro", texto: "Não importada." })}>
                    Não importar
                  </Button>
                  <Button size="sm" variant="warning" disabled={ocupado} onClick={() => confirmar(i)}>
                    É desta empresa, importar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
