import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNaoLidas } from "@/lib/queries";

export function NotificationBell() {
  const count = useNaoLidas();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate("/notificacoes")}
      aria-label={count > 0 ? `Notificações: ${count} não lidas` : "Notificações"}
      className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
    >
      <Bell size={22} color="white" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-extrabold text-white tabular">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
