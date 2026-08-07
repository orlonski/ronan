/**
 * Camada de dados do chat no app nativo.
 *
 * Duas regras que valem pra tudo aqui:
 *
 * 1. **Cache-first.** Abrir Conversas em 4G ruim tem que mostrar o histórico
 *    na hora e revalidar por trás — nunca um spinner esperando a rede.
 * 2. **Escrita passa pelo outbox.** A mensagem aparece na conversa no instante
 *    em que o motorista toca em enviar, com relógio, e sai sozinha quando
 *    houver sinal. Ninguém digita duas vezes por causa de túnel.
 *
 * O "tempo real" é um poll curto que só roda com a conversa aberta (ver
 * `useNovidadesConversa`). Fora dela quem avisa é a push — inclusive com o app
 * fechado. Não seguramos conexão viva: em rede móvel isso é reconexão e estado
 * pra dar errado, e o ganho no volume de conversa daqui não paga.
 */

import { useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ContatoChat,
  ConversaResumo,
  ListaConversasResponse,
  MensagemChatItem,
  MensagensChatResponse,
  MotivoDenuncia,
  NovidadesChatResponse,
} from "@ronan/shared-types";
import {
  cacheGet,
  cachePut,
  type PendingAudioChat,
  type PendingMensagemChat,
} from "@/db/database";
import { api } from "./api";
import {
  audiosChatPendentes,
  descartarAudioChat,
  descartarMensagemChat,
  enqueueAudioChat,
  enqueueMensagemChat,
  mensagensChatPendentes,
  onSyncChange,
  tentarNovamenteAudioChat,
  tentarNovamenteMensagemChat,
} from "./sync";

/** De quanto em quanto tempo a conversa aberta pergunta se chegou algo novo. */
const INTERVALO_POLL_MS = 5_000;

/** Idem, pro badge da aba quando o app está aberto em outra tela. */
const INTERVALO_BADGE_MS = 30_000;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Cache-first ─────────────────────────────────────────────────────────────

async function cacheFirst<T>(
  cacheKey: string,
  buscar: () => Promise<T>,
  aoRevalidar: (fresh: T) => void,
): Promise<T> {
  const cached = await cacheGet<T>(cacheKey).catch(() => null);
  if (cached != null) {
    void buscar()
      .then((fresh) => {
        void cachePut(cacheKey, fresh).catch(() => {});
        aoRevalidar(fresh);
      })
      .catch(() => {
        /* sem sinal: fica com o cache e tenta no próximo gatilho */
      });
    return cached;
  }
  const fresh = await buscar();
  void cachePut(cacheKey, fresh).catch(() => {});
  return fresh;
}

// ── Conversas ───────────────────────────────────────────────────────────────

export const chaveConversas = ["chat", "conversas"] as const;
export const chaveMensagens = (id: string) => ["chat", "mensagens", id] as const;
export const chaveBadge = ["chat", "badge"] as const;

export function useConversas() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: chaveConversas,
    staleTime: 15_000,
    refetchInterval: INTERVALO_BADGE_MS,
    queryFn: () =>
      cacheFirst<ListaConversasResponse>(
        "chat:conversas",
        () => api.get<ListaConversasResponse>("/m/chat/conversas"),
        (fresh) => qc.setQueryData(chaveConversas, fresh),
      ),
  });
}

/** Só o número do badge da aba. Barato — não traz mensagem nenhuma. */
export function useBadgeChat(habilitado: boolean) {
  return useQuery({
    queryKey: chaveBadge,
    enabled: habilitado,
    staleTime: 10_000,
    refetchInterval: INTERVALO_BADGE_MS,
    queryFn: async () => {
      const r = await api.get<NovidadesChatResponse>("/m/chat/novidades");
      return r.totalNaoLidas;
    },
  });
}

export function useContatos(busca: string) {
  return useQuery({
    queryKey: ["chat", "contatos", busca],
    staleTime: 60_000,
    queryFn: () =>
      cacheFirst<ContatoChat[]>(
        `chat:contatos:${busca || "todos"}`,
        () =>
          api.get<ContatoChat[]>(
            `/m/chat/contatos${busca ? `?busca=${encodeURIComponent(busca)}` : ""}`,
          ),
        () => {},
      ),
  });
}

/** Abre (ou recupera) a conversa 1:1 e devolve o id pra navegar. */
export function useAbrirConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (motoristaId: string) =>
      api.post<ConversaResumo>("/m/chat/conversas", { motoristaId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveConversas });
    },
  });
}

// ── Mensagens ───────────────────────────────────────────────────────────────

export function useMensagens(conversaId: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: chaveMensagens(conversaId ?? ""),
    enabled: !!conversaId,
    staleTime: 5_000,
    queryFn: () =>
      cacheFirst<MensagensChatResponse>(
        `chat:mensagens:${conversaId}`,
        () => api.get<MensagensChatResponse>(`/m/chat/conversas/${conversaId}/mensagens`),
        (fresh) => qc.setQueryData(chaveMensagens(conversaId!), fresh),
      ),
  });
}

/**
 * Bolhas que ainda estão no outbox desta conversa. Reagem a `onSyncChange`,
 * então o relógio vira "enviada" sozinho quando o drain conclui.
 */
export function usePendentesDaConversa(conversaId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["chat", "pendentes", conversaId ?? ""],
    enabled: !!conversaId,
    queryFn: async () => {
      const [textos, audios] = await Promise.all([
        mensagensChatPendentes(conversaId!),
        audiosChatPendentes(conversaId!),
      ]);
      return { textos, audios };
    },
    // Vem do AsyncStorage local: sempre fresco, custo zero.
    staleTime: 0,
  });

  useEffect(() => {
    if (!conversaId) return;
    return onSyncChange(() => {
      void qc.invalidateQueries({ queryKey: ["chat", "pendentes", conversaId] });
      // Uma mensagem que acabou de subir precisa aparecer como enviada de
      // verdade — a fonte disso é o servidor.
      void qc.invalidateQueries({ queryKey: chaveMensagens(conversaId) });
    });
  }, [conversaId, qc]);

  return query;
}

/** Enfileira um áudio gravado. Igual ao texto: aparece na hora, sobe depois. */
export function useEnviarAudio(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (g: { uri: string; mimetype: string; duracaoSegundos: number }) => {
      await enqueueAudioChat({
        clientId: uuid(),
        conversaId,
        audioUri: g.uri,
        audioMime: g.mimetype,
        duracaoSegundos: g.duracaoSegundos,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat", "pendentes", conversaId] });
    },
  });
}

export function useReenviarAudio(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => tentarNovamenteAudioChat(clientId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat", "pendentes", conversaId] });
    },
  });
}

export function useDescartarAudio(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => descartarAudioChat(clientId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat", "pendentes", conversaId] });
    },
  });
}

export function useEnviarMensagem(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (texto: string) => {
      await enqueueMensagemChat({ clientId: uuid(), conversaId, texto });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat", "pendentes", conversaId] });
    },
  });
}

export function useReenviarMensagem(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => tentarNovamenteMensagemChat(clientId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat", "pendentes", conversaId] });
    },
  });
}

export function useDescartarMensagem(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => descartarMensagemChat(clientId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat", "pendentes", conversaId] });
    },
  });
}

export function useMarcarLida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversaId: string) =>
      api.post(`/m/chat/conversas/${conversaId}/lida`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveConversas });
      void qc.invalidateQueries({ queryKey: chaveBadge });
    },
  });
}

export function useSilenciar(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (silenciado: boolean) =>
      api.post(`/m/chat/conversas/${conversaId}/silenciar`, { silenciado }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveConversas });
      void qc.invalidateQueries({ queryKey: chaveMensagens(conversaId) });
    },
  });
}

/**
 * O "tempo real": enquanto a tela da conversa está montada, pergunta a cada 5s
 * o que apareceu desde a última resposta do servidor. Usa o relógio do
 * SERVIDOR (`agora`) como marca d'água — o do celular pode estar torto, e um
 * relógio adiantado faria a mensagem do outro nunca chegar.
 */
export function useNovidadesConversa(conversaId: string | undefined, ativo: boolean) {
  const qc = useQueryClient();
  const desde = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Troca de conversa zera a marca d'água.
    desde.current = undefined;
  }, [conversaId]);

  useEffect(() => {
    if (!conversaId || !ativo) return;
    let vivo = true;

    const tick = async () => {
      try {
        const params = new URLSearchParams({ conversaId });
        if (desde.current) params.set("desde", desde.current);
        const r = await api.get<NovidadesChatResponse>(
          `/m/chat/novidades?${params.toString()}`,
        );
        if (!vivo) return;
        const primeiraPassada = !desde.current;
        desde.current = r.agora;
        qc.setQueryData(chaveBadge, r.totalNaoLidas);
        // Na primeira passada só ancoramos o relógio — o histórico já veio da
        // query de mensagens, e reaproveitá-lo aqui duplicaria bolha.
        if (primeiraPassada) return;
        if (r.mensagens.length > 0) {
          aplicarNovas(qc, conversaId, r.mensagens);
        }
        if (r.conversasAtualizadas.length > 0) {
          void qc.invalidateQueries({ queryKey: chaveConversas });
        }
      } catch {
        /* sem sinal: o próximo tick tenta de novo, nada quebra */
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), INTERVALO_POLL_MS);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [conversaId, ativo, qc]);
}

/** Junta as mensagens novas ao histórico em cache, sem duplicar por clientId. */
function aplicarNovas(
  qc: QueryClient,
  conversaId: string,
  novas: MensagemChatItem[],
): void {
  qc.setQueryData<MensagensChatResponse>(chaveMensagens(conversaId), (cur) => {
    if (!cur) return cur;
    const vistos = new Set(cur.mensagens.map((m) => m.clientId));
    const ineditas = novas.filter((m) => !vistos.has(m.clientId));
    if (ineditas.length === 0) return cur;
    return { ...cur, mensagens: [...cur.mensagens, ...ineditas] };
  });
}

// ── Bloqueio e denúncia ─────────────────────────────────────────────────────

export function useBloqueios() {
  return useQuery({
    queryKey: ["chat", "bloqueios"],
    staleTime: 60_000,
    queryFn: () => api.get<{ motoristaId: string; nome: string }[]>("/m/chat/bloqueios"),
  });
}

export function useBloquear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (motoristaId: string) =>
      api.post("/m/chat/bloqueios", { motoristaId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat"] });
    },
  });
}

export function useDesbloquear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (motoristaId: string) => api.delete(`/m/chat/bloqueios/${motoristaId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chat"] });
    },
  });
}

export function useDenunciar() {
  return useMutation({
    mutationFn: (args: { mensagemId: string; motivo: MotivoDenuncia; detalhe?: string }) =>
      api.post(`/m/chat/mensagens/${args.mensagemId}/denuncia`, {
        motivo: args.motivo,
        detalhe: args.detalhe,
      }),
  });
}

export function useApagarMensagem(conversaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mensagemId: string) => api.delete(`/m/chat/mensagens/${mensagemId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveMensagens(conversaId) });
      void qc.invalidateQueries({ queryKey: chaveConversas });
    },
  });
}

export type { PendingAudioChat, PendingMensagemChat };
