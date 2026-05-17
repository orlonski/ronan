import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { cacheGet, cachePut } from "@/db/database";
import { api, ApiError } from "./api";
import { enqueueAbastecimento, enqueuePedagio, enqueueViagem } from "./sync";

export type Veiculo = { id: string; placa: string; modelo: string | null };

export type Material = { id: string; nome: string };

export type Obra = {
  id: string;
  nome: string;
  empresaCliente: { id: string; nome: string };
};

export type Local = {
  id: string;
  nome: string;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  pontoReferencia: string | null;
  tipo: "CARGA" | "DESCARGA" | "AMBOS";
  obraId: string | null;
  lat: number | null;
  lng: number | null;
};

export type Catalogos = {
  veiculos: Veiculo[];
  materiais: Material[];
  obras: Obra[];
  locais: Local[];
};

export type Me = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  veiculos: Veiculo[];
  ultimoLoginEm: string | null;
};

export type Viagem = {
  id: string;
  clientId: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  observacao: string | null;
  status: string;
  sincronizadoEm: string;
  veiculo: Veiculo;
  obra: { id: string; nome: string };
  material: Material;
  localCarga: { id: string; nome: string; cidade: string; uf: string };
  localDescarga: { id: string; nome: string; cidade: string; uf: string };
  fotos: { id: string; storageKey: string }[];
};

export type Pedagio = {
  id: string;
  data: string;
  pracaPedagio: string;
  valor: string;
  veiculo: { id: string; placa: string };
  viagem: { id: string; ticket: string; data: string } | null;
};

function isOfflineError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof ApiError) return false;
  return false;
}

/**
 * useQuery com fallback offline: tenta API, se falhar por rede tenta o cache local.
 * Cache writes em void/catch pra erro de IndexedDB nao quebrar a query.
 */
function offlineCacheQuery<T>(key: string, path: string, opts: { staleTime?: number } = {}) {
  const cacheKey = `q:${key}`;
  return {
    queryKey: [key],
    staleTime: opts.staleTime ?? 60_000,
    queryFn: async (): Promise<T> => {
      try {
        const fresh = await api.get<T>(path);
        void cachePut(cacheKey, fresh).catch(() => {});
        return fresh;
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<T>(cacheKey);
            if (cached) return cached;
          } catch {
            /* sqlite indisponivel */
          }
        }
        throw err;
      }
    },
  };
}

export function useMe() {
  return useQuery(offlineCacheQuery<Me>("me", "/m/me"));
}

export function useCatalogos() {
  return useQuery(
    offlineCacheQuery<Catalogos>("catalogos", "/m/catalogos", { staleTime: 5 * 60_000 }),
  );
}

export type ListaViagens = { itens: Viagem[]; nextCursor: string | null };

export type GrupoStatus = "AGUARDANDO" | "CONFERIDA" | "DIVERGENTE";

export type ResumoMes = {
  mes: string;
  totalViagens: number;
  totalToneladas: string;
  totalKm: string;
  totalPedagio: string;
  porStatus: { aguardando: number; conferida: number; divergente: number };
  pedagios: { count: number; totalValor: string };
};

/** Home: top 10 mais recentes, sem filtro. */
export function useViagens() {
  const cacheKey = "q:viagens";
  return useQuery({
    queryKey: ["viagens"],
    staleTime: 60_000,
    queryFn: async (): Promise<Viagem[]> => {
      try {
        const fresh = await api.get<ListaViagens>("/m/viagens?limit=10");
        void cachePut(cacheKey, fresh.itens).catch(() => {});
        return fresh.itens;
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<Viagem[]>(cacheKey);
            if (cached) return cached;
          } catch {
            /* sqlite indisponivel */
          }
        }
        throw err;
      }
    },
  });
}

export function useResumoMes(mes?: string) {
  const path = mes ? `/m/viagens/resumo?mes=${mes}` : "/m/viagens/resumo";
  const cacheKey = `q:resumo:${mes ?? "atual"}`;
  return useQuery({
    queryKey: ["resumo-mes", mes ?? "atual"],
    staleTime: 60_000,
    queryFn: async (): Promise<ResumoMes> => {
      try {
        const fresh = await api.get<ResumoMes>(path);
        void cachePut(cacheKey, fresh).catch(() => {});
        return fresh;
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<ResumoMes>(cacheKey);
            if (cached) return cached;
          } catch {
            /* */
          }
        }
        throw err;
      }
    },
  });
}

export function useViagensFiltradas(params: {
  mes?: string;
  status?: GrupoStatus;
}) {
  return useInfiniteQuery({
    queryKey: ["viagens-filtradas", params],
    initialPageParam: undefined as string | undefined,
    staleTime: 30_000,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (params.mes) qs.set("mes", params.mes);
      if (params.status) qs.set("status", params.status);
      qs.set("limit", "30");
      if (pageParam) qs.set("cursor", pageParam);
      return api.get<ListaViagens>(`/m/viagens?${qs.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export type ViagemDetalhe = Viagem & {
  observacao: string | null;
  valorPedagioTotal: string | null;
  lat: number | null;
  lng: number | null;
  iniciadoEm: string | null;
  kmReal: string | null;
  pontos: { lat: number; lng: number; capturadoEm: string }[];
  obra: { id: string; nome: string; empresaCliente?: { id: string; nome: string } };
  localCarga: Viagem["localCarga"] & { logradouro: string; lat: number | null; lng: number | null };
  localDescarga: Viagem["localDescarga"] & { logradouro: string; lat: number | null; lng: number | null };
};

export function useViagemDetalhe(id: string) {
  return useQuery({
    queryKey: ["viagem-detalhe", id],
    enabled: !!id,
    queryFn: () => api.get<ViagemDetalhe>(`/m/viagens/${id}`),
  });
}

export type ListaPedagios = { itens: Pedagio[]; nextCursor: string | null };

export function usePedagios() {
  const cacheKey = "q:pedagios";
  return useQuery({
    queryKey: ["pedagios"],
    staleTime: 60_000,
    queryFn: async (): Promise<Pedagio[]> => {
      try {
        const fresh = await api.get<ListaPedagios>("/m/pedagios?limit=10");
        void cachePut(cacheKey, fresh.itens).catch(() => {});
        return fresh.itens;
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<Pedagio[]>(cacheKey);
            if (cached) return cached;
          } catch {
            /* */
          }
        }
        throw err;
      }
    },
  });
}

export function usePedagiosFiltrados(params: { mes?: string }) {
  return useInfiniteQuery({
    queryKey: ["pedagios-filtrados", params],
    initialPageParam: undefined as string | undefined,
    staleTime: 30_000,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (params.mes) qs.set("mes", params.mes);
      qs.set("limit", "30");
      if (pageParam) qs.set("cursor", pageParam);
      return api.get<ListaPedagios>(`/m/pedagios?${qs.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useExcluirPedagio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pedagioId: string) => {
      await api.delete(`/m/pedagios/${pedagioId}`);
      return pedagioId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pedagios"] });
      void qc.invalidateQueries({ queryKey: ["pedagios-filtrados"] });
      void qc.invalidateQueries({ queryKey: ["resumo-mes"] });
    },
  });
}

export function useExcluirAbastecimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (abastecimentoId: string) => {
      await api.delete(`/m/abastecimentos/${abastecimentoId}`);
      return abastecimentoId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["abastecimentos"] });
    },
  });
}

/**
 * Offline-first: escreve no outbox local e retorna na hora.
 * Sync real (upload de foto + POST) acontece em background quando online.
 */
export function useCriarViagem() {
  const qc = useQueryClient();
  return async (input: {
    payload: Record<string, unknown>;
    foto?: { uri: string; mime: string };
  }) => {
    await enqueueViagem(input.payload, input.foto);
    // Invalida tudo que pode mostrar viagens recém criadas: home, histórico,
    // resumo do mês. Refetch ativo + cache fica stale pra refetch on-mount.
    void qc.invalidateQueries({ queryKey: ["viagens"] });
    void qc.invalidateQueries({ queryKey: ["viagens-filtradas"] });
    void qc.invalidateQueries({ queryKey: ["resumo-mes"] });
  };
}

export function useCriarPedagio() {
  const qc = useQueryClient();
  return async (payload: Record<string, unknown>) => {
    await enqueuePedagio(payload);
    void qc.invalidateQueries({ queryKey: ["pedagios"] });
    void qc.invalidateQueries({ queryKey: ["pedagios-filtrados"] });
    void qc.invalidateQueries({ queryKey: ["resumo-mes"] });
  };
}

export type Abastecimento = {
  id: string;
  clientId: string;
  data: string;
  tipo: "DIESEL_S10" | "DIESEL_S500" | "ARLA_32" | "GASOLINA" | "ETANOL";
  litros: string;
  valorTotal: string;
  precoLitro: string | null;
  odometro: number;
  postoNome: string | null;
  tanqueCheio: boolean;
  observacao: string | null;
  lat: number | null;
  lng: number | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  fotos: { id: string; storageKey: string }[];
};

export type ListaAbastecimentos = {
  itens: Abastecimento[];
  nextCursor: string | null;
};

export function useAbastecimentos(mes?: string) {
  const qs = mes ? `?mes=${mes}` : "";
  const cacheKey = `q:abastecimentos:${mes ?? "todos"}`;
  return useQuery({
    queryKey: ["abastecimentos", mes ?? "todos"],
    staleTime: 60_000,
    queryFn: async (): Promise<Abastecimento[]> => {
      try {
        const fresh = await api.get<ListaAbastecimentos>(
          `/m/abastecimentos${qs}`,
        );
        void cachePut(cacheKey, fresh.itens).catch(() => {});
        return fresh.itens;
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<Abastecimento[]>(cacheKey);
            if (cached) return cached;
          } catch {
            /* nope */
          }
        }
        throw err;
      }
    },
  });
}

export function usePostosRecentes() {
  return useQuery({
    queryKey: ["postos-recentes"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      try {
        return await api.get<string[]>("/m/abastecimentos/postos-recentes");
      } catch {
        return [];
      }
    },
  });
}

export function useCriarAbastecimento() {
  const qc = useQueryClient();
  return async (input: {
    payload: Record<string, unknown>;
    foto?: { uri: string; mime: string };
  }) => {
    await enqueueAbastecimento(input.payload, input.foto);
    void qc.invalidateQueries({ queryKey: ["abastecimentos"] });
    void qc.invalidateQueries({ queryKey: ["postos-recentes"] });
  };
}

export type SugestaoLista = {
  fonte: "GOOGLE";
  placeId: string;
  nome: string;
  textoCompleto: string;
};

export type TrackingConfig = {
  distanciaMinMetros: number;
  intervaloMaxSegundos: number;
  precisaoAlta: boolean;
  accuracyMaxMetros: number;
  velocidadeMaxKmh: number;
  autoFinalizarHoras: number;
  detectorAtivado: boolean;
  detectorVelocidadeKmh: number;
  detectorLeituras: number;
};

export const TRACKING_CONFIG_DEFAULTS: TrackingConfig = {
  distanciaMinMetros: 50,
  intervaloMaxSegundos: 30,
  precisaoAlta: false,
  accuracyMaxMetros: 100,
  velocidadeMaxKmh: 200,
  autoFinalizarHoras: 6,
  detectorAtivado: true,
  detectorVelocidadeKmh: 30,
  detectorLeituras: 3,
};

/**
 * Config global de tracking. Cacheia agressivamente no servidor + offline.
 * Se app falhar em buscar, usa defaults — tracking ainda funciona.
 */
export function useTrackingConfig() {
  return useQuery(
    offlineCacheQuery<TrackingConfig>("tracking-config", "/m/tracking-config", {
      staleTime: 5 * 60_000,
    }),
  );
}

export type RotaCalculada =
  | { km: string; duracaoSegundos: number; fonte: "osrm" | "cache" }
  | { km: null; erro: string };

/**
 * Calcula KM "oficial" da rota carga→descarga via OSRM no backend.
 * Cache server-side (90 dias), entao staleTime infinito no client.
 */
export function useCalcularRota(origemId?: string, destinoId?: string) {
  return useQuery({
    queryKey: ["rota-calcular", origemId, destinoId],
    enabled: !!origemId && !!destinoId && origemId !== destinoId,
    staleTime: Infinity,
    retry: false,
    queryFn: () =>
      api.get<RotaCalculada>(
        `/m/rotas/calcular?origem=${origemId}&destino=${destinoId}`,
      ),
  });
}

export type SugestaoEndereco = {
  fonte: "VIACEP" | "GOOGLE";
  placeId?: string;
  textoCompleto?: string;
  nome?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
  lat?: number;
  lng?: number;
};

/**
 * Apaga viagem propria do motorista. Backend valida status=ENVIADA.
 * Se sucesso, remove do cache local.
 */
export function useExcluirViagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (viagemId: string) => {
      await api.delete(`/m/viagens/${viagemId}`);
      return viagemId;
    },
    onSuccess: (viagemId) => {
      qc.setQueryData<Viagem[]>(["viagens"], (cur) =>
        cur ? cur.filter((v) => v.id !== viagemId) : cur,
      );
      void qc.invalidateQueries({ queryKey: ["viagens-filtradas"] });
      void qc.invalidateQueries({ queryKey: ["resumo-mes"] });
    },
  });
}

/**
 * Local "leve" retornado pelo 409 (sugestões) e pelo GET em-validacao.
 * Tem lat/lng pra geofence + nivelConfianca pra UI.
 */
export type LocalEmValidacao = {
  id: string;
  nome: string;
  lat: number;
  lng: number;
  nivelConfianca: "RASCUNHO" | "PRESENCA_PONTUAL" | "DWELL_CONFIRMADO";
  criadoEm: string;
};

export type LocalSugestao = {
  id: string;
  nome: string;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  tipo: "CARGA" | "DESCARGA" | "AMBOS";
  lat: number | null;
  lng: number | null;
  nivelConfianca:
    | "RASCUNHO"
    | "PRESENCA_PONTUAL"
    | "DWELL_CONFIRMADO"
    | "RECORRENTE"
    | "HUMANO";
};

export type CriarLocalInput = {
  nome: string;
  logradouro: string;
  numero?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
  pontoReferencia?: string;
  tipo: "CARGA" | "DESCARGA" | "AMBOS";
  obraId?: string;
  lat?: number;
  lng?: number;
  /**
   * Quando true, ignora o pré-check de 200m do backend e cria mesmo havendo
   * locais próximos. App passa true depois que motorista vê as sugestões e
   * insiste em criar novo.
   */
  forcarCriacao?: boolean;
};

export function useCriarLocal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarLocalInput) => api.post<Local>("/m/locais", input),
    onSuccess: (novo) => {
      qc.setQueryData<Catalogos>(["catalogos"], (cur) => {
        if (!cur) return cur;
        return { ...cur, locais: [...cur.locais, novo] };
      });
    },
  });
}

/**
 * Locais que o motorista cadastrou e ainda não foram validados por
 * recorrência/admin. App usa pra registrar geofences passivos.
 */
export function useLocaisEmValidacao() {
  return useQuery({
    queryKey: ["locais-em-validacao"],
    staleTime: 5 * 60_000,
    queryFn: () => api.get<LocalEmValidacao[]>("/m/locais/em-validacao"),
  });
}

/**
 * App chama quando OS dispara ENTER→EXIT do geofence. Se a duração for
 * suficiente, backend promove o Local pra DWELL_CONFIRMADO.
 */
export async function enviarEventoPresenca(
  localId: string,
  body: { duracaoSeg: number; detectadoEm: string },
) {
  return api.post<{ ok: true; ignorado?: boolean }>(
    `/m/locais/${localId}/eventos-presenca`,
    body,
  );
}

// ===== Notificações (central in-app) =====

export type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  corpo: string;
  dados: Record<string, unknown> | null;
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
};

export type NotificacoesPagina = {
  itens: Notificacao[];
  nextCursor: string | null;
  naoLidas: number;
};

/**
 * Infinite query do histórico de notificações. Cacheia a 1ª página em
 * AsyncStorage pra disponibilidade offline. Páginas seguintes não cacheiam —
 * histórico antigo offline é caso raro, complexidade não compensa.
 *
 * Polling a cada 20s em foreground (`refetchIntervalInBackground: false`):
 * backstop pro `addNotificationReceivedListener` que tem entrega instável em
 * Android. Custo de uma chamada GET leve, vale a UX de badge fresh.
 */
export function useNotificacoes() {
  const cacheKey = "notificacoes:p1";
  return useInfiniteQuery({
    queryKey: ["notificacoes"],
    initialPageParam: undefined as string | undefined,
    staleTime: 15_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ pageParam }): Promise<NotificacoesPagina> => {
      try {
        const fresh = await api.listarNotificacoes({ cursor: pageParam, limit: 30 });
        if (!pageParam) void cachePut(cacheKey, fresh).catch(() => {});
        return fresh;
      } catch (err) {
        if (!pageParam && isOfflineError(err)) {
          try {
            const cached = await cacheGet<NotificacoesPagina>(cacheKey);
            if (cached) return cached;
          } catch {
            /* */
          }
        }
        throw err;
      }
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Selector pra badge — sempre lê o `naoLidas` da 1ª página (única coluna que
 * o backend sempre devolve fresh em cada request).
 */
export function useNaoLidas(): number {
  const q = useNotificacoes();
  return q.data?.pages[0]?.naoLidas ?? 0;
}

export function useMarcarNotificacaoLida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.marcarNotificacaoLida(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["notificacoes"] });
      const prev = qc.getQueryData(["notificacoes"]);
      qc.setQueryData<{ pages: NotificacoesPagina[]; pageParams: unknown[] } | undefined>(
        ["notificacoes"],
        (cur) => {
          if (!cur) return cur;
          let decremento = 0;
          const pages = cur.pages.map((p, pageIdx) => {
            const itens = p.itens.map((n) => {
              if (n.id === id && !n.lida) {
                if (pageIdx === 0) decremento = 1;
                return { ...n, lida: true, lidaEm: new Date().toISOString() };
              }
              return n;
            });
            // Decrementa naoLidas só na 1ª página (é o valor fresh do backend)
            const naoLidas = pageIdx === 0 ? Math.max(0, p.naoLidas - decremento) : p.naoLidas;
            return { ...p, itens, naoLidas };
          });
          return { ...cur, pages };
        },
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notificacoes"], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["notificacoes"] });
    },
  });
}

export function useMarcarTodasNotificacoesLidas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.marcarTodasNotificacoesLidas(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notificacoes"] });
    },
  });
}
