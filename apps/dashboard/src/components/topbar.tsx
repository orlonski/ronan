"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import {
  Bell,
  Building2,
  Camera,
  ClipboardCheck,
  Clock,
  KeyRound,
  MapPin,
  PiggyBank,
  TriangleAlert,
  Truck,
  UserPlus,
  Wallet,
  Wrench, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type AdminNotificacao,
  type ChaveCategoriaInbox,
  CATEGORIAS_INBOX,
  naoLidasPorCategoria,
  tiposDaCategoria,
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
  const [categoria, setCategoria] = useState<ChaveCategoriaInbox | undefined>();
  const contagem = useInboxContagem();
  const todas = useInboxLista();
  const filtrada = useInboxLista({ tipos: tiposDaCategoria(categoria) });
  const lista = categoria ? filtrada : todas;
  const marcarLida = useMarcarLida();
  const marcarTodas = useMarcarTodasLidas();
  const router = useRouter();

  const naoLidas = contagem.data?.naoLidas ?? 0;
  const itens = lista.data?.pages.flatMap((p) => p.itens).slice(0, 10) ?? [];

  /**
   * Só aparece a aba de assunto que a pessoa de fato recebe — quem não é da
   * plataforma não vê "Plataforma", quem não decide ponto não vê "Ponto".
   * Aba que sempre abre vazia ensina a não usar o filtro.
   */
  const porCategoria = naoLidasPorCategoria(contagem.data?.porTipo);
  const tiposVistos = new Set((todas.data?.pages.flatMap((p) => p.itens) ?? []).map((n) => n.tipo));
  const abas = CATEGORIAS_INBOX.filter(
    (c) =>
      c.chave === categoria ||
      (porCategoria[c.chave] ?? 0) > 0 ||
      c.tipos.some((t) => tiposVistos.has(t)),
  );

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
          data-coach="sino"
          type="button"
          className="relative rounded-md p-2 text-foreground hover:bg-muted max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center"
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
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-1rem))] p-0">
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

        {abas.length > 1 && (
          <div
            role="tablist"
            aria-label="Filtrar notificações por assunto"
            className="flex gap-1 overflow-x-auto border-b px-3 py-2"
          >
            <AbaCategoria
              ativa={!categoria}
              label="Todas"
              naoLidas={naoLidas}
              onClick={() => setCategoria(undefined)}
            />
            {abas.map((c) => (
              <AbaCategoria
                key={c.chave}
                ativa={categoria === c.chave}
                label={c.label}
                naoLidas={porCategoria[c.chave] ?? 0}
                onClick={() => setCategoria(c.chave)}
              />
            ))}
          </div>
        )}

        <div className="max-h-[400px] overflow-y-auto">
          {lista.isLoading && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          )}
          {!lista.isLoading && itens.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Bell className="mx-auto mb-2 h-6 w-6 opacity-50" />
              {categoria ? "Nada deste assunto por enquanto." : "Nenhuma notificação ainda."}
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

function AbaCategoria({
  ativa,
  label,
  naoLidas,
  onClick,
}: {
  ativa: boolean;
  label: string;
  naoLidas: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        ativa
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {naoLidas > 0 && (
        <span
          className={`rounded-full px-1.5 text-[10px] font-bold ${
            ativa ? "bg-background/20" : "bg-red-600 text-white"
          }`}
        >
          {naoLidas > 99 ? "99+" : naoLidas}
        </span>
      )}
    </button>
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
  // A torre mandava o alerta como "nova-viagem", então um caminhão parado há
  // três dias chegava com a prancheta azul de lançamento.
  if (tipo === "alerta-torre")
    return <TriangleAlert className={`${cls} text-red-600`} />;
  if (tipo === "problema-veiculo")
    return <Wrench className={`${cls} text-amber-600`} />;
  if (tipo === "documento-vencendo")
    return <ClipboardCheck className={`${cls} text-amber-600`} />;
  if (tipo === "pedido-obra")
    return <Truck className={`${cls} text-blue-600`} />;
  if (tipo === "integracao")
    return <Plug className={`${cls} text-amber-600`} />;
  if (tipo === "cobranca-cliente")
    return <Wallet className={`${cls} text-emerald-600`} />;
  if (tipo === "conferencia-diaria")
    return <ClipboardCheck className={`${cls} text-amber-600`} />;
  if (tipo === "conta-auto-cadastro" || tipo === "lead-novo" || tipo === "lead-precisa-humano")
    return <Building2 className={`${cls} text-emerald-600`} />;
  if (tipo === "correcao-ponto")
    return <Clock className={`${cls} text-blue-600`} />;
  if (tipo === "template-whatsapp")
    return <ClipboardCheck className={`${cls} text-amber-600`} />;
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
  if (tipo === "motorista-senha-reset")
    return <KeyRound className={`${cls} text-amber-600`} />;
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
  // Alerta vai pra TORRE, sempre — é a única tela onde ele se resolve. Ia pra
  // /viagens/:id, que não tem ação nenhuma pra isso.
  if (n.tipo === "alerta-torre") return "/torre";
  // O aviso se decide na aba "Avisos do motorista" da Manutenção.
  if (n.tipo === "problema-veiculo") return "/frota?aba=avisos";
  // Documento do caminhão se renova na Manutenção; o do motorista, na lista de motoristas.
  if (n.tipo === "documento-vencendo") return dados.de === "de caminhão" ? "/frota?aba=documentos" : "/motoristas";
  // Estado de template da Meta se confere na tela WhatsApp → Templates na Meta.
  if (n.tipo === "template-whatsapp") return "/whatsapp";
  // Avisos de uma conexão desligados: religa na tela da conexão.
  if (n.tipo === "integracao") return "/configuracoes/integracoes";
  // As sugestões da conferência se decidem na aba "Fila do gestor".
  if (n.tipo === "conferencia-diaria") return "/conferencia-diaria?aba=fila";
  // Pedido de correção se decide na tela "Acerto de ponto".
  if (n.tipo === "correcao-ponto") return "/ponto/correcoes";
  // O pedido da obra se confirma (ou recusa) na Programação, no dia pedido.
  if (n.tipo === "pedido-obra") return dados.data ? `/programacao?data=${dados.data}` : "/programacao";
  // Pagamento, vencimento e estorno do Asaas se veem na aba "A receber".
  if (n.tipo === "cobranca-cliente") return "/financeiro?aba=receber";
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
  if (n.tipo === "nova-mensagem-viagem" && dados.viagemId) {
    return `/viagens/${dados.viagemId}`;
  }
  if (n.tipo === "local-em-validacao") {
    return `/locais/em-validacao`;
  }
  if (n.tipo === "motorista-cadastro") {
    return `/motoristas?status=PENDENTE_APROVACAO`;
  }
  if (n.tipo === "motorista-senha-reset" && dados.motoristaId) {
    return `/motoristas/${dados.motoristaId}`;
  }
  return null;
}
