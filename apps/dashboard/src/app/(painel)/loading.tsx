/**
 * O que aparece no miolo do painel entre o clique no menu e a tela nova.
 *
 * Sem este arquivo o Next segura a tela ANTIGA, parada e sem sinal nenhum,
 * até o servidor responder — e o servidor fica na Europa, então isso é meio
 * segundo a quase dois a cada troca de menu. Com ele a troca é instantânea:
 * o menu marca o item novo na hora e o esqueleto ocupa o lugar até a tela
 * chegar. O shell (menu lateral e topo) fica de fora — é do layout.
 */
export default function CarregandoTela() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Carregando…</span>
      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted/60" />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="h-9 w-64 max-w-full animate-pulse rounded-md bg-muted/60" />
        <div className="h-9 w-36 animate-pulse rounded-md bg-muted/60" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="h-10 animate-pulse bg-muted/50" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-t px-4 py-3">
            <div className="h-4 w-1/4 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted/40" />
            <div className="h-4 w-1/6 animate-pulse rounded bg-muted/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
