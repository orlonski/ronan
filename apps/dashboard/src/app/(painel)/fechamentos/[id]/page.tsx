"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ExcluirButton } from "@/components/excluir-button";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  History,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  STATUS_FECHAMENTO_COLOR,
  STATUS_FECHAMENTO_LABEL,
  fmtBR,
  fmtBRL,
  fmtDataHoraBR,
  fmtNum,
} from "@/lib/fechamento-helpers";
import {
  useExportarFechamento,
  useFechamento,
  useReprocessar,
} from "@/lib/fechamentos-api";
import { ConferenciaTab } from "./conferencia-tab";
import { LinhasTab } from "./linhas-tab";
import { ResumoTab } from "./resumo-tab";
import { EnviosTab } from "./envios-tab";
import { VersoesTab } from "./versoes-tab";

type Tab = "resumo" | "linhas" | "conferencia" | "versoes" | "envios";

export default function FechamentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const fechamento = useFechamento(id);
  const reprocessar = useReprocessar(id);
  const exportar = useExportarFechamento(id);
  const [tab, setTab] = useState<Tab>("resumo");

  if (fechamento.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }
  if (!fechamento.data) {
    return <p className="text-sm text-red-600">Fechamento não encontrado.</p>;
  }
  const f = fechamento.data;
  const resumo = f.resumoIa;
  const pendentes = resumo?.divergencia ?? 0;
  const layoutDesatualizado: boolean =
    !!f.layoutSalvo &&
    typeof f.layoutSalvo === "object" &&
    (f.layoutSalvo as { _desatualizado?: boolean })._desatualizado === true;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href="/fechamentos">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {f.empresa.nome}
              </h1>
              <Badge className={STATUS_FECHAMENTO_COLOR[f.status]}>
                {STATUS_FECHAMENTO_LABEL[f.status]}
              </Badge>
              {f.versao > 1 && (
                <Badge className="bg-purple-100 text-purple-800 border-purple-200">
                  Versão {f.versao}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {fmtBR(f.periodoInicio)} → {fmtBR(f.periodoFim)} ·{" "}
              {f.arquivoOriginalNome ?? "sem nome"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocessar.mutate(undefined)}
            disabled={reprocessar.isPending}
            title="Reprocessa todos os tipos (viagens, pedágios, combustível)"
          >
            <RefreshCw className="h-4 w-4" /> Reprocessar tudo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocessar.mutate("VIAGEM")}
            disabled={reprocessar.isPending}
            title="Reprocessa só linhas de viagem"
          >
            🚛 Viagens
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocessar.mutate("PEDAGIO")}
            disabled={reprocessar.isPending}
            title="Reprocessa só linhas de pedágio"
          >
            🛣️ Pedágios
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => reprocessar.mutate("COMBUSTIVEL")}
            disabled={reprocessar.isPending}
            title="Reprocessa só linhas de combustível"
          >
            ⛽ Combustível
          </Button>
          <Button
            size="sm"
            onClick={() => exportar.mutate({})}
            disabled={exportar.isPending || pendentes > 0}
          >
            <Download className="h-4 w-4" />
            {exportar.isPending ? "Gerando..." : "Exportar planilha"}
          </Button>
          <ExcluirButton perm="fechamentos.excluir"
            path="/admin/fechamentos"
            id={f.id}
            nomeRecurso={`o fechamento de ${f.empresa.nome} (${fmtBR(f.periodoInicio)} → ${fmtBR(f.periodoFim)})`}
            size="sm"
            variant="outline"
            label="Excluir"
            invalidateKeys={[["fechamento", f.id], "/admin/fechamentos"]}
            onSuccess={() => router.push("/fechamentos")}
          />
        </div>
      </header>

      {layoutDesatualizado && (
        <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="flex-1 space-y-2">
              <p className="font-medium text-amber-900">
                O cliente parece ter mudado o formato da planilha
              </p>
              <p className="text-sm text-amber-800">
                Os cabeçalhos das colunas no arquivo enviado não batem com o
                layout que você tem salvo pra esta empresa. O processamento
                continuou com o layout antigo, mas pode ter perdido dados ou
                gerado divergências.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href={`/empresas/${f.empresa.id}/layout-import`}>
                  <Button size="sm" variant="outline" className="border-amber-400">
                    Atualizar layout de importação
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-400"
                  onClick={() => reprocessar.mutate(undefined)}
                  disabled={reprocessar.isPending}
                >
                  <RefreshCw className="h-3 w-3" />
                  Reprocessar este fechamento
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats cards */}
      {resumo && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard
            icon={ClipboardCheck}
            label="Total"
            value={resumo.total}
            color="bg-slate-50 text-slate-700"
          />
          <StatCard
            icon={CheckCircle2}
            label="Match auto"
            value={resumo.matchAuto}
            color="bg-green-50 text-green-700"
          />
          <StatCard
            icon={Sparkles}
            label="Match IA"
            value={resumo.matchIa}
            color="bg-emerald-50 text-emerald-700"
          />
          <StatCard
            icon={History}
            label="Pendentes"
            value={pendentes}
            color={
              pendentes > 0
                ? "bg-amber-50 text-amber-800"
                : "bg-slate-50 text-slate-500"
            }
          />
          <StatCard
            icon={Send}
            label="Envios"
            value={f.envios.length}
            color="bg-blue-50 text-blue-700"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {(
          [
            ["resumo", "Resumo"],
            ["linhas", "Linhas"],
            ["conferencia", `Conferência${pendentes > 0 ? ` (${pendentes})` : ""}`],
            ["versoes", "Versões"],
            ["envios", `Envios${f.envios.length > 0 ? ` (${f.envios.length})` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === key
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      <div>
        {tab === "resumo" && <ResumoTab fechamento={f} />}
        {tab === "linhas" && <LinhasTab fechamentoId={id} />}
        {tab === "conferencia" && <ConferenciaTab fechamentoId={id} />}
        {tab === "versoes" && <VersoesTab fechamento={f} />}
        {tab === "envios" && <EnviosTab fechamento={f} />}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <Card className="p-4">
      <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}
