import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CloudOff, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { ScreenHeader } from "@/components/screen-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  type PendingAbastecimento,
  type PendingPedagio,
  type PendingViagem,
} from "@/db/dexie";
import { usePendingItens } from "@/hooks/use-pending-itens";
import {
  descartarAbastecimentoPendente,
  descartarPedagioPendente,
  descartarViagemPendente,
  drain,
  tentarNovamenteAbastecimentoPendente,
  tentarNovamentePedagioPendente,
  tentarNovamenteViagemPendente,
} from "@/lib/sync";
import { useCatalogos } from "@/lib/queries";
import { frasePorCodigo, labelDoCampo } from "@/lib/validation";
import { fmtDataCurta } from "@/lib/datetime";
import { fmtNum } from "@/lib/utils";

type CommonItem = PendingViagem | PendingPedagio | PendingAbastecimento;

export default function PendentesPage() {
  const { viagens, pedagios, abastecimentos, loading } = usePendingItens();
  const cat = useCatalogos();
  const total = viagens.length + pedagios.length + abastecimentos.length;
  const [detalhe, setDetalhe] = useState<CommonItem | null>(null);

  const lookups = useMemo(() => {
    if (!cat.data) return null;
    const v = new Map(cat.data.veiculos.map((x) => [x.id, x]));
    const o = new Map(cat.data.clientes.map((x) => [x.id, x]));
    const m = new Map(cat.data.materiais.map((x) => [x.id, x]));
    const l = new Map(cat.data.locais.map((x) => [x.id, x]));
    return { v, o, m, l };
  }, [cat.data]);

  return (
    <div className="flex min-h-screen-safe flex-col bg-background pb-8">
      <ScreenHeader title="Aguardando internet" />

      <div className="space-y-3 p-4 pb-16">
        {loading && (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>
        )}

        {!loading && total === 0 && (
          <EmptyState
            icon={CloudOff}
            title="Tudo sincronizado"
            description="Não tem nada aguardando internet."
          />
        )}

        {total > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? "item" : "itens"} aguardando envio. Toque em "Sincronizar" pra tentar enviar agora.
            </p>
            <Button onClick={() => void drain()} className="w-full">
              <RefreshCw size={18} /> Sincronizar agora
            </Button>
          </div>
        )}

        {viagens.length > 0 && (
          <SecaoTitulo titulo="Viagens" count={viagens.length} />
        )}
        {viagens.map((v) => (
          <ViagemCard
            key={v.clientId}
            item={v}
            lookups={lookups}
            onDetalhes={() => setDetalhe(v)}
          />
        ))}

        {pedagios.length > 0 && (
          <SecaoTitulo titulo="Pedágios" count={pedagios.length} />
        )}
        {pedagios.map((p) => (
          <PedagioCard key={p.clientId} item={p} onDetalhes={() => setDetalhe(p)} />
        ))}

        {abastecimentos.length > 0 && (
          <SecaoTitulo titulo="Abastecimentos" count={abastecimentos.length} />
        )}
        {abastecimentos.map((a) => (
          <AbastecimentoCard key={a.clientId} item={a} onDetalhes={() => setDetalhe(a)} />
        ))}
      </div>

      {detalhe && <DetalheModal item={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  );
}

function SecaoTitulo({ titulo, count }: { titulo: string; count: number }) {
  return (
    <p className="mt-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
      {titulo} <span className="text-foreground">({count})</span>
    </p>
  );
}

type Lookups = {
  v: Map<string, { placa: string }>;
  o: Map<string, { nome: string }>;
  m: Map<string, { nome: string }>;
  l: Map<string, { nome: string }>;
} | null;

function ViagemCard({
  item,
  lookups,
  onDetalhes,
}: {
  item: PendingViagem;
  lookups: Lookups;
  onDetalhes: () => void;
}) {
  const navigate = useNavigate();
  const p = item.payload as Record<string, string | number | undefined>;
  const placa = lookups?.v.get(String(p.veiculoId))?.placa;
  const cliente = lookups?.o.get(String(p.clienteId))?.nome;
  const material = lookups?.m.get(String(p.materialId))?.nome;
  const carga = lookups?.l.get(String(p.localCargaId))?.nome;
  const descarga = lookups?.l.get(String(p.localDescargaId))?.nome;
  const data = String(p.data ?? "");

  const temErro = item.status === "error";
  const temIssues = !!item.errorIssues && item.errorIssues.length > 0;

  function excluir() {
    if (!confirm("Apagar esta viagem pendente? Essa ação não pode ser desfeita.")) return;
    void descartarViagemPendente(item.clientId);
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="truncate text-lg font-bold text-foreground">{cliente ?? "Cliente ?"}</p>
          <p className="mt-0.5 text-base font-medium text-muted-foreground tabular">
            {fmtDataCurta(data)}{placa ? ` · ${placa}` : ""}
          </p>
        </div>
        <Badge variant="warning">
          Pendente
        </Badge>
      </div>

      <p className="mt-2 truncate text-sm text-muted-foreground">
        {material ?? "?"} · ticket {String(p.ticket ?? "")} · {String(p.toneladas ?? "")} t
      </p>
      {(carga || descarga) && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {carga ?? "carga ?"} → {descarga ?? "descarga ?"}
        </p>
      )}

      {/* Cinza e informativo SEMPRE — não existe mais card vermelho aqui. O
          motorista não é quem resolve cadastro apagado no painel nem viagem
          anterior que não fechou; dizer "erro" pra ele só faz ele desistir do
          app. O servidor aceita o lançamento e a pendência vai carimbada pro
          escritório (ver common/divergencias.ts no backend). */}
      {temErro && temIssues && (
        <div className="mt-3 space-y-1 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold text-muted-foreground">Falta preencher:</p>
          <ul className="space-y-0.5">
            {item.errorIssues!.map((issue, idx) => (
              <li key={`${issue.path}-${idx}`} className="text-xs text-muted-foreground">
                • {labelDoCampo(issue.path)}: {frasePorCodigo(issue.code, issue.message)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {temErro && !temIssues && item.errorMsg && (
        <div className="mt-3 space-y-1 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold text-muted-foreground">Última tentativa:</p>
          <p className="text-xs text-muted-foreground">{item.errorMsg}</p>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <Button variant="outline" size="sm" onClick={onDetalhes} className="w-full">
          Ver detalhes
        </Button>
        {temErro ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => navigate(`/nova-viagem/${item.clientId}`)}
            >
              <Pencil size={16} /> Editar
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => void tentarNovamenteViagemPendente(item.clientId)}
            >
              <RefreshCw size={16} /> Tentar de novo
            </Button>
          </div>
        ) : null}
        <Button variant="ghost" size="sm" onClick={excluir} className="w-full text-destructive">
          <Trash2 size={16} /> Descartar
        </Button>
      </div>
    </Card>
  );
}

function PedagioCard({ item, onDetalhes }: { item: PendingPedagio; onDetalhes: () => void }) {
  const navigate = useNavigate();
  const p = item.payload as Record<string, string | number | undefined>;
  const temErro = item.status === "error";

  function excluir() {
    if (!confirm("Apagar este pedágio pendente?")) return;
    void descartarPedagioPendente(item.clientId);
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="truncate text-lg font-bold text-foreground">
            {String(p.pracaPedagio ?? "Praça ?")}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground tabular">
            {fmtDataCurta(String(p.data ?? ""))} · R$ {fmtNum(String(p.valor ?? 0), 2)}
          </p>
        </div>
        <Badge variant="warning">
          Pendente
        </Badge>
      </div>
      {temErro && item.errorMsg && (
        <p className="mt-2 text-xs text-muted-foreground">{item.errorMsg}</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={onDetalhes} className="flex-1">
          Detalhes
        </Button>
        {/* Corrigir vem antes de "tentar": quando o erro é cadastro que sumiu,
            tentar de novo nunca passa e sem esse botão só sobrava descartar. */}
        {temErro && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => navigate(`/novo-pedagio/${item.clientId}`)}
          >
            <Pencil size={16} /> Editar
          </Button>
        )}
        {temErro && (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => void tentarNovamentePedagioPendente(item.clientId)}
          >
            <RefreshCw size={16} /> Tentar
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={excluir} className="text-destructive">
          <Trash2 size={16} />
        </Button>
      </div>
    </Card>
  );
}

function AbastecimentoCard({
  item,
  onDetalhes,
}: {
  item: PendingAbastecimento;
  onDetalhes: () => void;
}) {
  const p = item.payload as Record<string, string | number | undefined>;
  const temErro = item.status === "error";

  function excluir() {
    if (!confirm("Apagar este abastecimento pendente?")) return;
    void descartarAbastecimentoPendente(item.clientId);
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="truncate text-lg font-bold text-foreground">
            {String(p.tipo ?? "Abastecimento")}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground tabular">
            {fmtDataCurta(String(p.data ?? ""))} · {String(p.litros ?? "")} L
          </p>
        </div>
        <Badge variant="warning">
          Pendente
        </Badge>
      </div>
      {temErro && item.errorMsg && (
        <p className="mt-2 text-xs text-muted-foreground">{item.errorMsg}</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={onDetalhes} className="flex-1">
          Detalhes
        </Button>
        {temErro && (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => void tentarNovamenteAbastecimentoPendente(item.clientId)}
          >
            <RefreshCw size={16} /> Tentar
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={excluir} className="text-destructive">
          <Trash2 size={16} />
        </Button>
      </div>
    </Card>
  );
}

function DetalheModal({ item, onClose }: { item: CommonItem; onClose: () => void }) {
  const payloadJson = JSON.stringify(item.payload, null, 2);
  const temIssues = !!item.errorIssues && item.errorIssues.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 pt-safe">
        <h2 className="text-lg font-bold">Detalhes do envio</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="flex h-10 w-10 items-center justify-center rounded-full text-2xl active:bg-muted"
        >
          ×
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-safe">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Status</p>
          <p className="text-base text-foreground">
            {item.status} ·{" "}
            {item.attempts === 0
              ? "nenhuma tentativa"
              : `${item.attempts} tentativa${item.attempts === 1 ? "" : "s"}`}
            {item.errorStatus ? ` · HTTP ${item.errorStatus}` : ""}
          </p>
          {item.lastTriedAt && (
            <p className="text-xs text-muted-foreground">
              Última tentativa: {new Date(item.lastTriedAt).toLocaleString("pt-BR")}
            </p>
          )}
        </div>

        {item.errorMsg && (
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Erro do servidor</p>
            <div className="mt-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive whitespace-pre-line">{item.errorMsg}</p>
            </div>
          </div>
        )}

        {temIssues && (
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Issues (Zod)</p>
            <div className="mt-1 space-y-2">
              {item.errorIssues!.map((issue, idx) => (
                <div
                  key={`${issue.path}-${idx}`}
                  className="rounded-lg border border-border bg-muted/30 p-3"
                >
                  <p className="font-mono text-sm font-semibold">{issue.path || "(raiz)"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    code: <span className="font-mono">{issue.code}</span>
                  </p>
                  <p className="mt-0.5 text-sm">{issue.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Payload</p>
          <pre className="mt-1 max-w-full overflow-x-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs">
            {payloadJson}
          </pre>
        </div>
      </div>
    </div>
  );
}
