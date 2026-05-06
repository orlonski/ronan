import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { cacheGet, cachePut } from "@/db/database";
import { api, ApiError } from "./api";
import { enqueuePedagio, enqueueViagem } from "./sync";

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
  usuario: string;
  telefone: string | null;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
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
    void qc.refetchQueries({ queryKey: ["viagens"], type: "active" });
  };
}

export function useCriarPedagio() {
  const qc = useQueryClient();
  return async (payload: Record<string, unknown>) => {
    await enqueuePedagio(payload);
    void qc.refetchQueries({ queryKey: ["pedagios"], type: "active" });
  };
}

export type SugestaoLista = {
  fonte: "GOOGLE";
  placeId: string;
  nome: string;
  textoCompleto: string;
};

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

export function useCriarLocal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
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
    }) => api.post<Local>("/m/locais", input),
    onSuccess: (novo) => {
      qc.setQueryData<Catalogos>(["catalogos"], (cur) => {
        if (!cur) return cur;
        return { ...cur, locais: [...cur.locais, novo] };
      });
    },
  });
}
