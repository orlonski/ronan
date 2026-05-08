"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useResourceList } from "@/lib/client-api";
import {
  useBaixarArquivo,
  useCriarEnvio,
  useLayoutsEnvio,
} from "@/lib/fechamentos-api";

type Empresa = { id: string; nome: string; ativa: boolean; papel: string };
type Obra = {
  id: string;
  nome: string;
  ativa: boolean;
  empresaClienteId: string;
};

export default function NovoEnvioPage() {
  const router = useRouter();
  const empresas = useResourceList<Empresa>("/admin/empresas");
  const criar = useCriarEnvio();
  const baixar = useBaixarArquivo();

  const [empresaId, setEmpresaId] = useState("");
  const [periodoInicio, setPeriodoInicio] = useState(thisMonthStart());
  const [periodoFim, setPeriodoFim] = useState(thisMonthEnd());
  const [layoutId, setLayoutId] = useState<string>("");
  const [obraIds, setObraIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const layouts = useLayoutsEnvio(empresaId || undefined);
  // Quando sem empresa selecionada, useResourceList ainda dispara mas vazia.
  // Só renderizamos o select de obras quando empresaId existe.
  const obras = useResourceList<Obra>(
    `/admin/obras${empresaId ? `?empresaClienteId=${empresaId}` : ""}`,
  );

  // ao trocar de empresa, seleciona automaticamente o layout padrão
  // e zera as obras selecionadas (= todas, default)
  useEffect(() => {
    if (!layouts.data) return;
    const padrao = layouts.data.find((l) => l.padrao);
    setLayoutId(padrao?.id ?? layouts.data[0]?.id ?? "");
  }, [layouts.data]);

  useEffect(() => {
    setObraIds([]);
  }, [empresaId]);

  function toggleObra(id: string) {
    setObraIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selecionarTodas() {
    setObraIds([]);
  }

  function selecionarTodasExplicito() {
    if (obras.data) setObraIds(obras.data.map((o) => o.id));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await criar.mutateAsync({
        empresaClienteId: empresaId,
        periodoInicio,
        periodoFim,
        layoutEnvioId: layoutId || undefined,
        obraIds: obraIds.length > 0 ? obraIds : undefined,
      });
      // dispara download autenticado e volta pra listagem
      await baixar(
        `/admin/envios/${result.envio.id}/download`,
        result.arquivoNome,
      ).catch(() => {/* tab fica em /envios mesmo se falhar */});
      router.push("/envios");
    } catch (err) {
      setError((err as Error).message || "Erro ao gerar envio");
    }
  }

  const empresaSelecionada = empresas.data?.find((e) => e.id === empresaId);
  const semLayout = layouts.data && layouts.data.length === 0 && !!empresaId;
  const obrasAtivas = obras.data?.filter((o) => o.ativa) ?? [];
  const todasSelecionadas = obraIds.length === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/envios">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Novo envio</h1>
          <p className="text-sm text-muted-foreground">
            Gera uma planilha XLSX no layout configurado da empresa-cliente, com todas as
            viagens das obras dela no período.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit}>
        <Card className="space-y-5 p-6">
          <div className="space-y-2">
            <Label>Empresa-cliente *</Label>
            <Select required value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              <option value="">— escolha —</option>
              {empresas.data
                ?.filter((e) => e.ativa)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
            </Select>
          </div>

          {empresaId && obrasAtivas.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Obras</Label>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={selecionarTodas}
                    className="text-blue-600 hover:underline"
                  >
                    Todas
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={selecionarTodasExplicito}
                    className="text-blue-600 hover:underline"
                  >
                    Marcar todas
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => setObraIds([])}
                    className="text-blue-600 hover:underline"
                    disabled={todasSelecionadas}
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/20 p-2">
                {obrasAtivas.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      checked={obraIds.includes(o.id)}
                      onChange={() => toggleObra(o.id)}
                      className="h-4 w-4"
                    />
                    <span>{o.nome}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {todasSelecionadas
                  ? `Todas as ${obrasAtivas.length} obra(s) ativa(s) serão incluídas.`
                  : `${obraIds.length} obra(s) selecionada(s).`}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Período de</Label>
              <Input
                type="date"
                required
                value={periodoInicio}
                onChange={(e) => setPeriodoInicio(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Período até</Label>
              <Input
                type="date"
                required
                value={periodoFim}
                onChange={(e) => setPeriodoFim(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Layout de envio</Label>
            {empresaId === "" && (
              <p className="text-xs text-muted-foreground">
                Escolha uma empresa primeiro pra ver os layouts dela.
              </p>
            )}
            {empresaId && layouts.isLoading && (
              <p className="text-xs text-muted-foreground">Carregando layouts...</p>
            )}
            {semLayout && empresaSelecionada && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Esta empresa ainda não tem layout de envio configurado.{" "}
                <Link
                  href={`/empresas/${empresaSelecionada.id}/layout-envio`}
                  className="underline font-medium"
                >
                  Configurar agora
                </Link>
              </div>
            )}
            {layouts.data && layouts.data.length > 0 && (
              <Select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
                {layouts.data.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} {l.padrao && "(padrão)"}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 text-blue-600" />
              <div>
                <p className="font-medium">O que vai ser incluído</p>
                <p className="mt-1 text-muted-foreground">
                  Todas as viagens das obras dessa empresa no período, com status
                  conferida/OK/ajustada. As colunas, formato de data e totais seguem o layout
                  selecionado. Após gerar, você pode marcar como enviado e o sistema guarda o
                  registro com data e canal.
                </p>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Link href="/envios">
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </Link>
            <Button type="submit" disabled={criar.isPending || semLayout}>
              <FileSpreadsheet className="h-4 w-4" />
              {criar.isPending ? "Gerando..." : "Gerar e baixar XLSX"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

function thisMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function thisMonthEnd() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}
