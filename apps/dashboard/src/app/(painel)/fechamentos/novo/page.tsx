"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, FileSpreadsheet, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useResourceOptions } from "@/lib/client-api";
import { useUploadFechamento } from "@/lib/fechamentos-api";

type Empresa = {
  id: string;
  nome: string;
  ativa: boolean;
  papel: "RECEBE_PLANILHA" | "MANDA_FECHAMENTO" | "AMBOS";
};

export default function NovoFechamentoPage() {
  const router = useRouter();
  const empresas = useResourceOptions<Empresa>("/admin/empresas");
  const upload = useUploadFechamento();

  const [empresaId, setEmpresaId] = useState("");
  const [periodoInicio, setPeriodoInicio] = useState(thisMonthStart());
  const [periodoFim, setPeriodoFim] = useState(thisMonthEnd());
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!arquivo) {
      setError("Selecione um arquivo");
      return;
    }
    try {
      const result = await upload.mutateAsync({
        empresaId: empresaId,
        periodoInicio,
        periodoFim,
        arquivo,
      });
      router.push(`/fechamentos/${result.id}`);
    } catch (err) {
      setError((err as Error).message || "Erro ao enviar arquivo");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/fechamentos">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Novo fechamento</h1>
          <p className="text-sm text-muted-foreground">
            Suba a planilha (Excel, CSV ou PDF) que a empresa enviou. A IA vai inferir
            o layout, extrair as viagens e fazer o match automático.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit}>
        <Card className="space-y-5 p-6">
          <div className="space-y-2">
            <Label>Empresa *</Label>
            <Select required value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              <option value="">— escolha —</option>
              {empresas.data
                ?.filter(
                  (e) =>
                    e.ativa &&
                    (e.papel === "MANDA_FECHAMENTO" || e.papel === "AMBOS"),
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Só lista empresas que enviam fechamento pra gente.
            </p>
          </div>

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
            <Label>Arquivo *</Label>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border p-6 transition-colors hover:bg-muted/50">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="flex-1">
                {arquivo ? (
                  <>
                    <p className="font-medium">{arquivo.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(arquivo.size / 1024).toFixed(0)} KB
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Clique pra selecionar ou arraste o arquivo</p>
                    <p className="text-xs text-muted-foreground">
                      Aceita .xlsx, .csv ou .pdf — até 50 MB
                    </p>
                  </>
                )}
              </div>
              <input
                type="file"
                accept=".xlsx,.csv,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/pdf"
                className="hidden"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 text-blue-600" />
              <div>
                <p className="font-medium">O que acontece após o upload</p>
                <ol className="ml-4 mt-1 list-decimal space-y-0.5 text-muted-foreground">
                  <li>Sistema parseia o arquivo (XLSX, CSV ou PDF)</li>
                  <li>IA identifica colunas (placa, data, ticket, km, valor)</li>
                  <li>Match automático com viagens do banco (placa + data + ticket)</li>
                  <li>IA propõe match nas linhas órfãs (km divergente, ticket ligeiramente diferente)</li>
                  <li>Tela de Conferência abre só com o que humano precisa decidir</li>
                </ol>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Link href="/fechamentos">
              <Button type="button" variant="outline">Cancelar</Button>
            </Link>
            <Button type="submit" disabled={upload.isPending}>
              <FileSpreadsheet className="h-4 w-4" />
              {upload.isPending ? "Enviando e processando..." : "Subir e processar"}
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
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(
    last.getDate(),
  ).padStart(2, "0")}`;
}
