"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useEffect } from "react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export type TipoNotificacaoAdmin =
  | "nova-viagem"
  | "resposta-divergencia-pedagio"
  | "resposta-divergencia-foto"
  | "nova-mensagem-viagem"
  | "foto-anexada"
  | "local-em-validacao"
  | "motorista-cadastro"
  | "motorista-senha-reset"
  | "alerta-torre"
  // O motorista avisou problema no caminhão pelo app.
  | "problema-veiculo"
  // A conferência diária tem uma sugestão esperando decisão.
  | "conferencia-diaria"
  // Os dois da PLATAFORMA. Existiam no backend e não aqui, então caíam no
  // fallback e apareciam no sininho como slug cru ("conta-auto-cadastro").
  | "conta-auto-cadastro"
  | "lead-novo"
  | "lead-precisa-humano"
  // A Meta mudou o estado de um template do WhatsApp (da PLATAFORMA).
  | "template-whatsapp"
  // O funcionário pediu correção do ponto pelo app.
  | "correcao-ponto"
  // Resumo diário de documento do motorista/caminhão vencendo.
  | "documento-vencendo"
  // O encarregado da obra pediu caminhão pelo portal.
  | "pedido-obra";

/**
 * As abas do filtro do sininho. Agrupa por ASSUNTO, não por tipo técnico:
 * ninguém quer escolher entre "resposta-divergencia-km" e "…-ticket"; quer ver
 * "o que é de viagem" ou "o que é de ponto".
 *
 * Tipo novo que não entrar aqui cai em "Outros" — some do filtro específico,
 * mas nunca some do sininho.
 */
export const CATEGORIAS_INBOX = [
  {
    chave: "viagens",
    label: "Viagens",
    tipos: [
      "nova-viagem",
      "resposta-divergencia-pedagio",
      "resposta-divergencia-km",
      "resposta-divergencia-ticket",
      "resposta-divergencia-material",
      "resposta-divergencia-dados",
      "resposta-divergencia-foto",
      "nova-mensagem-viagem",
      "foto-anexada",
      "local-em-validacao",
      "alerta-torre",
      "conferencia-diaria",
      "pedido-obra",
    ],
  },
  { chave: "motoristas", label: "Motoristas", tipos: ["motorista-cadastro", "motorista-senha-reset"] },
  { chave: "ponto", label: "Ponto", tipos: ["correcao-ponto"] },
  { chave: "frota", label: "Frota", tipos: ["problema-veiculo", "documento-vencendo"] },
  {
    chave: "plataforma",
    label: "Plataforma",
    tipos: [
      "conta-auto-cadastro",
      "lead-novo",
      "lead-precisa-humano",
      "onboarding-quer-continuar",
      "template-whatsapp",
    ],
  },
] as const;

export type ChaveCategoriaInbox = (typeof CATEGORIAS_INBOX)[number]["chave"];

export function tiposDaCategoria(chave?: ChaveCategoriaInbox): readonly string[] | undefined {
  return CATEGORIAS_INBOX.find((c) => c.chave === chave)?.tipos;
}

/** Não lidas por categoria, a partir da contagem por tipo da API. */
export function naoLidasPorCategoria(
  porTipo: Record<string, number> | undefined,
): Partial<Record<ChaveCategoriaInbox, number>> {
  const r: Partial<Record<ChaveCategoriaInbox, number>> = {};
  for (const c of CATEGORIAS_INBOX) {
    const n = c.tipos.reduce((s, t) => s + (porTipo?.[t] ?? 0), 0);
    if (n > 0) r[c.chave] = n;
  }
  return r;
}

export type AdminNotificacao = {
  id: string;
  tipo: TipoNotificacaoAdmin | string;
  titulo: string;
  corpo: string;
  dados: Record<string, string | number> | null;
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
};

const PATH = "/admin/inbox";
// Garantia: API_URL precisa ser igual ao client-api pra fechar a conexão SSE
// no mesmo host onde o backend roda.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export function useInboxLista(opts?: {
  somenteNaoLidas?: boolean;
  tipos?: readonly string[];
}) {
  const token = useAuthToken();
  const tipos = opts?.tipos?.join(",");
  return useInfiniteQuery({
    queryKey: ["admin-inbox", { somenteNaoLidas: opts?.somenteNaoLidas, tipos }],
    enabled: !!token,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      qs.set("limit", "30");
      if (pageParam) qs.set("cursor", pageParam);
      if (opts?.somenteNaoLidas) qs.set("naoLidas", "true");
      if (tipos) qs.set("tipos", tipos);
      return fetchApi<{ itens: AdminNotificacao[]; nextCursor: string | null }>(
        `${PATH}?${qs.toString()}`,
        { token },
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInboxContagem() {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["admin-inbox-contar"],
    enabled: !!token,
    // Sem refetchInterval — SSE invalida quando chega evento novo.
    queryFn: () => fetchApi<{ naoLidas: number; porTipo?: Record<string, number> }>(`${PATH}/contar`, { token }),
  });
}

export function useMarcarLida() {
  const qc = useQueryClient();
  const token = useAuthToken();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<AdminNotificacao>(`${PATH}/${id}/lida`, {
        method: "PATCH",
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
      void qc.invalidateQueries({ queryKey: ["admin-inbox-contar"] });
    },
  });
}

export function useMarcarTodasLidas() {
  const qc = useQueryClient();
  const token = useAuthToken();
  return useMutation({
    mutationFn: () =>
      fetchApi<{ marcadas: number }>(`${PATH}/marcar-todas-lidas`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
      void qc.invalidateQueries({ queryKey: ["admin-inbox-contar"] });
    },
  });
}

/**
 * Abre conexão SSE com /admin/inbox/stream. Toda nova notificação que chega:
 * - invalida queries de lista e contagem (TanStack refetch)
 * - mostra toast (sonner) com título + corpo
 *
 * Usa fetchEventSource em vez do EventSource nativo pra poder passar JWT no
 * header. Reconnect automático se cair. Cleanup desconecta quando componente
 * desmontar.
 *
 * Deve ser montado UMA VEZ em PainelShell pra não duplicar conexões.
 */
export function useInboxStream(): void {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const token = session?.accessToken;

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    void fetchEventSource(`${API_URL}${PATH}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
      openWhenHidden: true, // mantém aberto mesmo com aba em background
      onmessage(ev) {
        try {
          const notif = JSON.parse(ev.data) as AdminNotificacao;
          void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
          void qc.invalidateQueries({ queryKey: ["admin-inbox-contar"] });
          toast(notif.titulo, { description: notif.corpo });
        } catch {
          /* eventos sem JSON válido — ignora */
        }
      },
      onerror(err) {
        // Lança pra fetchEventSource fazer backoff e reconectar.
        // Se for permanente (401), throw aqui paralisa o retry — bom.
        if ((err as { status?: number }).status === 401) throw err;
        // Outros erros: retorna void = retry com backoff exponencial.
      },
    });
    return () => ctrl.abort();
  }, [token, qc]);
}
