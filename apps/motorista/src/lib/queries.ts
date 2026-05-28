import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ExtrairTicketResult } from "@ronan/shared-types";
import { cacheGet, cachePut } from "@/db/dexie";
import { api, ApiError } from "./api";
import {
  normalizarAbastecimento,
  normalizarCatalogos,
  normalizarLocal,
  normalizarMe,
  normalizarViagem,
} from "./compat";
import { enqueueAbastecimento, enqueuePedagio, enqueueViagem } from "./sync";

export type Veiculo = { id: string; placa: string; modelo: string | null };
export type Material = { id: string; nome: string };
export type Cliente = {
  id: string;
  nome: string;
  empresa: { id: string; nome: string };
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
  clienteIds: string[];
  lat: number | null;
  lng: number | null;
};

export type Empresa = { id: string; nome: string };

export type Catalogos = {
  veiculos: Veiculo[];
  materiais: Material[];
  clientes: Cliente[];
  locais: Local[];
  empresas: Empresa[];
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
  podeLancarViagem: boolean;
  podeIniciarViagem: boolean;
  podeLancarPedagio: boolean;
  podeLancarAbastecimento: boolean;
  podeUsarOcrTicket: boolean;
};

export type Viagem = {
  id: string;
  clientId: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  kmCalculado: string | null;
  ocrCampos: string[];
  ocrConfidence: number | null;
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  kmInformado: string;
  kmEfetivo: string;
  kmAjustada: boolean;
  observacao: string | null;
  status: string;
  sincronizadoEm: string;
  veiculo: Veiculo;
  cliente: { id: string; nome: string };
  material: Material;
  localCarga: {
    id: string;
    nome: string;
    cidade: string;
    uf: string;
    lat?: number | null;
    lng?: number | null;
  };
  localDescarga: {
    id: string;
    nome: string;
    cidade: string;
    uf: string;
    lat?: number | null;
    lng?: number | null;
  };
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

function offlineCacheQuery<T>(key: string, path: string, opts: { staleTime?: number } = {}) {
  const cacheKey = key;
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
            /* */
          }
        }
        throw err;
      }
    },
  };
}

export function useMe() {
  const base = offlineCacheQuery<Me>("me", "/m/me");
  return useQuery({
    ...base,
    queryFn: async () => normalizarMe(await base.queryFn()),
  });
}

export function useCatalogos() {
  const base = offlineCacheQuery<Catalogos>("catalogos", "/m/catalogos", {
    staleTime: 5 * 60_000,
  });
  return useQuery({
    ...base,
    queryFn: async () => normalizarCatalogos(await base.queryFn()),
  });
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

export function useViagens() {
  const cacheKey = "viagens";
  return useQuery({
    queryKey: ["viagens"],
    staleTime: 60_000,
    queryFn: async (): Promise<Viagem[]> => {
      try {
        const fresh = await api.get<ListaViagens>("/m/viagens?limit=10");
        void cachePut(cacheKey, fresh.itens).catch(() => {});
        return fresh.itens.map(normalizarViagem);
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<Viagem[]>(cacheKey);
            if (cached) return cached.map(normalizarViagem);
          } catch {
            /* */
          }
        }
        throw err;
      }
    },
  });
}

export function useResumoMes(mes?: string) {
  const path = mes ? `/m/viagens/resumo?mes=${mes}` : "/m/viagens/resumo";
  const cacheKey = `resumo:${mes ?? "atual"}`;
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
      const res = await api.get<ListaViagens>(`/m/viagens?${qs.toString()}`);
      return { ...res, itens: res.itens.map(normalizarViagem) };
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
  cliente: { id: string; nome: string; empresa?: { id: string; nome: string } };
  localCarga: Viagem["localCarga"] & {
    logradouro: string;
    lat: number | null;
    lng: number | null;
  };
  localDescarga: Viagem["localDescarga"] & {
    logradouro: string;
    lat: number | null;
    lng: number | null;
  };
  rotaGeometria: string | null;
};

export function useViagemDetalhe(id: string) {
  return useQuery({
    queryKey: ["viagem-detalhe", id],
    enabled: !!id,
    queryFn: async () => normalizarViagem(await api.get<ViagemDetalhe>(`/m/viagens/${id}`)),
  });
}

export type ListaPedagios = { itens: Pedagio[]; nextCursor: string | null };

export function usePedagios() {
  const cacheKey = "pedagios";
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

export function useCriarViagem() {
  const qc = useQueryClient();
  return async (input: {
    payload: Record<string, unknown>;
    foto?: { blob: Blob; mime: string };
  }) => {
    await enqueueViagem(input.payload, input.foto);
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
  valorTotal: string | null;
  precoLitro: string | null;
  emComboio: boolean;
  odometro: number;
  postoNome: string | null;
  tanqueCheio: boolean;
  observacao: string | null;
  lat: number | null;
  lng: number | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  empresa: { id: string; nome: string } | null;
  fotos: { id: string; storageKey: string }[];
};

export type ListaAbastecimentos = {
  itens: Abastecimento[];
  nextCursor: string | null;
};

export function useAbastecimentos(mes?: string) {
  const qs = mes ? `?mes=${mes}` : "";
  const cacheKey = `abastecimentos:${mes ?? "todos"}`;
  return useQuery({
    queryKey: ["abastecimentos", mes ?? "todos"],
    staleTime: 60_000,
    queryFn: async (): Promise<Abastecimento[]> => {
      try {
        const fresh = await api.get<ListaAbastecimentos>(`/m/abastecimentos${qs}`);
        void cachePut(cacheKey, fresh.itens).catch(() => {});
        return fresh.itens.map(normalizarAbastecimento);
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<Abastecimento[]>(cacheKey);
            if (cached) return cached.map(normalizarAbastecimento);
          } catch {
            /* */
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
    foto?: { blob: Blob; mime: string };
  }) => {
    await enqueueAbastecimento(input.payload, input.foto);
    void qc.invalidateQueries({ queryKey: ["abastecimentos"] });
    void qc.invalidateQueries({ queryKey: ["postos-recentes"] });
  };
}

export type RotaCalculada =
  | {
      km: string;
      duracaoSegundos: number;
      geometria: string | null;
      fonte: "osrm" | "cache";
    }
  | { km: null; erro: string };

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
  clienteIds?: string[];
  lat?: number;
  lng?: number;
  forcarCriacao?: boolean;
};

export function useCriarLocal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarLocalInput) =>
      normalizarLocal(await api.post<Local>("/m/locais", input)),
    onSuccess: (novo) => {
      qc.setQueryData<Catalogos>(["catalogos"], (cur) => {
        if (!cur) return cur;
        return { ...cur, locais: [...cur.locais, novo] };
      });
    },
  });
}

export type LocalProximo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  tipo: "CARGA" | "DESCARGA" | "AMBOS";
  lat: number | null;
  lng: number | null;
  nivelConfianca: string;
  clienteIds: string[];
  distanciaMetros: number;
  vezesUsadoMotorista: number;
};

/**
 * Busca locais cadastrados próximos das coords. Usado pelo botão
 * "Estou no local de descarga" pra match automático.
 */
export async function buscarLocaisProximos(input: {
  lat: number;
  lng: number;
  tipoUso?: "carga" | "descarga" | "ambos";
  raioM?: number;
  limit?: number;
}): Promise<LocalProximo[]> {
  const qs = new URLSearchParams({
    lat: String(input.lat),
    lng: String(input.lng),
  });
  if (input.tipoUso) qs.set("tipoUso", input.tipoUso);
  if (input.raioM != null) qs.set("raioM", String(input.raioM));
  if (input.limit != null) qs.set("limit", String(input.limit));
  const list = await api.get<LocalProximo[]>(`/m/locais/proximos?${qs.toString()}`);
  return list.map(normalizarLocal);
}

/**
 * Cria local rápido (só nome + GPS). Backend resolve endereço via reverse
 * geocoding. Local entra como RASCUNHO e vai pra fila Em Validação do dashboard.
 */
export function useCriarLocalRapido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nome: string;
      lat: number;
      lng: number;
      tipo: "CARGA" | "DESCARGA" | "AMBOS";
      clienteIds?: string[];
    }) => normalizarLocal(await api.post<Local>("/m/locais/rapido", input)),
    onSuccess: (novo) => {
      qc.setQueryData<Catalogos>(["catalogos"], (cur) => {
        if (!cur) return cur;
        return { ...cur, locais: [...cur.locais, novo] };
      });
    },
  });
}

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
      qc.setQueryData<
        { pages: NotificacoesPagina[]; pageParams: unknown[] } | undefined
      >(["notificacoes"], (cur) => {
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
          const naoLidas = pageIdx === 0 ? Math.max(0, p.naoLidas - decremento) : p.naoLidas;
          return { ...p, itens, naoLidas };
        });
        return { ...cur, pages };
      });
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

export function useExtrairTicket() {
  return useMutation({
    mutationFn: async (input: { fotoBase64: string; mime: string }) =>
      api.post<ExtrairTicketResult>("/m/ia/extrair-ticket", input),
  });
}

export function useTrocarSenha() {
  return useMutation({
    mutationFn: async (input: { senhaAtual: string; novaSenha: string }) =>
      api.post<{ ok: true }>("/m/auth/trocar-senha", input),
  });
}
