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
  | "foto-anexada"
  | "local-em-validacao"
  | "motorista-cadastro";

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

export function useInboxLista(opts?: { somenteNaoLidas?: boolean }) {
  const token = useAuthToken();
  return useInfiniteQuery({
    queryKey: ["admin-inbox", { somenteNaoLidas: opts?.somenteNaoLidas, token }],
    enabled: !!token,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      qs.set("limit", "30");
      if (pageParam) qs.set("cursor", pageParam);
      if (opts?.somenteNaoLidas) qs.set("naoLidas", "true");
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
    queryKey: ["admin-inbox-contar", token],
    enabled: !!token,
    // Sem refetchInterval — SSE invalida quando chega evento novo.
    queryFn: () => fetchApi<{ naoLidas: number }>(`${PATH}/contar`, { token }),
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
