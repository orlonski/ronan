"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; admin?: boolean };

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

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.perfil === "ADMIN";

  return (
    <aside className="flex w-64 flex-col border-r bg-muted/30 px-4 py-6">
      <div className="mb-8 px-2">
        <h1 className="text-xl font-semibold tracking-tight">Schaba</h1>
        <p className="text-xs text-muted-foreground">Painel</p>
      </div>

      <nav className="flex-1 space-y-1">
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
  );
}
