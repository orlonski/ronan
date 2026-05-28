import { Bell } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen-header";
import { ViagemCardSkeleton } from "@/components/skeleton";
import {
  useMarcarNotificacaoLida,
  useMarcarTodasNotificacoesLidas,
  useNotificacoes,
  type Notificacao,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

function fmtRelativo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

export default function NotificacoesPage() {
  const q = useNotificacoes();
  const marcarLida = useMarcarNotificacaoLida();
  const marcarTodas = useMarcarTodasNotificacoesLidas();

  const itens = useMemo(() => q.data?.pages.flatMap((p) => p.itens) ?? [], [q.data]);
  const naoLidas = q.data?.pages[0]?.naoLidas ?? 0;

  // Infinite scroll com IntersectionObserver no sentinela
  const sentinela = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinela.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) {
          void q.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]);

  function handleTap(n: Notificacao) {
    if (!n.lida) marcarLida.mutate(n.id);
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background pb-8">
      <ScreenHeader
        title="Notificações"
        right={
          naoLidas > 0 ? (
            <button
              type="button"
              onClick={() => marcarTodas.mutate()}
              className="px-2 py-2 text-sm font-semibold text-white/90 active:opacity-70"
            >
              Marcar todas
            </button>
          ) : undefined
        }
      />

      <div className="space-y-2.5 p-4 pb-16">
        {q.isLoading && (
          <>
            <ViagemCardSkeleton />
            <ViagemCardSkeleton />
          </>
        )}

        {!q.isLoading && itens.length === 0 && (
          <EmptyState
            icon={Bell}
            title="Sem notificações"
            description="Quando o admin enviar algo, aparece aqui."
          />
        )}

        {itens.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => handleTap(n)}
            className={cn(
              "block w-full rounded-2xl border-2 p-4 text-left active:opacity-75",
              n.lida ? "border-border bg-card" : "border-primary/40 bg-primary/5",
            )}
          >
            <div className="flex items-start gap-3">
              {!n.lida && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
              <div className="flex-1 min-w-0">
                <p className={cn("text-base", n.lida ? "font-semibold" : "font-extrabold", "text-foreground")}>
                  {n.titulo}
                </p>
                <p className="mt-1 text-sm text-foreground/85">{n.corpo}</p>
                <p className="mt-2 text-xs font-medium text-muted-foreground tabular">
                  {fmtRelativo(n.criadoEm)}
                </p>
              </div>
            </div>
          </button>
        ))}

        <div ref={sentinela} className="h-px" />
        {q.isFetchingNextPage && (
          <p className="py-3 text-center text-sm text-muted-foreground">Carregando mais...</p>
        )}
      </div>
    </div>
  );
}
