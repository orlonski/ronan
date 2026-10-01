"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, LogOut, Pin, PinOff, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/lib/permissoes";
import { Button } from "@/components/ui/button";
import { ContaSwitcher } from "@/components/conta-switcher";
import { LogoConta } from "@/components/logo-conta";
import { limparMarca, useMarcaConta } from "@/lib/marca-conta";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ID_MENU_LATERAL } from "@/components/menu-lateral";
import { fixarMenu, soltarMenu, useGavetaAberta } from "@/lib/menu-lateral";
import { COMECAR_ITEM, GRUPOS, isRotaAtiva, itemAtivo, useMenuVisivel } from "@/lib/menu";

/**
 * Menu lateral do DESKTOP (a partir de 768px). No celular a navegação é a barra
 * inferior + a folha "Mais" (bottom-nav.tsx / folha-mais.tsx); esta coluna nem
 * é desenhada lá. A lista de telas e o filtro de acesso moram em lib/menu.ts.
 *
 * Três modos, escolhidos só por CSS (globals.css, bloco "Menu recolhido"):
 *  - 1536px+: coluna fixa de sempre (nada muda, com ou sem preferência);
 *  - 768–1535px, menu FIXO (`html[data-menu="fixo"]`): a mesma coluna fixa;
 *  - 768–1535px, menu RECOLHIDO (o padrão): este MESMO <aside> vira uma gaveta que
 *    desliza pela esquerda, aberta pelo hambúrguer do cabeçalho (menu-lateral.tsx).
 * Um elemento só: itens, tooltips, ContaSwitcher, tema e Sair são os mesmos nos três.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { papelNome, plataforma } = usePermissoes();
  const { marca } = useMarcaConta();

  // Mesmo menu que a folha "Mais" do celular mostra: uma regra só.
  const { topo, grupos: gruposVisiveis } = useMenuVisivel();

  // Accordion: só um grupo aberto por vez. "Dia a dia" é o default ao abrir o
  // painel — é o que a operação usa primeiro. Ao mudar de rota, abre o grupo
  // correspondente.
  const [grupoAberto, setGrupoAberto] = useState<string>("Dia a dia");
  const gavetaAberta = useGavetaAberta();
  const asideRef = useRef<HTMLElement>(null);

  // Gaveta recém-aberta: leva o foco pro menu (teclado e leitor de tela). Só vale quando o
  // <aside> está de fato como gaveta (fixed); na coluna fixa o estado "aberta" nunca é setado.
  useEffect(() => {
    if (!gavetaAberta) return;
    const aside = asideRef.current;
    if (aside && getComputedStyle(aside).position === "fixed") {
      aside.querySelector<HTMLElement>("nav a, nav button")?.focus();
    }
  }, [gavetaAberta]);

  // Tab não escapa da gaveta pra página que está escurecida atrás dela.
  function prenderFoco(e: React.KeyboardEvent<HTMLElement>) {
    const aside = asideRef.current;
    if (e.key !== "Tab" || !aside || !gavetaAberta || getComputedStyle(aside).position !== "fixed") return;
    const focaveis = Array.from(
      aside.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"),
    ).filter((el) => el.getBoundingClientRect().width > 0);
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (!primeiro || !ultimo) return;
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  function toggleGrupo(titulo: string) {
    setGrupoAberto((prev) => (prev === titulo ? "" : titulo));
  }

  // Se a rota atual pertence a outro grupo, abre esse grupo
  useEffect(() => {
    for (const grupo of GRUPOS) {
      if (grupo.itens.some((i) => itemAtivo(pathname, i))) {
        if (grupoAberto !== grupo.titulo) setGrupoAberto(grupo.titulo);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
      <aside
        ref={asideRef}
        id={ID_MENU_LATERAL}
        aria-label="Menu principal"
        data-aberto={gavetaAberta ? "true" : "false"}
        onKeyDown={prenderFoco}
        className={cn(
          "menu-lateral relative z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground px-4 py-6",
          // Celular: sem coluna lateral (a navegação é a barra inferior + folha).
          "max-md:hidden",
        )}
      >
        <div className="mb-1 flex items-center px-2">
          <LogoConta width={160} className="shrink-0 text-sidebar-foreground" />
        </div>

        {/* Trocar de empresa: só a equipe da plataforma vê (o componente se
            esconde sozinho). Fica encostado na logo porque é ela que ele troca. */}
        <ContaSwitcher />

        {/* De qual empresa é o que está na tela. Com mais de uma no ar, saber
            onde você está deixa de ser detalhe. Some quando há logo: a logo já
            identifica a empresa, repetir o nome embaixo é redundante. E some
            também pra quem tem o seletor acima, que já diz o nome com todas as
            letras. */}
        {/* Mesma marca lembrada do logo: sem isso o nome aparecia do nada um
            segundo depois e empurrava o menu pra baixo. */}
        {!marca?.logoUrl && !plataforma && (
          <div className="mb-4 h-4 px-2 text-xs font-medium text-muted-foreground">
            {marca?.nome ?? ""}
          </div>
        )}

        <nav className="flex-1 space-y-2 overflow-y-auto">
          {/* Itens soltos acima dos grupos (Dashboard, Começar e Relatórios):
              sempre à vista, sem custar um clique no accordion. */}
          {topo.map((item) => {
            const Icon = item.icon;
            const active = isRotaAtiva(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href as any}
                aria-current={active ? "page" : undefined}
                // Âncora do passo a passo. Fica num item SOLTO de propósito:
                // dentro de grupo do accordion, o alvo mede 0x0 quando o grupo
                // está fechado, e o furo sairia no canto da tela.
                data-coach={item.href === COMECAR_ITEM.href ? "comecar" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}

          {gruposVisiveis.map((grupo) => {
            const aberto = grupoAberto === grupo.titulo;
            return (
              <div key={grupo.titulo} className="space-y-1">
                <button
                  type="button"
                  // O cabeçalho do grupo é medível mesmo fechado — por isso o
                  // tour aponta pra ele, e não pro item lá dentro.
                  //
                  // A chave é declarada no grupo, não derivada do título: o
                  // título tem acento ("Lançamentos") e pode ser renomeado, e
                  // nos dois casos o alvo do tour deixaria de casar EM SILÊNCIO.
                  data-coach={grupo.coach}
                  onClick={() => toggleGrupo(grupo.titulo)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-muted-foreground"
                >
                  <span>{grupo.titulo}</span>
                  {aberto ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                {aberto &&
                  grupo.itens.map(({ href, label, icon: Icon, secao, ou }, i) => {
                    const active = itemAtivo(pathname, { href, ou });
                    /**
                     * O rótulo da seção sai no PRIMEIRO item dela que
                     * sobreviveu ao filtro de permissão.
                     *
                     * ⚠️ Por isso a comparação é com o item anterior da lista
                     * JÁ FILTRADA, e não com a declaração: quando a pessoa não
                     * tem nenhuma chave da seção, o rótulo simplesmente não
                     * chega a existir. Renderizar pela declaração deixaria um
                     * título de seção sobre o vazio.
                     */
                    const abreSecao = secao != null && secao !== grupo.itens[i - 1]?.secao;
                    return (
                      <Fragment key={href}>
                        {abreSecao && (
                          <p className="mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                            {secao}
                          </p>
                        )}
                        <Link
                          href={href as any}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {label}
                        </Link>
                      </Fragment>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-sidebar-border pt-4">
          <ThemeSwitcher />
          {/* Só existe na faixa 768–1535px (CSS). Os DOIS botões ficam no DOM e o CSS mostra
              o que cabe pelo `data-menu` do <html>: assim o rótulo já nasce certo, sem depender
              do React hidratar (o menu fixo não pode piscar "Fixar" antes de virar "Soltar"). */}
          <Button
            variant="ghost"
            size="sm"
            className="menu-fixar hidden w-full justify-start gap-2"
            onClick={fixarMenu}
          >
            <Pin className="h-4 w-4" />
            Fixar menu
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="menu-soltar hidden w-full justify-start gap-2"
            onClick={soltarMenu}
          >
            <PinOff className="h-4 w-4" />
            Soltar menu
          </Button>
          <div className="flex items-center gap-2 px-2 text-sm">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{session?.user?.name ?? "—"}</p>
              {/* Quem opera a plataforma é outro nível, não um papel da matriz —
                  por isso aparece por cima do papel, e não como um deles. */}
              <p className="truncate text-xs text-muted-foreground">
                {plataforma ? "Super administrador" : (papelNome ?? "—")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => {
              limparMarca();
              void signOut({ callbackUrl: "/login" });
            }}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </aside>
  );
}
