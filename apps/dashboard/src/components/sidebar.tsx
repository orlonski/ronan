"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpCircle,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Fuel,
  HardHat,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  MessageCircle,
  Package,
  Radio,
  Ruler,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCircle,
  Users2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/lib/permissoes";
import { Button } from "@/components/ui/button";
import { SchabaLogo } from "@/components/schaba-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // Chave de permissão (catálogo RBAC). Item só aparece se o papel tiver.
  perm: string;
};

type Grupo = {
  titulo: string;
  itens: Item[];
};

const DASHBOARD_ITEM = { href: "/", label: "Dashboard", icon: LayoutDashboard };

const GRUPOS: Grupo[] = [
  {
    titulo: "Operação",
    itens: [
      { href: "/viagens", label: "Viagens", icon: ClipboardCheck, perm: "viagens.ver" },
      { href: "/viagens-andamento", label: "Viagens em andamento", icon: Radio, perm: "viagens.ver" },
      { href: "/descargas-suspeitas", label: "Descargas suspeitas", icon: MapPin, perm: "descargas-suspeitas.ver" },
      { href: "/abastecimentos", label: "Abastecimentos", icon: Fuel, perm: "abastecimentos.ver" },
      { href: "/fechamentos", label: "Fechamentos", icon: FileSpreadsheet, perm: "fechamentos.ver" },
      { href: "/envios", label: "Envios", icon: Send, perm: "envios.ver" },
      { href: "/notificacoes", label: "Notificações", icon: Bell, perm: "notificacoes.ver" },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      { href: "/motoristas", label: "Motoristas", icon: HardHat, perm: "motoristas.ver" },
      { href: "/mapa", label: "Mapa", icon: MapPin, perm: "mapa.ver" },
      { href: "/empresas", label: "Empresas", icon: Building2, perm: "empresas.ver" },
      { href: "/clientes", label: "Clientes", icon: Boxes, perm: "clientes.ver" },
      { href: "/locais", label: "Locais", icon: MapPin, perm: "locais.ver" },
      { href: "/pedagios-rodovia", label: "Pedágios (rodovias)", icon: MapPin, perm: "pedagios.ver" },
      { href: "/materiais", label: "Materiais", icon: Package, perm: "materiais.ver" },
      { href: "/regras-minimo", label: "Mínimos por faixa", icon: Ruler, perm: "regras-minimo.ver" },
      { href: "/tipos-evento-viagem", label: "Eventos da viagem", icon: ListChecks, perm: "tipos-evento-viagem.ver" },
    ],
  },
  {
    titulo: "Sistema",
    itens: [
      { href: "/usuarios", label: "Usuários", icon: Users2, perm: "usuarios.ver" },
      { href: "/configuracoes/permissoes", label: "Papéis e permissões", icon: ShieldCheck, perm: "permissoes.gerenciar" },
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, perm: "whatsapp.ver" },
      { href: "/erros", label: "Erros", icon: AlertCircle, perm: "erros.ver" },
      { href: "/diagnosticos", label: "Diagnósticos", icon: Activity, perm: "diagnosticos.ver" },
      { href: "/configuracoes/tracking", label: "Tracking GPS", icon: Settings, perm: "config-tracking.ver" },
      { href: "/configuracoes/busca-locais", label: "Busca de locais", icon: MapPin, perm: "config-busca-locais.ver" },
      { href: "/configuracoes/ia", label: "Inteligência Artificial", icon: Sparkles, perm: "config-ia.ver" },
      { href: "/configuracoes/agente-whatsapp", label: "Agente WhatsApp", icon: MessageCircle, perm: "config-agente.ver" },
      { href: "/configuracoes/campos-layout", label: "Campos do layout", icon: Sparkles, perm: "config-campos-layout.ver" },
      { href: "/configuracoes/forca-atualizacao", label: "Força-atualização do app", icon: ArrowUpCircle, perm: "config-forca-atualizacao.ver" },
      { href: "/configuracoes/km-atipico", label: "Km atípico", icon: Ruler, perm: "config-km-atipico.ver" },
    ],
  },
];

/**
 * Item do menu está ativo? Prefixo cru não serve: `/viagens-andamento` começa
 * com `/viagens`, então "Viagens" acendia junto de "Viagens em andamento".
 * Ativo é a rota exata ou algo abaixo dela (`/viagens/123`).
 */
export function isRotaAtiva(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { temPermissao, papelNome } = usePermissoes();

  // Itens visíveis por permissão; grupo só aparece se sobrar algum item.
  const gruposVisiveis = GRUPOS.map((g) => ({
    ...g,
    itens: g.itens.filter((i) => temPermissao(i.perm)),
  })).filter((g) => g.itens.length > 0);

  // Accordion: só um grupo aberto por vez. Operação é o default ao abrir
  // a plataforma. Ao mudar de rota, abre o grupo correspondente.

  const [grupoAberto, setGrupoAberto] = useState<string>("Operação");

  function toggleGrupo(titulo: string) {
    setGrupoAberto((prev) => (prev === titulo ? "" : titulo));
  }

  // Se a rota atual pertence a outro grupo, abre esse grupo
  useEffect(() => {
    for (const grupo of GRUPOS) {
      if (grupo.itens.some((i) => isRotaAtiva(pathname, i.href))) {
        if (grupoAberto !== grupo.titulo) setGrupoAberto(grupo.titulo);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Fecha gaveta automaticamente quando muda de rota no mobile
  useEffect(() => {
    onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      {/* Backdrop mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground px-4 py-6",
          "fixed inset-y-0 left-0 transform transition-transform",
          "md:relative md:translate-x-0",
          mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="mb-4 flex items-center px-2">
          <SchabaLogo width={160} className="shrink-0 text-sidebar-foreground" />
          {/* Botão fechar (só mobile) */}
          {onMobileClose && (
            <button
              type="button"
              onClick={onMobileClose}
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:hidden"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto">
          {/* Dashboard fora dos grupos — sempre visível */}
          {(() => {
            const Icon = DASHBOARD_ITEM.icon;
            const active = pathname === DASHBOARD_ITEM.href;
            return (
              <Link
                href={DASHBOARD_ITEM.href as any}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {DASHBOARD_ITEM.label}
              </Link>
            );
          })()}

          {gruposVisiveis.map((grupo) => {
            const aberto = grupoAberto === grupo.titulo;
            return (
              <div key={grupo.titulo} className="space-y-1">
                <button
                  type="button"
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
                  grupo.itens.map(({ href, label, icon: Icon }) => {
                    const active = isRotaAtiva(pathname, href);
                    return (
                      <Link
                        key={href}
                        href={href as any}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-sidebar-border pt-4">
          <ThemeSwitcher />
          <div className="flex items-center gap-2 px-2 text-sm">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{session?.user?.name ?? "—"}</p>
              <p className="truncate text-xs text-muted-foreground">{papelNome ?? "—"}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </aside>
    </>
  );
}
