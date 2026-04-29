import { Link, useLocation } from "react-router-dom";
import { Home, Plus, UserCircle, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      {!online && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          <WifiOff className="mr-1 inline h-3.5 w-3.5" /> Sem conexão. Lançamentos serão sincronizados depois.
        </div>
      )}
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>
      <BottomNav />
      <div className="fixed right-3 top-3 z-10">
        {online ? (
          <Wifi className="h-4 w-4 text-green-600" />
        ) : (
          <WifiOff className="h-4 w-4 text-amber-600" />
        )}
      </div>
    </div>
  );
}

function BottomNav() {
  const { pathname } = useLocation();
  const items = [
    { href: "/", label: "Início", icon: Home },
    { href: "/nova-viagem", label: "Nova viagem", icon: Plus, primary: true },
    { href: "/perfil", label: "Perfil", icon: UserCircle },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {items.map(({ href, label, icon: Icon, primary }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              to={href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-xs",
                primary && "rounded-full bg-primary px-4 py-2 text-primary-foreground",
                !primary && active && "text-foreground",
                !primary && !active && "text-muted-foreground",
              )}
            >
              <Icon className={primary ? "h-6 w-6" : "h-5 w-5"} />
              <span className={primary ? "text-sm font-medium" : ""}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
