import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  ChevronDown,
  Droplet,
  Fuel,
  Receipt,
  Truck,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { NotificationBell } from "@/components/notification-bell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtDataCurta, fmtMesLongo, mesISO } from "@/lib/datetime";
import {
  useAbastecimentos,
  usePedagiosFiltrados,
  useViagensFiltradas,
  type GrupoStatus,
} from "@/lib/queries";
import { fmtNum } from "@/lib/utils";
import { cn } from "@/lib/utils";

type Aba = "viagens" | "pedagios" | "abastecimentos";

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  // Nunca "destructive": o motorista não causou nem resolve o que falta.
  INCOMPLETA: "warning",
  AJUSTADA: "secondary",
};

const statusLabel: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  // O escritório é que tem algo a preencher — pro motorista é conferência normal.
  INCOMPLETA: "Conferindo",
  AJUSTADA: "Ajustada",
};

function mesAnterior(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y!, (m ?? 1) - 2, 1);
  return mesISO(d);
}

function mesPosterior(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y!, m ?? 0, 1);
  return mesISO(d);
}

export default function HistoricoPage() {
  const [aba, setAba] = useState<Aba>("viagens");
  const [mes, setMes] = useState<string>(mesISO());
  const [status, setStatus] = useState<GrupoStatus | undefined>(undefined);

  return (
    <div>
      <div className="bg-brand">
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-safe">
          <div className="flex-1 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Histórico</p>
            <p className="mt-0.5 text-2xl font-bold text-white">{fmtMesLongo(mes)}</p>
          </div>
          <div className="pt-3">
            <NotificationBell />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 pb-3">
          <button
            type="button"
            onClick={() => setMes(mesAnterior(mes))}
            className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-semibold text-white active:bg-white/25"
          >
            ← anterior
          </button>
          <button
            type="button"
            onClick={() => setMes(mesISO())}
            className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-semibold text-white active:bg-white/25"
          >
            mês atual
          </button>
          <button
            type="button"
            onClick={() => setMes(mesPosterior(mes))}
            disabled={mes >= mesISO()}
            className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-semibold text-white active:bg-white/25 disabled:opacity-40"
          >
            próximo →
          </button>
        </div>
      </div>

      <div className="sticky top-0 z-10 flex border-b border-border bg-background">
        <TabBtn label="Viagens" icon={Truck} active={aba === "viagens"} onClick={() => setAba("viagens")} />
        <TabBtn label="Pedágios" icon={Receipt} active={aba === "pedagios"} onClick={() => setAba("pedagios")} />
        <TabBtn label="Abastec." icon={Fuel} active={aba === "abastecimentos"} onClick={() => setAba("abastecimentos")} />
      </div>

      {aba === "viagens" && (
        <ViagensAba mes={mes} status={status} onStatusChange={setStatus} />
      )}
      {aba === "pedagios" && <PedagiosAba mes={mes} />}
      {aba === "abastecimentos" && <AbastecimentosAba mes={mes} />}
    </div>
  );
}

function TabBtn({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Truck;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 border-b-2 py-3 text-sm font-semibold transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
      )}
    >
      <Icon size={20} />
      {label}
    </button>
  );
}

function ViagensAba({
  mes,
  status,
  onStatusChange,
}: {
  mes: string;
  status: GrupoStatus | undefined;
  onStatusChange: (s: GrupoStatus | undefined) => void;
}) {
  const q = useViagensFiltradas({ mes, status });
  const navigate = useNavigate();
  const todas = useMemo(() => q.data?.pages.flatMap((p) => p.itens) ?? [], [q.data]);

  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <FiltroChip label="Todas" active={!status} onClick={() => onStatusChange(undefined)} />
        <FiltroChip label="Aguardando" active={status === "AGUARDANDO"} onClick={() => onStatusChange("AGUARDANDO")} />
        <FiltroChip label="Conferidas" active={status === "CONFERIDA"} onClick={() => onStatusChange("CONFERIDA")} />
        <FiltroChip label="Divergentes" active={status === "DIVERGENTE"} onClick={() => onStatusChange("DIVERGENTE")} />
      </div>

      {q.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>}

      {!q.isLoading && todas.length === 0 && (
        <EmptyState icon={Truck} title="Sem viagens no mês" description="Tente outro mês ou filtro." />
      )}

      {todas.map((v) => (
        <Card key={v.id} className="p-4">
          <button
            type="button"
            onClick={() => navigate(`/viagens/${v.id}`)}
            className="block w-full text-left active:opacity-75"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="truncate text-lg font-bold text-foreground">{v.cliente.nome}</p>
                <p className="mt-0.5 text-base font-medium text-muted-foreground tabular">
                  {fmtDataCurta(v.data)} · {v.veiculo.placa}
                </p>
              </div>
              <Badge variant={statusVariant[v.status] ?? "outline"}>
                {statusLabel[v.status] ?? v.status}
              </Badge>
            </div>

            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <ArrowUp size={16} className="text-success" />
                <span className="flex-1 truncate text-sm text-foreground">{v.localCarga.nome}</span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowDown size={16} className="text-destructive" />
                <span className="flex-1 truncate text-sm text-foreground">{v.localDescarga.nome}</span>
              </div>
            </div>

            <div className="mt-3 flex gap-5 border-t-2 border-border pt-3">
              <Mini label="t" value={fmtNum(v.toneladasEfetiva, 3)} />
              <Mini label="km" value={fmtNum(v.kmEfetivo, 2)} />
              <Mini label="ticket" value={v.ticket} />
            </div>
          </button>
        </Card>
      ))}

      {q.hasNextPage && (
        <Button
          variant="outline"
          onClick={() => q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          className="w-full"
        >
          <ChevronDown size={18} /> Carregar mais
        </Button>
      )}
    </div>
  );
}

function PedagiosAba({ mes }: { mes: string }) {
  const q = usePedagiosFiltrados({ mes });
  const todos = useMemo(() => q.data?.pages.flatMap((p) => p.itens) ?? [], [q.data]);

  return (
    <div className="space-y-3 p-4">
      {q.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>}
      {!q.isLoading && todos.length === 0 && (
        <EmptyState icon={Receipt} title="Sem pedágios no mês" />
      )}
      {todos.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="truncate text-lg font-bold text-foreground">{p.pracaPedagio}</p>
              <p className="mt-0.5 text-sm text-muted-foreground tabular">
                {fmtDataCurta(p.data)} · {p.veiculo.placa}
              </p>
            </div>
            <p className="text-xl font-extrabold text-foreground tabular">
              R$ {fmtNum(p.valor, 2)}
            </p>
          </div>
        </Card>
      ))}
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage} className="w-full">
          <ChevronDown size={18} /> Carregar mais
        </Button>
      )}
    </div>
  );
}

const COMBUSTIVEL_LABEL: Record<string, string> = {
  DIESEL_S10: "Diesel S10",
  DIESEL_S500: "Diesel S500",
  ARLA_32: "ARLA 32",
  GASOLINA: "Gasolina",
  ETANOL: "Etanol",
};

function AbastecimentosAba({ mes }: { mes: string }) {
  const q = useAbastecimentos(mes);

  return (
    <div className="space-y-3 p-4">
      {q.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando...</p>}
      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <EmptyState icon={Fuel} title="Sem abastecimentos no mês" />
      )}
      {(q.data ?? []).map((a) => (
        <Card key={a.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="flex items-center gap-2 text-base font-bold text-foreground">
                <Droplet size={16} className="text-primary" />
                {COMBUSTIVEL_LABEL[a.tipo] ?? a.tipo}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground tabular">
                {fmtDataCurta(a.data)} · {a.veiculo.placa}
              </p>
              {a.postoNome && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.postoNome}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-foreground tabular">
                {a.valorTotal ? `R$ ${fmtNum(a.valorTotal, 2)}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground tabular">
                {fmtNum(a.litros, 3)} L
              </p>
            </div>
          </div>
          <div className="mt-2 flex gap-4 border-t border-border pt-2 text-xs text-muted-foreground tabular">
            <span>Odômetro: {a.odometro.toLocaleString("pt-BR")} km</span>
            {a.tanqueCheio && <Badge variant="outline">Tanque cheio</Badge>}
            {a.emComboio && <Badge variant="warning">Comboio</Badge>}
          </div>
        </Card>
      ))}
    </div>
  );
}

function FiltroChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-base font-bold text-foreground tabular">{value}</p>
    </div>
  );
}
