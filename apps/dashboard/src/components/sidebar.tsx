"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import {
  Boxes,
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  HardHat,
  LogOut,
  MapPin,
  Package,
  Send,
  Settings,
  Truck,
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

const ITEMS: Item[] = [
  { href: "/viagens", label: "Viagens", icon: ClipboardCheck },
  { href: "/fechamentos", label: "Fechamentos", icon: FileSpreadsheet },
  { href: "/envios", label: "Envios", icon: Send },
  { href: "/motoristas", label: "Motoristas", icon: HardHat },
  { href: "/frota", label: "Frota", icon: Truck },
  { href: "/empresas", label: "Empresas-cliente", icon: Building2 },
  { href: "/obras", label: "Obras", icon: Boxes },
  { href: "/locais", label: "Locais", icon: MapPin },
  { href: "/materiais", label: "Materiais", icon: Package },
  { href: "/usuarios", label: "Usuários", icon: Users2, admin: true },
  { href: "/configuracoes/tracking", label: "Tracking GPS", icon: Settings, admin: true },
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
        <div className="mb-8 flex items-center gap-3 px-2">
          <Image
            src="/schaba-icon.png"
            alt="Schaba"
            width={40}
            height={40}
            className="shrink-0"
          />
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Schaba</h1>
            <p className="text-xs text-muted-foreground">Painel</p>
          </div>
          {/* Botão fechar (só mobile) */}
          {onMobileClose && (
            <button
              type="button"
              onClick={onMobileClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-background md:hidden"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {ITEMS.filter((i) => !i.admin || isAdmin).map(({ href, label, icon: Icon }) => {
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
