"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  PlusCircle,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fmtBR,
  fmtBRL,
  fmtNum,
} from "@/lib/fechamento-helpers";
import {
  useLinhasFechamento,
  useResolverLinha,
  type LinhaFechamento,
} from "@/lib/fechamentos-api";

export function ConferenciaTab({ fechamentoId }: { fechamentoId: string }) {
  const linhas = useLinhasFechamento(fechamentoId, "DIVERGENCIA");
  const resolver = useResolverLinha(fechamentoId);
  const [motivos, setMotivos] = useState<Record<string, string>>({});

  const setMotivo = (id: string, m: string) => setMotivos((s) => ({ ...s, [id]: m }));

  if (linhas.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando divergências...</p>;
  }
  const items = linhas.data ?? [];
  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 p-12 text-center">
        <div className="rounded-full bg-green-100 p-3">
          <Check className="h-8 w-8 text-green-700" />
        </div>
        <h3 className="text-lg font-medium">Nenhuma divergência pendente</h3>
        <p className="text-sm text-muted-foreground">
          A IA conseguiu casar todas as linhas automaticamente. Você pode exportar a planilha
          quando quiser.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <p>
            <strong>{items.length}</strong> linha{items.length === 1 ? "" : "s"} precisa{items.length === 1 ? "" : "m"} de revisão. Para cada uma,
            escolha uma das ações abaixo. Tudo fica registrado no histórico.
          </p>
        </div>
      </div>

      {items.map((linha) => (
        <LinhaCard
          key={linha.id}
          linha={linha}
          motivo={motivos[linha.id] ?? ""}
          onMotivo={(m) => setMotivo(linha.id, m)}
          onResolver={(acao, viagemId) =>
            resolver.mutate({
              linhaId: linha.id,
              acao,
              viagemId,
              motivo: motivos[linha.id] || undefined,
            })
          }
          pending={resolver.isPending}
        />
      ))}
    </div>
  );
}

function LinhaCard({
  linha,
  motivo,
  onMotivo,
  onResolver,
  pending,
}: {
  linha: LinhaFechamento;
  motivo: string;
  onMotivo: (m: string) => void;
  onResolver: (
    acao: "aceitar_sugestao" | "escolher_viagem" | "erro_cliente" | "criar_retroativa",
    viagemId?: string,
  ) => void;
  pending: boolean;
}) {
  const sug = linha.sugestaoIa;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge className="border-red-200 bg-red-50 text-red-800">
          Linha {linha.ordem}
        </Badge>
        <span className="font-mono text-sm">{linha.placa}</span>
        <span className="text-sm text-muted-foreground">{fmtBR(linha.data)}</span>
        <span className="text-sm">Ticket {linha.ticket}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Lado cliente */}
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Cliente reportou
          </p>
          <dl className="space-y-1 text-sm">
            <Field label="Toneladas" value={fmtNum(linha.toneladas, 3)} />
            <Field label="Km" value={fmtNum(linha.km, 2)} />
            <Field label="Valor" value={fmtBRL(linha.valor)} />
            {linha.obraTexto && <Field label="Obra (texto)" value={linha.obraTexto} />}
          </dl>
        </div>

        {/* Lado motorista (sugestão IA) */}
        <div
          className={`rounded-md border p-3 ${
            sug?.viagemId ? "border-blue-200 bg-blue-50" : "border-dashed bg-background"
          }`}
        >
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            <p className="text-xs font-medium uppercase tracking-wider text-blue-700">
              Sugestão da IA
            </p>
          </div>
          {sug?.viagemId ? (
            <>
              <p className="text-sm">
                Viagem provável encontrada — confidence{" "}
                <strong>{((sug.confidence ?? 0) * 100).toFixed(0)}%</strong>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {sug.motivo ?? "—"}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              IA não encontrou correspondência clara. Decida manualmente.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs text-muted-foreground">Motivo / observação (opcional)</label>
        <Input
          value={motivo}
          onChange={(e) => onMotivo(e.target.value)}
          placeholder='ex: "ida e volta não somada", "ticket digitado errado"'
          className="mt-1"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {sug?.viagemId && (
          <Button
            size="sm"
            onClick={() => onResolver("aceitar_sugestao")}
            disabled={pending}
          >
            <Sparkles className="h-3.5 w-3.5" /> Aceitar sugestão da IA
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            const viagemId = window.prompt("ID da viagem correta:");
            if (viagemId) onResolver("escolher_viagem", viagemId);
          }}
        >
          <Search className="h-3.5 w-3.5" /> Escolher outra viagem
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onResolver("erro_cliente")}
        >
          <XCircle className="h-3.5 w-3.5" /> Erro do cliente
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onResolver("criar_retroativa")}
        >
          <PlusCircle className="h-3.5 w-3.5" /> Criar viagem retroativa
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
