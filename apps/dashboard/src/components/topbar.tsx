"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import {
  Bell,
  Camera,
  ClipboardCheck,
  MapPin,
  PiggyBank,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type AdminNotificacao,
  useInboxContagem,
  useInboxLista,
  useMarcarLida,
  useMarcarTodasLidas,
} from "@/lib/inbox";

/**
 * Sininho no topo do dashboard. Mostra badge com contagem de não-lidas,
 * dropdown com as últimas 10 notificações e atalho pra página completa.
 *
 * Tempo real: o SSE (hook useInboxStream montado em PainelShell) invalida
 * as queries assim que evento novo chega, então o badge atualiza sozinho.
 */
export function Topbar() {
  const [open, setOpen] = useState(false);
  const contagem = useInboxContagem();
  const lista = useInboxLista();
  const marcarLida = useMarcarLida();
  const marcarTodas = useMarcarTodasLidas();
  const router = useRouter();

  const naoLidas = contagem.data?.naoLidas ?? 0;
  const itens = lista.data?.pages.flatMap((p) => p.itens).slice(0, 10) ?? [];

  function aoClicarItem(n: AdminNotificacao): void {
    if (!n.lida) marcarLida.mutate(n.id);
    const destino = rotaParaNotificacao(n);
    if (destino) router.push(destino as Route);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative rounded-md p-2 text-foreground hover:bg-muted"
          aria-label="Notificações"
        >
          <Bell className="h-5 w-5" />
          {naoLidas > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
              aria-label={`${naoLidas} não lidas`}
            >
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          {naoLidas > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => marcarTodas.mutate()}
              disabled={marcarTodas.isPending}
              className="h-7 text-xs"
            >
              Marcar todas lidas
            </Button>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {lista.isLoading && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          )}
          {!lista.isLoading && itens.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Bell className="mx-auto mb-2 h-6 w-6 opacity-50" />
              Nenhuma notificação ainda.
            </div>
          )}
          {itens.map((n) => (
            <ItemNotificacao key={n.id} n={n} onClick={() => aoClicarItem(n)} />
          ))}
        </div>

        <div className="border-t p-2">
          <Link
            href={"/inbox" as Route}
            onClick={() => setOpen(false)}
            className="block rounded p-2 text-center text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ItemNotificacao({
  n,
  onClick,
}: {
  n: AdminNotificacao;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60 ${
        n.lida ? "" : "bg-blue-50/40 dark:bg-blue-950/30"
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <IconeTipo tipo={n.tipo} />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="line-clamp-1 text-sm font-medium">{n.titulo}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{n.corpo}</p>
        <p className="text-[10px] text-muted-foreground">
          {tempoRelativo(n.criadoEm)}
        </p>
      </div>
      {!n.lida && (
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600"
          aria-label="Não lida"
        />
      )}
    </button>
  );
}

export function IconeTipo({ tipo }: { tipo: string }) {
  const cls = "h-4 w-4";
  if (tipo === "nova-viagem")
    return <ClipboardCheck className={`${cls} text-blue-600`} />;
  if (tipo === "resposta-divergencia-pedagio")
    return <PiggyBank className={`${cls} text-orange-600`} />;
  if (tipo === "resposta-divergencia-foto")
    return <Camera className={`${cls} text-orange-600`} />;
  if (tipo === "foto-anexada")
    return <Camera className={`${cls} text-emerald-600`} />;
  if (tipo === "local-em-validacao")
    return <MapPin className={`${cls} text-violet-600`} />;
  if (tipo === "motorista-cadastro")
    return <UserPlus className={`${cls} text-blue-600`} />;
  return <Bell className={`${cls} text-muted-foreground`} />;
}

export function tempoRelativo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seg = Math.floor(ms / 1000);
  if (seg < 60) return "agora";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Mapeia tipo da notificação pra rota relevante no dashboard.
 * Click no item leva o admin direto pro contexto da ação.
 */
export function rotaParaNotificacao(n: AdminNotificacao): string | null {
  const dados = n.dados ?? {};
  if (n.tipo === "nova-viagem" && dados.viagemId) {
    return `/viagens/${dados.viagemId}`;
  }
  if (n.tipo === "resposta-divergencia-pedagio" && dados.viagemId) {
    return `/viagens/${dados.viagemId}`;
  }
  if (n.tipo === "resposta-divergencia-foto" && dados.viagemId) {
    return `/viagens/${dados.viagemId}`;
  }
  if (n.tipo === "foto-anexada" && dados.viagemId) {
    return `/viagens/${dados.viagemId}`;
  }
  if (n.tipo === "local-em-validacao") {
    return `/locais/em-validacao`;
  }
  if (n.tipo === "motorista-cadastro") {
    return `/motoristas?status=PENDENTE_APROVACAO`;
  }
  return null;
}
