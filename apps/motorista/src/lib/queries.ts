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
import { reportarEvento } from "./event-reporter";
import { haversineMetros } from "./geo";
import { getRotaCache, setRotaCache } from "./rota-cache";
import {
  drainLocais,
  enqueueAbastecimento,
  enqueueLocal,
  enqueuePedagio,
  enqueueViagem,
} from "./sync";

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
  /** Texto explicando a divergência quando admin marca status=DIVERGENTE. */
  motivoStatus: string | null;
  /** Quando preenchido, app mostra UI dedicada pra resolver. */
  tipoDivergencia: "PEDAGIO_SEM_VALOR" | "FOTO_ILEGIVEL" | "OUTRO" | null;
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

let qcGlobalRef: ReturnType<typeof useQueryClient> | null = null;
export function setQueryClientGlobal(qc: ReturnType<typeof useQueryClient>): void {
  qcGlobalRef = qc;
}

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
      void reportarEvento("rota_calculo_iniciado", { origemId: oid, destinoId: did });

      try {
        const res = await api.get<RotaServerResponse>(
          `/m/rotas/calcular?origem=${oid}&destino=${did}`,
        );
        if (res.km !== null) {
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
        const fallback = await tentarFallbacks(oid, did);
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
        const fallback = await tentarFallbacks(oid, did);
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

export type PedagioNaRota = {
  id: string;
  nome: string;
  rodovia: string | null;
  concessionaria: string | null;
  distanciaMetros: number;
  lat: number;
  lng: number;
};

/**
 * Pedágios cadastrados na rota OSRM cacheada (origem→destino). Usado só
 * pra alertar o motorista ao salvar viagem sem valor de pedágio. Retorna
 * [] silenciosamente se offline ou rota nunca calculada.
 */
export function usePedagiosNaRota(origemId?: string, destinoId?: string) {
  return useQuery<PedagioNaRota[]>({
    queryKey: ["pedagios-na-rota", origemId, destinoId],
    enabled: !!origemId && !!destinoId && origemId !== destinoId,
    // Pedágios mudam pouco mas mudam (admin cadastra/exclui via dashboard);
    // 5min equilibra latência do alerta vs. reflexo de mudanças.
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      try {
        return await api.get<PedagioNaRota[]>(
          `/m/pedagios-rodovia/na-rota?origem=${origemId}&destino=${destinoId}`,
        );
      } catch {
        return [];
      }
    },
  });
}

async function tentarFallbacks(
  origemId: string,
  destinoId: string,
): Promise<
  | { km: string; duracaoSegundos: number | null; geometria: string | null; fonte: FonteRota }
  | null
> {
  const cached = await getRotaCache(origemId, destinoId);
  if (cached) {
    return {
      km: cached.km,
      duracaoSegundos: cached.duracaoSegundos ?? null,
      geometria: cached.geometria ?? null,
      fonte: "cache_local",
    };
  }
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
  return { km, duracaoSegundos: null, geometria: null, fonte: "estimado_haversine" };
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

/**
 * Responde divergência FOTO_ILEGIVEL anexando foto nova. Direct call
 * (upload + POST), sem outbox — se offline, falha e usuário tenta de novo.
 */
export function useResponderFotoDivergente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      viagemId: string;
      fotoBlob: Blob;
      fotoMime: string;
    }) => {
      const fd = new FormData();
      const filename = `ticket-${args.viagemId}.${
        args.fotoMime.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", args.fotoBlob, filename);
      const up = await api.postForm<{ storageKey: string }>(
        "/m/uploads/ticket",
        fd,
      );
      return await api.post<ViagemDetalhe>(
        `/m/viagens/${args.viagemId}/responder-foto-divergente`,
        { fotoKey: up.storageKey },
      );
    },
    onSuccess: (atualizada) => {
      qc.setQueryData(["viagem-detalhe", atualizada.id], atualizada);
      void qc.invalidateQueries({ queryKey: ["viagens"] });
      void qc.invalidateQueries({ queryKey: ["viagens-filtradas"] });
      void qc.invalidateQueries({ queryKey: ["resumo-mes"] });
    },
  });
}

/**
 * Informa valor de pedágio em viagem que o admin recusou por essa razão.
 * Backend muda pra AJUSTADA e limpa o tipoDivergencia.
 */
export function useInformarValorPedagio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { viagemId: string; valor: number }) => {
      return await api.post<ViagemDetalhe>(
        `/m/viagens/${args.viagemId}/informar-valor-pedagio`,
        { valor: args.valor },
      );
    },
    onSuccess: (atualizada) => {
      qc.setQueryData(["viagem-detalhe", atualizada.id], atualizada);
      void qc.invalidateQueries({ queryKey: ["viagens"] });
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
 * Versão offline de buscarLocaisProximos: filtra o catálogo cacheado
 * client-side. Sem vezesUsadoMotorista (não temos o histórico) — sempre 0.
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
 * Cria local rápido (só nome + GPS). Backend resolve endereço via reverse
 * geocoding. Local entra como RASCUNHO e vai pra fila Em Validação do dashboard.
 */
/**
 * Cria local rápido offline-first. UUID client-side, cache otimista,
 * outbox sincroniza depois com idempotência no backend (mesma pattern
 * da viagem). Drain processa locais antes de viagens (FK).
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
      // Espera o local sincronizar no backend ANTES de retornar — assim
      // a próxima chamada (useCalcularRota) encontra o local e calcula via
      // OSRM. Se offline, drainLocais retorna rapido sem fazer nada.
      await drainLocais();
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
