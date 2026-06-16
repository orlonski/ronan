"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { Bell, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  IconeTipo,
  rotaParaNotificacao,
  tempoRelativo,
} from "@/components/topbar";
import {
  type AdminNotificacao,
  useInboxLista,
  useMarcarLida,
  useMarcarTodasLidas,
} from "@/lib/inbox";

const TIPO_LABEL: Record<string, string> = {
  "nova-viagem": "Nova viagem",
  "resposta-divergencia-pedagio": "Resposta de pedágio",
  "resposta-divergencia-foto": "Resposta de foto",
  "foto-anexada": "Foto anexada",
  "local-em-validacao": "Local em validação",
  "motorista-cadastro": "Novo cadastro",
};

export default function InboxPage() {
  const [somenteNaoLidas, setSomenteNaoLidas] = useState(false);
  const [tipo, setTipo] = useState<string | undefined>();
  const lista = useInboxLista({ somenteNaoLidas });
  const marcarLida = useMarcarLida();
  const marcarTodas = useMarcarTodasLidas();

  const todos = lista.data?.pages.flatMap((p) => p.itens) ?? [];
  const filtrados = tipo ? todos.filter((n) => n.tipo === tipo) : todos;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Caixa de notificações
          </h1>
          <p className="text-sm text-muted-foreground">
            Eventos do sistema enviados pra você: viagens novas, respostas de
            divergência, locais a validar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            value={tipo}
            onChange={(v) => setTipo(v)}
            placeholder="Tipo"
            showSearch={false}
            options={Object.entries(TIPO_LABEL).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={somenteNaoLidas}
              onChange={(e) => setSomenteNaoLidas(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-blue-600"
            />
            <span className="select-none">Só não lidas</span>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => marcarTodas.mutate()}
            disabled={marcarTodas.isPending}
          >
            Marcar todas lidas
          </Button>
        </div>
      </header>

      <div className="space-y-3">
        {lista.isLoading && (
          <Card className="p-6 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </Card>
        )}
        {!lista.isLoading && filtrados.length === 0 && (
          <Card className="p-12 text-center text-sm text-muted-foreground">
            <Bell className="mx-auto mb-2 h-6 w-6 opacity-50" />
            Nenhuma notificação{somenteNaoLidas ? " não lida" : ""}.
          </Card>
        )}
        {filtrados.map((n) => (
          <ItemInbox
            key={n.id}
            n={n}
            onMarcarLida={() => marcarLida.mutate(n.id)}
          />
        ))}
      </div>

      {lista.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void lista.fetchNextPage()}
            disabled={lista.isFetchingNextPage}
          >
            {lista.isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </>
            ) : (
              "Carregar mais"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function ItemInbox({
  n,
  onMarcarLida,
}: {
  n: AdminNotificacao;
  onMarcarLida: () => void;
}) {
  const destino = rotaParaNotificacao(n);
  const inner = (
    <Card
      className={`overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md ${
        n.lida ? "" : "border-blue-200 bg-blue-50/40 dark:bg-blue-950/30"
      }`}
    >
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
        <div className="flex shrink-0 items-center gap-2">
          <IconeTipo tipo={n.tipo} />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {TIPO_LABEL[n.tipo] ?? n.tipo}
          </span>
        </div>

        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{n.titulo}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{n.corpo}</p>
          <p className="text-[10px] text-muted-foreground">
            {tempoRelativo(n.criadoEm)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {!n.lida && (
            <Button
              variant="ghost"
              size="icon"
              title="Marcar como lida"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMarcarLida();
              }}
            >
              <Check className="h-4 w-4" />
            </Button>
          )}
          {destino && (
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </div>
      </div>
    </Card>
  );

  if (destino) {
    return (
      <Link href={destino as Route} className="group block">
        {inner}
      </Link>
    );
  }
  return <div className="group">{inner}</div>;
}
