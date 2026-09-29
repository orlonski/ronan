"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LogOut, Search, UserCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/lib/permissoes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContaSwitcher } from "@/components/conta-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { limparMarca } from "@/lib/marca-conta";
import { itemAtivo, normalizarBusca, useMenuVisivel, type ItemVisivel } from "@/lib/menu";

/**
 * A folha "Mais" do celular: TODAS as telas que a pessoa pode ver, com busca.
 * É a única forma de navegar além da barra inferior (a gaveta lateral acabou).
 *
 * A lista vem de useMenuVisivel() — a mesma da sidebar do desktop, então o que
 * um esconde o outro esconde. Tema, empresa (só plataforma) e Sair moram aqui
 * porque o cabeçalho do celular é enxuto.
 *
 * Só existe abaixo de 768px (`md:hidden`); se a janela crescer com ela aberta,
 * fecha — o Radix bloqueia o clique no resto da página enquanto está aberta.
 */
export function FolhaMais({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { papelNome, plataforma } = usePermissoes();
  const { topo, grupos } = useMenuVisivel();
  const [busca, setBusca] = useState("");

  // Fecha ao navegar e zera a busca: a folha reaberta começa limpa.
  useEffect(() => {
    onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  useEffect(() => {
    if (!open) setBusca("");
  }, [open]);
  // A altura é FIXA de propósito: se a folha encolhesse ao filtrar, a busca
  // desceria e o teclado do iPhone (que não redimensiona a página) a cobriria.

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const aoMudar = () => mq.matches && onOpenChange(false);
    mq.addEventListener("change", aoMudar);
    return () => mq.removeEventListener("change", aoMudar);
  }, [open, onOpenChange]);

  const termo = normalizarBusca(busca);
  const casa = (i: ItemVisivel) => !termo || normalizarBusca(i.label).includes(termo);
  const topoFiltrado = useMemo(() => topo.filter(casa), [topo, termo]); // eslint-disable-line react-hooks/exhaustive-deps
  // Buscar pelo nome do grupo ("dinheiro") traz o grupo inteiro.
  const gruposFiltrados = useMemo(
    () =>
      grupos
        .map((g) => ({ ...g, itens: termo && normalizarBusca(g.titulo).includes(termo) ? g.itens : g.itens.filter(casa) }))
        .filter((g) => g.itens.length > 0),
    [grupos, termo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nada = topoFiltrado.length === 0 && gruposFiltrados.length === 0;

  // Arrastar a alça pra baixo fecha (gesto de folha de app). Só a alça: o resto rola.
  const [arrasto, setArrasto] = useState(0);
  const inicio = useRef<number | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Sem isto o Radix foca a busca ao abrir e o teclado do celular sobe
          // por cima da lista antes de a pessoa ter escolhido digitar.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          style={arrasto > 0 ? { transform: `translateY(${arrasto}px)`, transition: "none" } : undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col rounded-t-2xl border-t bg-background shadow-xl md:hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          )}
        >
          <div
            className="flex shrink-0 touch-none justify-center pb-1 pt-2"
            onPointerDown={(e) => {
              inicio.current = e.clientY;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (inicio.current != null) setArrasto(Math.max(0, e.clientY - inicio.current));
            }}
            onPointerUp={() => {
              const passou = arrasto > 90;
              inicio.current = null;
              setArrasto(0);
              if (passou) onOpenChange(false);
            }}
            onPointerCancel={() => {
              inicio.current = null;
              setArrasto(0);
            }}
          >
            <span className="h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          </div>

          <div className="flex shrink-0 items-center gap-2 px-4 pb-3">
            <DialogPrimitive.Title className="sr-only">Todas as telas</DialogPrimitive.Title>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar tela"
                aria-label="Buscar tela"
                enterKeyHint="search"
                autoComplete="off"
                className="pl-9"
              />
            </div>
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {!termo && (
              <div className="px-2">
                {/* Empresa: só a equipe da plataforma vê (o componente se esconde sozinho). */}
                <ContaSwitcher />
              </div>
            )}

            {topoFiltrado.map((item) => (
              <LinhaDeTela key={item.href} item={item} pathname={pathname} onIr={() => onOpenChange(false)} />
            ))}

            {gruposFiltrados.map((g) => (
              <section key={g.titulo} className="mt-2">
                <h2 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.titulo}
                </h2>
                {g.itens.map((item) => (
                  <LinhaDeTela key={item.base} item={item} pathname={pathname} onIr={() => onOpenChange(false)} />
                ))}
              </section>
            ))}

            {nada && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nenhuma tela com esse nome.
              </p>
            )}
          </div>

          {/* Conta da pessoa: tema, quem é e Sair. Some enquanto se busca, pra a lista ter o espaço. */}
          {!termo && (
            <div className="shrink-0 space-y-2 border-t px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
              <div className="flex items-center gap-2">
                <UserCircle className="h-6 w-6 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{session?.user?.name ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {plataforma ? "Super administrador" : (papelNome ?? "—")}
                  </p>
                </div>
                <span className="[&>button]:min-h-11 [&>button]:min-w-11 [&>button]:justify-center">
                  <ThemeSwitcher compact />
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    limparMarca();
                    void signOut({ callbackUrl: "/login" });
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </Button>
              </div>
            </div>
          )}
          {termo && <div className="h-safe-bottom shrink-0" />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LinhaDeTela({ item, pathname, onIr }: { item: ItemVisivel; pathname: string; onIr: () => void }) {
  const Icon = item.icon;
  const ativo = itemAtivo(pathname, item);
  return (
    <Link
      href={item.href as any}
      onClick={onIr}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-md px-3 text-base transition-colors active:bg-muted",
        ativo ? "bg-muted font-medium text-foreground" : "text-foreground/80",
      )}
    >
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}
