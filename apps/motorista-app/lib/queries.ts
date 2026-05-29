import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ExtrairTicketResult } from "@ronan/shared-types";
import { cacheGet, cachePut } from "@/db/database";
import { api, ApiError } from "./api";
import { reportarEvento } from "./event-reporter";
import { haversineMetros } from "./geo";
import { getRotaCache, setRotaCache } from "./rota-cache";
import { enqueueAbastecimento, enqueueLocal, enqueuePedagio, enqueueViagem } from "./sync";

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
  // Snapshot do km OSRM no momento do lançamento. Quando km !== kmCalculado,
  // motorista sobrescreveu o sugerido — exibimos os dois lado a lado.
  kmCalculado: string | null;
  // OCR de ticket via IA: campos preenchidos pela IA (e mantidos pelo
  // motorista) + confidence geral. Vazio se IA não rodou ou nada aplicado.
  ocrCampos: string[];
  ocrConfidence: number | null;
  // Derivados pelo backend (helper viagem-minimos) — quando ajustada=true,
  // toneladasEfetiva/kmEfetivo = piso do cliente; senão = valor informado.
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  kmInformado: string;
  kmEfetivo: string;
  kmAjustada: boolean;
  observacao: string | null;
  status: string;
  /** Texto explicando a divergência quando admin marca status=DIVERGENTE. */
  motivoStatus: string | null;
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

// Compat com cache local antigo (pré-rename Obra→Cliente 2026-05-20).
// Cache cru gravado antes do OTA novo tem `obra`/`obras`/`empresaCliente`;
// converte pro shape novo on-read pra não quebrar a UI.
function normalizarViagem<T extends { cliente?: unknown; obra?: unknown }>(v: T): T {
  if (!v) return v;
  const anyV = v as Record<string, unknown>;
  if (!anyV.cliente && anyV.obra) {
    const obra = anyV.obra as Record<string, unknown>;
    if (obra && obra.empresaCliente && !obra.empresa) {
      obra.empresa = obra.empresaCliente;
    }
    anyV.cliente = obra;
  }
  return v;
}

function normalizarCatalogos<T extends { clientes?: unknown; obras?: unknown; locais?: unknown }>(c: T): T {
  if (!c) return c;
  const anyC = c as Record<string, unknown>;
  if (!anyC.clientes && Array.isArray(anyC.obras)) {
    anyC.clientes = (anyC.obras as Array<Record<string, unknown>>).map((o) => {
      if (o && o.empresaCliente && !o.empresa) o.empresa = o.empresaCliente;
      return o;
    });
  }
  // Cache pré-empresas: garante o array, evita undefined no select de Empresa.
  if (!Array.isArray(anyC.empresas)) anyC.empresas = [];
  // Compat Local 1:N → N:N: cache antigo vinha com clienteId; novo vem com clienteIds[].
  if (Array.isArray(anyC.locais)) {
    anyC.locais = (anyC.locais as Array<Record<string, unknown>>).map(normalizarLocal);
  }
  return c;
}

// Cache pré-rename de Local (1 cliente → N clientes). Garante clienteIds: string[]
// pra qualquer payload — backend novo já manda, cache legado tinha clienteId único.
function normalizarLocal<T>(l: T): T {
  if (!l) return l;
  const anyL = l as unknown as Record<string, unknown>;
  if (Array.isArray(anyL.clienteIds)) return l;
  const legacy = anyL.clienteId as string | null | undefined;
  anyL.clienteIds = legacy ? [legacy] : [];
  return l;
}

// Cache pré-rename (Abastecimento ganhou campo empresa). Garante null em vez
// de undefined pra não quebrar exibição on-read do SQLite.
function normalizarAbastecimento<T extends { empresa?: unknown }>(a: T): T {
  if (!a) return a;
  const anyA = a as Record<string, unknown>;
  if (!("empresa" in anyA)) anyA.empresa = null;
  return a;
}

// Compat pra Me pré-rollout das feature flags. Backend antigo / cache local
// SQLite anterior à mudança não traz os campos `pode*`. Default true mantém
// compatibilidade: motorista sem essas chaves vê tudo (não quebra a UX).
function normalizarMe<T extends Record<string, unknown>>(m: T): T {
  if (!m) return m;
  const anyM = m as Record<string, unknown>;
  if (typeof anyM.podeLancarViagem !== "boolean") anyM.podeLancarViagem = true;
  if (typeof anyM.podeIniciarViagem !== "boolean") anyM.podeIniciarViagem = true;
  if (typeof anyM.podeLancarPedagio !== "boolean") anyM.podeLancarPedagio = true;
  if (typeof anyM.podeLancarAbastecimento !== "boolean") anyM.podeLancarAbastecimento = true;
  if (typeof anyM.podeUsarOcrTicket !== "boolean") anyM.podeUsarOcrTicket = true;
  return m;
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
  const base = offlineCacheQuery<Me>("me", "/m/me");
  return useQuery({
    ...base,
    queryFn: async () => normalizarMe(await base.queryFn()),
  });
}

export function useCatalogos() {
  const base = offlineCacheQuery<Catalogos>("catalogos", "/m/catalogos", { staleTime: 5 * 60_000 });
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
        return fresh.itens.map(normalizarViagem);
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<Viagem[]>(cacheKey);
            if (cached) return cached.map(normalizarViagem);
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
  localCarga: Viagem["localCarga"] & { logradouro: string; lat: number | null; lng: number | null };
  localDescarga: Viagem["localDescarga"] & { logradouro: string; lat: number | null; lng: number | null };
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
  // Null quando emComboio = true (motorista não soube o valor na hora).
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
        return fresh.itens.map(normalizarAbastecimento);
      } catch (err) {
        if (isOfflineError(err)) {
          try {
            const cached = await cacheGet<Abastecimento[]>(cacheKey);
            if (cached) return cached.map(normalizarAbastecimento);
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

/** Fator empírico de tortuosidade (distância em estrada / linha reta). */
const FATOR_HAVERSINE = 1.3;

export type FonteRota =
  | "osrm"
  | "cache_server"
  | "cache_local"
  | "estimado_haversine";

export type RotaCalculada =
  | {
      km: string;
      duracaoSegundos: number | null;
      geometria: string | null;
      fonte: FonteRota;
    }
  | { km: null; erro: string };

type RotaServerResponse =
  | {
      km: string;
      duracaoSegundos: number;
      geometria: string | null;
      fonte: "osrm" | "cache";
    }
  | { km: null; erro: string };

/**
 * Calcula KM da rota carga→descarga. Cascata:
 * 1. Backend OSRM (já tem cache server-side de 90d).
 * 2. Cache local (rotas que esse motorista calculou antes).
 * 3. Fallback haversine × 1.3 (linha reta entre lat/lng dos locais).
 * 4. Null se nem coords os locais têm.
 *
 * Eventos de telemetria são emitidos pra rastrear qual fonte resolveu.
 */
export function useCalcularRota(origemId?: string, destinoId?: string) {
  return useQuery<RotaCalculada>({
    queryKey: ["rota-calcular", origemId, destinoId],
    enabled: !!origemId && !!destinoId && origemId !== destinoId,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const oid = origemId!;
      const did = destinoId!;
      const t0 = Date.now();
      void reportarEvento("rota_calculo_iniciado", {
        origemId: oid,
        destinoId: did,
      });

      // 1) Server
      try {
        const res = await api.get<RotaServerResponse>(
          `/m/rotas/calcular?origem=${oid}&destino=${did}`,
        );
        if (res.km !== null) {
          // Salva no cache local pra próxima vez (mesmo motorista, mesma rota).
          void setRotaCache(oid, did, {
            km: res.km,
            duracaoSegundos: res.duracaoSegundos,
            geometria: res.geometria,
          });
          const fonte: FonteRota = res.fonte === "cache" ? "cache_server" : "osrm";
          void reportarEvento("rota_calculo_sucesso", {
            km: res.km,
            fonte,
            duracaoMs: Date.now() - t0,
          });
          return {
            km: res.km,
            duracaoSegundos: res.duracaoSegundos,
            geometria: res.geometria,
            fonte,
          };
        }
        // Server respondeu mas km=null. Tenta fallbacks antes de desistir.
        const fallback = await tentarFallbacks(oid, did, "osrm_indisponivel", res.erro);
        if (fallback) {
          void reportarEvento("rota_calculo_sucesso", {
            km: fallback.km,
            fonte: fallback.fonte,
            duracaoMs: Date.now() - t0,
          });
          return fallback;
        }
        void reportarEvento("rota_calculo_falhou", {
          motivo: "sem_coordenadas",
          apiErro: res.erro,
          origemId: oid,
          destinoId: did,
        });
        return { km: null, erro: res.erro } as RotaCalculada;
      } catch (err) {
        const isNet = err instanceof TypeError;
        const fallback = await tentarFallbacks(
          oid,
          did,
          isNet ? "offline" : "outro",
        );
        if (fallback) {
          void reportarEvento("rota_calculo_sucesso", {
            km: fallback.km,
            fonte: fallback.fonte,
            duracaoMs: Date.now() - t0,
          });
          return fallback;
        }
        void reportarEvento("rota_calculo_falhou", {
          motivo: isNet ? "offline_sem_cache_nem_coords" : "outro",
          apiErro: (err as Error)?.message,
          origemId: oid,
          destinoId: did,
        });
        return {
          km: null,
          erro: isNet
            ? "Sem internet e sem cálculo anterior dessa rota."
            : "Não foi possível calcular a rota agora.",
        } as RotaCalculada;
      }
    },
  });
}

/**
 * Tenta cache local primeiro, depois haversine. Retorna null se ambos
 * falharem (motivoBase é usado pra contexto do evento de falha).
 */
async function tentarFallbacks(
  origemId: string,
  destinoId: string,
  _motivoBase: string,
  _apiErro?: string,
): Promise<{ km: string; duracaoSegundos: number | null; geometria: string | null; fonte: FonteRota } | null> {
  // 2) Cache local
  const cached = await getRotaCache(origemId, destinoId);
  if (cached) {
    return {
      km: cached.km,
      duracaoSegundos: cached.duracaoSegundos ?? null,
      geometria: cached.geometria ?? null,
      fonte: "cache_local",
    };
  }
  // 3) Haversine — precisa de lat/lng dos locais (cache de catalogos)
  const catalogos = qcGlobalRef?.getQueryData<Catalogos>(["catalogos"]);
  if (!catalogos) return null;
  const origem = catalogos.locais.find((l) => l.id === origemId);
  const destino = catalogos.locais.find((l) => l.id === destinoId);
  if (
    !origem ||
    !destino ||
    origem.lat == null ||
    origem.lng == null ||
    destino.lat == null ||
    destino.lng == null
  ) {
    return null;
  }
  const metros = haversineMetros(origem.lat, origem.lng, destino.lat, destino.lng);
  const km = ((metros * FATOR_HAVERSINE) / 1000).toFixed(2);
  return {
    km,
    duracaoSegundos: null,
    geometria: null,
    fonte: "estimado_haversine",
  };
}

/**
 * Cache global do QueryClient (set em queryClient.ts ou _layout via
 * setQueryClient). Permitir acesso fora de hooks pra usar dentro de queryFn.
 */
let qcGlobalRef: ReturnType<typeof useQueryClient> | null = null;
export function setQueryClientGlobal(qc: ReturnType<typeof useQueryClient>): void {
  qcGlobalRef = qc;
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
  clienteIds?: string[];
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
 * Busca locais existentes perto do GPS dado. Usado pelo fluxo
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
/**
 * Cria local rápido offline-first. UUID é gerado client-side, o local
 * entra no cache de catalogos imediatamente, e a criação real no servidor
 * acontece via outbox (enqueueLocal). Quando viagem que referencia esse
 * local for sincronizar, drainLocais roda primeiro pra garantir a FK.
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
    }): Promise<Local> => {
      const clientId = gerarUuidLocal();
      const novoLocal: Local = {
        id: clientId,
        nome: input.nome,
        logradouro: "",
        numero: null,
        bairro: null,
        cidade: "",
        uf: "",
        pontoReferencia: null,
        tipo: input.tipo,
        clienteIds: input.clienteIds ?? [],
        lat: input.lat,
        lng: input.lng,
      };
      await enqueueLocal({
        clientId,
        payload: {
          nome: input.nome,
          lat: input.lat,
          lng: input.lng,
          tipo: input.tipo,
          clienteIds: input.clienteIds,
        },
        status: "pending",
        attempts: 0,
        createdAt: Date.now(),
      });
      return normalizarLocal(novoLocal);
    },
    onSuccess: (novo) => {
      qc.setQueryData<Catalogos>(["catalogos"], (cur) => {
        if (!cur) return cur;
        return { ...cur, locais: [...cur.locais, novo] };
      });
    },
  });
}

function gerarUuidLocal(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Versão offline de buscarLocaisProximos: usa o catálogo cacheado em vez de
 * chamar o servidor. Fallback pra quando o motorista está sem internet.
 * Sem vezesUsadoMotorista (não temos o histórico cá fora) — sempre 0.
 */
export function buscarLocaisProximosOffline(input: {
  lat: number;
  lng: number;
  locais: Local[];
  tipoUso?: "carga" | "descarga" | "ambos";
  raioM?: number;
  limit?: number;
}): LocalProximo[] {
  const raio = input.raioM ?? 500;
  const limit = input.limit ?? 5;
  const tiposPermitidos: Array<Local["tipo"]> =
    input.tipoUso === "carga"
      ? ["CARGA", "AMBOS"]
      : input.tipoUso === "descarga"
        ? ["DESCARGA", "AMBOS"]
        : ["CARGA", "DESCARGA", "AMBOS"];

  const matches: LocalProximo[] = [];
  for (const l of input.locais) {
    if (l.lat == null || l.lng == null) continue;
    if (!tiposPermitidos.includes(l.tipo)) continue;
    const d = haversineMetros(input.lat, input.lng, l.lat, l.lng);
    if (d > raio) continue;
    matches.push({
      id: l.id,
      nome: l.nome,
      cidade: l.cidade,
      uf: l.uf,
      tipo: l.tipo,
      lat: l.lat,
      lng: l.lng,
      nivelConfianca: "OFFLINE",
      clienteIds: l.clienteIds,
      distanciaMetros: Math.round(d),
      vezesUsadoMotorista: 0,
    });
  }
  matches.sort((a, b) => a.distanciaMetros - b.distanciaMetros);
  return matches.slice(0, limit);
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

/**
 * OCR de ticket via Claude vision. Best-effort: motorista preenche manual
 * se chamada falhar (sem internet, IA off, etc). Sem retry — uma tentativa
 * só por foto. Timeout no client é controlado pelo `api.post`.
 */
export function useExtrairTicket() {
  return useMutation({
    mutationFn: async (input: { fotoBase64: string; mime: string }) =>
      api.post<ExtrairTicketResult>("/m/ia/extrair-ticket", input),
  });
}
