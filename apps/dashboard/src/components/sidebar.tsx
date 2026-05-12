"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Fuel,
  HardHat,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageCircle,
  Package,
  Send,
  Settings,
  Sparkles,
  UserCircle,
  Users2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  admin?: boolean;
};

type Grupo = {
  titulo: string;
  itens: Item[];
  // Se admin = true, grupo inteiro só aparece pra admin
  admin?: boolean;
};

const DASHBOARD_ITEM: Item = { href: "/", label: "Dashboard", icon: LayoutDashboard };

const GRUPOS: Grupo[] = [
  {
    titulo: "Operação",
    itens: [
      { href: "/viagens", label: "Viagens", icon: ClipboardCheck },
      { href: "/abastecimentos", label: "Abastecimentos", icon: Fuel },
      { href: "/fechamentos", label: "Fechamentos", icon: FileSpreadsheet },
      { href: "/envios", label: "Envios", icon: Send },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      { href: "/motoristas", label: "Motoristas", icon: HardHat },
      { href: "/empresas", label: "Empresas-cliente", icon: Building2 },
      { href: "/obras", label: "Obras", icon: Boxes },
      { href: "/locais", label: "Locais", icon: MapPin },
      { href: "/materiais", label: "Materiais", icon: Package },
    ],
  },
  {
    titulo: "Sistema",
    admin: true,
    itens: [
      { href: "/usuarios", label: "Usuários", icon: Users2 },
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { href: "/erros", label: "Erros", icon: AlertCircle },
      { href: "/configuracoes/tracking", label: "Tracking GPS", icon: Settings },
      { href: "/configuracoes/ia", label: "Inteligência Artificial", icon: Sparkles },
      { href: "/configuracoes/agente-whatsapp", label: "Agente WhatsApp", icon: MessageCircle },
      { href: "/configuracoes/campos-layout", label: "Campos do layout", icon: Sparkles },
    ],
  },
];

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.perfil === "ADMIN";

  // Accordion: só um grupo aberto por vez. Operação é o default ao abrir
  // a plataforma. Ao mudar de rota, abre o grupo correspondente.
  const [grupoAberto, setGrupoAberto] = useState<string>("Operação");

  function toggleGrupo(titulo: string) {
    setGrupoAberto((prev) => (prev === titulo ? "" : titulo));
  }

  // Se a rota atual pertence a outro grupo, abre esse grupo
  useEffect(() => {
    for (const grupo of GRUPOS) {
      if (grupo.itens.some((i) => pathname.startsWith(i.href))) {
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
          // Desktop: fixa, fundo cinza-claro
          "z-50 flex w-64 flex-col border-r px-4 py-6",
          "md:bg-muted/30",
          // Mobile: gaveta com slide. Fundo SÓLIDO branco pra não vazar
          // o conteúdo de trás.
          "fixed inset-y-0 left-0 bg-background transform transition-transform",
          "md:relative md:translate-x-0",
          mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="mb-4 flex items-center px-2">
          <Image
            src="/schaba-logo.png"
            alt="Schaba"
            width={1642}
            height={614}
            className="h-auto w-40 shrink-0"
          />
          {/* Botão fechar (só mobile) */}
          {onMobileClose && (
            <button
              type="button"
              onClick={onMobileClose}
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-background md:hidden"
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
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {DASHBOARD_ITEM.label}
              </Link>
            );
          })()}

          {GRUPOS.filter((g) => !g.admin || isAdmin).map((grupo) => {
            const aberto = grupoAberto === grupo.titulo;
            return (
              <div key={grupo.titulo} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGrupo(grupo.titulo)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:bg-background hover:text-muted-foreground"
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
                    const active = pathname.startsWith(href);
                    return (
                      <Link
                        key={href}
                        href={href as any}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                          active
                            ? "bg-background font-medium shadow-sm"
                            : "text-muted-foreground hover:bg-background hover:text-foreground",
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

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center gap-2 px-2 text-sm">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{session?.user?.name ?? "—"}</p>
              <p className="truncate text-xs text-muted-foreground">{session?.user?.perfil}</p>
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
