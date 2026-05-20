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
import { fmtBR, fmtBRL, fmtNum } from "@/lib/fechamento-helpers";
import {
  useLinhasFechamento,
  useResolverLinha,
  type LinhaFechamento,
} from "@/lib/fechamentos-api";

const TIPOS = ["VIAGEM", "PEDAGIO", "COMBUSTIVEL"] as const;
type Tipo = (typeof TIPOS)[number];

const TIPO_LABEL: Record<Tipo, string> = {
  VIAGEM: "🚛 Viagens",
  PEDAGIO: "🛣️ Pedágios",
  COMBUSTIVEL: "⛽ Combustível",
};

export function ConferenciaTab({ fechamentoId }: { fechamentoId: string }) {
  const [tipo, setTipo] = useState<Tipo>("VIAGEM");
  const linhas = useLinhasFechamento(fechamentoId, "DIVERGENCIA", tipo);
  const resolver = useResolverLinha(fechamentoId);

  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const setMotivo = (id: string, m: string) =>
    setMotivos((s) => ({ ...s, [id]: m }));

  const items = linhas.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b">
        {TIPOS.map((t) => (
          <button
            key={t}
            onClick={() => setTipo(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tipo === t
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TIPO_LABEL[t]}
          </button>
        ))}
      </div>

      {linhas.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando divergências...</p>
      )}

      {!linhas.isLoading && items.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="rounded-full bg-green-100 p-3">
            <Check className="h-8 w-8 text-green-700" />
          </div>
          <h3 className="text-lg font-medium">
            Nenhuma divergência em {TIPO_LABEL[tipo]}
          </h3>
          <p className="text-sm text-muted-foreground">
            Tudo bateu pra esse tipo. Você pode olhar os outros tipos nas abas
            acima ou exportar a planilha.
          </p>
        </Card>
      )}

      {items.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <p>
              <strong>{items.length}</strong> linha
              {items.length === 1 ? "" : "s"} de {TIPO_LABEL[tipo]} precisa
              {items.length === 1 ? "" : "m"} de revisão.
            </p>
          </div>
        </div>
      )}

      {items.map((linha) => {
        const motivo = motivos[linha.id] ?? "";
        const onResolver = (
          acao:
            | "aceitar_sugestao"
            | "escolher_viagem"
            | "erro_cliente"
            | "criar_retroativa",
          viagemId?: string,
        ) =>
          resolver.mutate({
            linhaId: linha.id,
            acao,
            viagemId,
            motivo: motivo || undefined,
          });

        if (tipo === "VIAGEM") {
          return (
            <LinhaViagemCard
              key={linha.id}
              linha={linha}
              motivo={motivo}
              onMotivo={(m) => setMotivo(linha.id, m)}
              onResolver={onResolver}
              pending={resolver.isPending}
            />
          );
        }
        if (tipo === "PEDAGIO") {
          return (
            <LinhaPedagioCard
              key={linha.id}
              linha={linha}
              motivo={motivo}
              onMotivo={(m) => setMotivo(linha.id, m)}
              onResolver={onResolver}
              pending={resolver.isPending}
            />
          );
        }
        return (
          <LinhaCombustivelCard
            key={linha.id}
            linha={linha}
            motivo={motivo}
            onMotivo={(m) => setMotivo(linha.id, m)}
            onResolver={onResolver}
            pending={resolver.isPending}
          />
        );
      })}
    </div>
  );
}

type ResolverFn = (
  acao: "aceitar_sugestao" | "escolher_viagem" | "erro_cliente" | "criar_retroativa",
  viagemId?: string,
) => void;

function LinhaViagemCard({
  linha,
  motivo,
  onMotivo,
  onResolver,
  pending,
}: {
  linha: LinhaFechamento;
  motivo: string;
  onMotivo: (m: string) => void;
  onResolver: ResolverFn;
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
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Cliente reportou
          </p>
          <dl className="space-y-1 text-sm">
            <Field label="Toneladas" value={fmtNum(linha.toneladas, 3)} />
            <Field label="Km" value={fmtNum(linha.km, 2)} />
            <Field label="Valor" value={fmtBRL(linha.valor)} />
            {linha.clienteTexto && <Field label="Cliente (texto)" value={linha.clienteTexto} />}
          </dl>
        </div>

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
              <p className="mt-1 text-xs text-muted-foreground">{sug.motivo ?? "—"}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              IA não encontrou correspondência clara. Decida manualmente.
            </p>
          )}
        </div>
      </div>

      <MotivoInput motivo={motivo} onMotivo={onMotivo} />

      <div className="mt-4 flex flex-wrap gap-2">
        {sug?.viagemId && (
          <Button size="sm" onClick={() => onResolver("aceitar_sugestao")} disabled={pending}>
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

function LinhaPedagioCard({
  linha,
  motivo,
  onMotivo,
  onResolver,
  pending,
}: {
  linha: LinhaFechamento;
  motivo: string;
  onMotivo: (m: string) => void;
  onResolver: ResolverFn;
  pending: boolean;
}) {
  const praca =
    (linha.rawData as { _custom?: { praca_pedagio?: string } } | null)?._custom
      ?.praca_pedagio ?? null;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge className="border-red-200 bg-red-50 text-red-800">
          Linha {linha.ordem}
        </Badge>
        <span className="font-mono text-sm">{linha.placa}</span>
        <span className="text-sm text-muted-foreground">{fmtBR(linha.data)}</span>
        {praca && <span className="text-sm">Praça: {String(praca)}</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Cliente reportou
          </p>
          <dl className="space-y-1 text-sm">
            <Field label="Praça" value={String(praca ?? "—")} />
            <Field label="Valor" value={fmtBRL(linha.valor)} />
          </dl>
        </div>

        <div className="rounded-md border border-dashed bg-background p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Motorista lançou no app?
          </p>
          <p className="text-sm text-muted-foreground">
            Não encontrei pedágio do motorista batendo com placa + data + praça.
            Pode ser pedágio que ele esqueceu de lançar, ou cobrança indevida do
            cliente.
          </p>
        </div>
      </div>

      <MotivoInput motivo={motivo} onMotivo={onMotivo} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onResolver("erro_cliente")}
        >
          <XCircle className="h-3.5 w-3.5" /> Cobrança indevida (erro do cliente)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onResolver("erro_cliente")}
          title="Marca como resolvido — motorista esqueceu de lançar mas a cobrança procede"
        >
          <Check className="h-3.5 w-3.5" /> Aceitar cobrança (motorista esqueceu)
        </Button>
      </div>
    </Card>
  );
}

function LinhaCombustivelCard({
  linha,
  motivo,
  onMotivo,
  onResolver,
  pending,
}: {
  linha: LinhaFechamento;
  motivo: string;
  onMotivo: (m: string) => void;
  onResolver: ResolverFn;
  pending: boolean;
}) {
  const litros =
    (linha.rawData as { _custom?: { litros?: number } } | null)?._custom
      ?.litros ?? null;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge className="border-red-200 bg-red-50 text-red-800">
          Linha {linha.ordem}
        </Badge>
        <span className="font-mono text-sm">{linha.placa}</span>
        <span className="text-sm text-muted-foreground">{fmtBR(linha.data)}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Cliente reportou
          </p>
          <dl className="space-y-1 text-sm">
            <Field
              label="Litros"
              value={typeof litros === "number" ? `${litros.toFixed(2)} L` : "—"}
            />
            <Field label="Valor" value={fmtBRL(linha.valor)} />
          </dl>
        </div>

        <div className="rounded-md border border-dashed bg-background p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Motorista lançou no app?
          </p>
          <p className="text-sm text-muted-foreground">
            Não encontrei abastecimento do motorista batendo com placa + data.
            Pode ser que ele esqueceu de lançar ou os valores divergiram demais.
          </p>
        </div>
      </div>

      <MotivoInput motivo={motivo} onMotivo={onMotivo} />

      <div className="mt-4 flex flex-wrap gap-2">
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
          onClick={() => onResolver("erro_cliente")}
          title="Aceita o lançamento mesmo sem o motorista ter registrado"
        >
          <Check className="h-3.5 w-3.5" /> Aceitar (motorista esqueceu)
        </Button>
      </div>
    </Card>
  );
}

function MotivoInput({
  motivo,
  onMotivo,
}: {
  motivo: string;
  onMotivo: (m: string) => void;
}) {
  return (
    <div className="mt-4">
      <label className="text-xs text-muted-foreground">
        Motivo / observação (opcional)
      </label>
      <Input
        value={motivo}
        onChange={(e) => onMotivo(e.target.value)}
        placeholder='ex: "valor não bate por 50 centavos", "data divergente"'
        className="mt-1"
      />
    </div>
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
