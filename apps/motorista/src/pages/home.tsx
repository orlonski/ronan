import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CloudUpload, Clock, Receipt, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMe, usePedagios, useViagens } from "@/lib/queries";
import { formatBR, formatBRL, formatNumber } from "@/lib/utils";
import { usePendingPedagios, usePendingViagens } from "@/hooks/use-pending";
import { useOnline } from "@/hooks/use-online";
import { drain } from "@/lib/sync";

export default function HomePage() {
  const me = useMe();
  const viagens = useViagens();
  const pedagios = usePedagios();
  const pendingViagens = usePendingViagens();
  const pendingPedagios = usePendingPedagios();
  const online = useOnline();
  const totalPending = pendingViagens.length + pendingPedagios.length;

  return (
    <div className="mx-auto max-w-md space-y-5 p-4">
      <header className="space-y-1 pt-2">
        <p className="text-sm text-muted-foreground">Olá,</p>
        <h1 className="text-2xl font-semibold tracking-tight">{me.data?.nome ?? "—"}</h1>
        {me.data?.veiculoDefault && (
          <p className="text-sm text-muted-foreground">
            Placa padrão: <span className="font-mono">{me.data.veiculoDefault.placa}</span>
          </p>
        )}
      </header>

      {totalPending > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-amber-700" />
              <span className="font-medium text-amber-900">
                {totalPending} {totalPending === 1 ? "lançamento aguardando" : "lançamentos aguardando"} envio
              </span>
            </div>
            {online && (
              <Button size="sm" variant="ghost" onClick={() => void drain()}>
                <CloudUpload className="h-4 w-4" /> Sincronizar
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to="/nova-viagem" className="rounded-xl bg-primary p-4 text-primary-foreground shadow active:scale-[0.99]">
          <Truck className="h-6 w-6" />
          <p className="mt-2 text-base font-medium">Nova viagem</p>
          <p className="text-xs opacity-80">Lançar carga/descarga</p>
        </Link>
        <Link to="/novo-pedagio" className="rounded-xl border bg-background p-4 shadow-sm active:scale-[0.99]">
          <Receipt className="h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-base font-medium">Pedágio</p>
          <p className="text-xs text-muted-foreground">Praça, valor</p>
        </Link>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Últimas viagens</h2>
        <div className="space-y-2">
          {pendingViagens.map((p) => {
            return (
              <article
                key={p.clientId}
                className="rounded-lg border border-amber-200 bg-amber-50/40 p-3"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono">— pendente —</span>
                  <span className="text-xs text-amber-700">
                    {p.status === "syncing" ? "enviando..." : p.status === "error" ? `erro · ${p.attempts}x` : "aguardando rede"}
                  </span>
                </div>
                <p className="mt-1 text-sm">
                  Ticket {String(p.payload.ticket)} · {formatNumber(Number(p.payload.toneladas), 3)} t
                </p>
                {!!p.fotoBlob && (
                  <p className="mt-1 text-xs text-muted-foreground">📷 com foto local</p>
                )}
              </article>
            );
          })}

          {viagens.isLoading && pendingViagens.length === 0 && <SkeletonRow />}
          {viagens.data?.length === 0 && pendingViagens.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhuma viagem lançada ainda.
            </p>
          )}
          {viagens.data?.map((v) => (
            <article key={v.id} className="rounded-lg border bg-background p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono">{v.veiculo.placa}</span>
                <span className="text-muted-foreground">{formatBR(v.data)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <p className="font-medium">{v.material.nome}</p>
                <p className="text-sm">
                  {formatNumber(v.toneladas, 3)} t · ticket {v.ticket}
                </p>
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <ArrowUp className="h-3 w-3" /> {v.localCarga.nome} ({v.localCarga.cidade}/{v.localCarga.uf})
                </div>
                <div className="flex items-center gap-1">
                  <ArrowDown className="h-3 w-3" /> {v.localDescarga.nome} ({v.localDescarga.cidade}/{v.localDescarga.uf})
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {(pendingPedagios.length > 0 || (pedagios.data && pedagios.data.length > 0)) && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Últimos pedágios</h2>
          <div className="space-y-2">
            {pendingPedagios.map((p) => (
              <article
                key={p.clientId}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{String(p.payload.pracaPedagio)}</p>
                  <p className="text-xs text-amber-700">
                    {p.status === "syncing" ? "enviando..." : "aguardando rede"}
                  </p>
                </div>
                <span className="font-mono">{formatBRL(Number(p.payload.valor))}</span>
              </article>
            ))}
            {pedagios.data?.slice(0, 5).map((p) => (
              <article key={p.id} className="flex items-center justify-between rounded-lg border bg-background p-3 text-sm">
                <div>
                  <p className="font-medium">{p.pracaPedagio}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.veiculo.placa} · {formatBR(p.data)}
                  </p>
                </div>
                <span className="font-mono">{formatBRL(p.valor)}</span>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SkeletonRow() {
  return <div className="h-20 animate-pulse rounded-lg border bg-muted/30" />;
}
