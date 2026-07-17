import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ExtrairTicketResult,
  FonteGps,
  ReferenciaKmPayload,
  StatusMotorista,
  StoryEmoji,
  StoryFeedResponse,
  StoryItem,
  StoryVisualizador,
  TipoEventoViagem as TipoEventoViagemApp,
} from "@ronan/shared-types";
import { cacheGet, cachePut, listPendingStories, type PendingStory } from "@/db/database";
import { api, ApiError } from "./api";
import { reportarEvento } from "./event-reporter";
import { haversineMetros } from "./geo";
import {
  pedagiosNaLinhaReta,
  pedagiosNaRotaOffline,
  type PedagioCadastrado,
} from "./pedagios-offline";
import { getRotaCache, setRotaCache } from "./rota-cache";
import { getKmReferenciaCache, setKmReferenciaCache } from "./km-referencia-cache";
import {
  drainLocais,
  enqueueAbastecimento,
  enqueueCompletarPeso,
  enqueueLocal,
  enqueuePedagio,
  enqueueStory,
  enqueueViagem,
  onSyncChange,
} from "./sync";

export type Veiculo = {
  id: string;
  placa: string;
  modelo: string | null;
  // Último odômetro registrado (servidor) pra validar abastecimento na
  // digitação. Opcional: cache offline antigo não tem o campo.
  ultimoOdometro?: number | null;
};

export type Material = {
  id: string;
  nome: string;
  exigeTicket?: boolean;
  // Admin liberou "voltar pro bota-fora" (limpeza) pra esse material: o app
  // mostra a pergunta e soma a perna de volta no km. Cache antigo não tem o campo.
  permiteBotaFora?: boolean;
};

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
  status: StatusMotorista;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  veiculos: Veiculo[];
  ultimoLoginEm: string | null;
  podeLancarViagem: boolean;
  podeIniciarViagem: boolean;
  podeViagemLifecycle: boolean;
  podeLancarPedagio: boolean;
  podeLancarAbastecimento: boolean;
  podeUsarOcrTicket: boolean;
  podeVerStories: boolean;
  // Quando true, mostra "Buscar local por nome" na descarga (todos os locais).
  podeVerTodosLocais: boolean;
  // Quando true, mostra a sugestão de km do trajeto ("já rodaram ~X km") ao
  // escolher carga+descarga. Rollout gradual — opt-in.
  podeReferenciaKm: boolean;
  // Preferências de recebimento (controladas na tela de perfil).
  aceitaPush: boolean;
  aceitaWhatsapp: boolean;
  receberResumoDiario: boolean;
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
  /** Quando preenchido, app mostra UI dedicada pra resolver (ex: card
   * pedindo só o valor do pedágio). Limpo após motorista resolver. */
  tipoDivergencia:
    | "PEDAGIO_SEM_VALOR"
    | "FOTO_ILEGIVEL"
    | "KM_DIVERGENTE"
    | "OUTRO"
    | null;
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
  // Trechos adicionais do trajeto (retorno do bota-fora hoje). Vazio na viagem
  // normal. km já somado no `km` acima. Cache antigo não tem o campo.
  trechos?: {
    id: string;
    ordem: number;
    tipo: "RETORNO_BOTA_FORA" | "ENTREGA";
    km: string;
    local: { id: string; nome: string; cidade: string; uf: string };
  }[];
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
  // Lifecycle é opt-in: cache antigo sem a flag assume desligado.
  if (typeof anyM.podeViagemLifecycle !== "boolean") anyM.podeViagemLifecycle = false;
  if (typeof anyM.podeLancarPedagio !== "boolean") anyM.podeLancarPedagio = true;
  if (typeof anyM.podeLancarAbastecimento !== "boolean") anyM.podeLancarAbastecimento = true;
  if (typeof anyM.podeUsarOcrTicket !== "boolean") anyM.podeUsarOcrTicket = true;
  // Opt-in: cache antigo / motorista sem o flag NÃO vê o "buscar todos os locais".
  if (typeof anyM.podeVerTodosLocais !== "boolean") anyM.podeVerTodosLocais = false;
  // Opt-in: cache antigo / motorista sem o flag NÃO vê a sugestão de km.
  if (typeof anyM.podeReferenciaKm !== "boolean") anyM.podeReferenciaKm = false;
  // Backend antigo/cache sem as prefs: assume que recebe tudo (default true).
  if (typeof anyM.aceitaPush !== "boolean") anyM.aceitaPush = true;
  if (typeof anyM.aceitaWhatsapp !== "boolean") anyM.aceitaWhatsapp = true;
  if (typeof anyM.receberResumoDiario !== "boolean") anyM.receberResumoDiario = true;
  return m;
}

/**
 * useQuery **cache-first** com revalidação em segundo plano.
 *
 * Por que cache-first (e não network-first como antes): em 4G fraco a conexão
 * abre mas se arrasta — o fetch não falha rápido, ele pendura até o timeout.
 * Se esperássemos a rede pra só então cair pro cache, o motorista ficaria
 * ~8-40s no spinner mesmo já tendo o dado cacheado. Aqui: se há cache local,
 * devolvemos ele NA HORA e revalidamos em background (grava o fresco no
 * QueryClient via `qcGlobalRef.setQueryData` quando a rede responder). Só
 * esperamos a rede no primeiro uso (sem cache ainda).
 *
 * `normalize` roda tanto no cache lido quanto no dado fresco — mantém a compat
 * on-read (renames antigos, feature flags) consistente nos dois caminhos, sem
 * precisar embrulhar a queryFn por fora (que deixaria o dado da revalidação
 * em background entrar cru no cache do QueryClient).
 *
 * Cache writes em void/catch pra erro de SQLite não quebrar a query.
 */
/**
 * Núcleo cache-first compartilhado. Se há cache local, devolve NA HORA e
 * revalida em background (grava o fresco no QueryClient via setQueryData). Só
 * espera a rede no primeiro uso (sem cache). Usado pelo `offlineCacheQuery`
 * (dados-base) e pelas queries de lista (que têm queryKey composta e/ou
 * transformam a resposta antes de cachear).
 *
 * - `buscarRede` é responsável por buscar + normalizar + cachear (cachePut).
 * - `lerCache` reaplica a compat on-read no valor cacheado (default: identidade).
 */
async function cacheFirst<T>(
  queryKey: readonly unknown[],
  cacheKey: string,
  buscarRede: () => Promise<T>,
  lerCache: (bruto: T) => T = (x) => x,
): Promise<T> {
  let cached: T | null = null;
  try {
    cached = await cacheGet<T>(cacheKey);
  } catch {
    /* sqlite indisponivel */
  }
  if (cached != null) {
    // Revalida em background — não trava a UI, a tela já tem o cache.
    void buscarRede()
      .then((fresh) => {
        qcGlobalRef?.setQueryData(queryKey, fresh);
      })
      .catch(() => {
        /* offline/4G ruim: fica com o cache, revalida no próximo gatilho */
      });
    return lerCache(cached);
  }
  // Primeiro uso (sem cache): precisa esperar a rede (timeout curto em api.ts).
  return await buscarRede();
}

function offlineCacheQuery<T>(
  key: string,
  path: string,
  opts: { staleTime?: number; normalize?: (raw: T) => T } = {},
) {
  const cacheKey = `q:${key}`;
  const normalize = opts.normalize ?? ((x: T) => x);
  const buscarRede = async (): Promise<T> => {
    const fresh = normalize(await api.get<T>(path));
    void cachePut(cacheKey, fresh).catch(() => {});
    return fresh;
  };
  return {
    queryKey: [key],
    staleTime: opts.staleTime ?? 60_000,
    queryFn: () => cacheFirst<T>([key], cacheKey, buscarRede, normalize),
  };
}

export function useMe() {
  return useQuery(offlineCacheQuery<Me>("me", "/m/me", { normalize: normalizarMe }));
}

/**
 * Salva as preferências de notificação (push / WhatsApp). Otimista: atualiza o
 * cache do `me` na hora e reverte se a rede falhar.
 */
export function useSalvarPreferenciasNotificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: {
      aceitaPush?: boolean;
      aceitaWhatsapp?: boolean;
      receberResumoDiario?: boolean;
    }) => api.patch<Me>("/m/me/preferencias-notificacao", prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: ["me"] });
      const anterior = qc.getQueryData<Me>(["me"]);
      qc.setQueryData<Me>(["me"], (cur) =>
        cur ? { ...cur, ...prefs } : cur,
      );
      return { anterior };
    },
    onError: (_e, _prefs, ctx) => {
      if (ctx?.anterior) qc.setQueryData(["me"], ctx.anterior);
    },
    onSuccess: (fresh) => {
      qc.setQueryData(["me"], normalizarMe(fresh));
      void cachePut("q:me", normalizarMe(fresh)).catch(() => {});
    },
  });
}

export function useCatalogos() {
  return useQuery(
    offlineCacheQuery<Catalogos>("catalogos", "/m/catalogos", {
      staleTime: 5 * 60_000,
      normalize: normalizarCatalogos,
    }),
  );
}

/**
 * Baixa e persiste os dados-base pro uso offline (catálogos + perfil + tipos de
 * evento). Chamado ao logar/reconectar — assim quem logou (login exige net) já
 * tem tudo cacheado antes de ficar sem sinal. Best-effort: nunca lança
 * (prefetchQuery engole o erro) e o staleTime deduplica chamadas seguidas.
 */
export async function prefetchDadosBase(qc: QueryClient): Promise<void> {
  const cat = offlineCacheQuery<Catalogos>("catalogos", "/m/catalogos", {
    staleTime: 5 * 60_000,
    normalize: normalizarCatalogos,
  });
  const me = offlineCacheQuery<Me>("me", "/m/me", { normalize: normalizarMe });
  const tipos = offlineCacheQuery<TipoEventoViagemApp[]>(
    "tipos-evento",
    "/m/viagem/tipos-evento",
    { staleTime: 5 * 60_000 },
  );
  // Config de busca (raios + captura de GPS): cacheada aqui pra o offline usar
  // os raios do painel mesmo se o motorista mudou a config e perdeu o sinal.
  const buscaCfg = offlineCacheQuery<BuscaGpsConfig>(
    "busca-locais-config",
    "/m/busca-locais-config",
    { staleTime: 5 * 60_000 },
  );
  await Promise.allSettled([
    qc.prefetchQuery(cat),
    qc.prefetchQuery(me),
    qc.prefetchQuery(tipos),
    qc.prefetchQuery(buscaCfg),
    prefetchKmReferencia(qc),
  ]);
}

/**
 * Pré-baixa a referência de km dos pares que o motorista roda e semeia o cache
 * local por par — assim a sugestão aparece offline (rota que ele repete). Só
 * quando a flag está ligada; best-effort, nunca derruba o prefetch geral.
 */
async function prefetchKmReferencia(qc: QueryClient): Promise<void> {
  try {
    const me = qc.getQueryData<Me>(["me"]) ?? (await api.get<Me>("/m/me"));
    if (me?.podeReferenciaKm !== true) return;
    const { pares } = await api.get<{
      pares: Array<ReferenciaKmPayload & { cargaId: string; descargaId: string }>;
    }>("/m/km-referencia/meus-pares?dias=60");
    await Promise.allSettled(
      pares.map(({ cargaId, descargaId, ...payload }) =>
        setKmReferenciaCache(cargaId, descargaId, payload),
      ),
    );
  } catch {
    /* offline / flag off / sem pares — silencioso */
  }
}

/** Catálogo dinâmico de tipos de evento (lifecycle guiado). Cacheado offline. */
export function useCatalogoEventos() {
  return useQuery(
    offlineCacheQuery<TipoEventoViagemApp[]>("tipos-evento", "/m/viagem/tipos-evento", {
      staleTime: 5 * 60_000,
    }),
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
  const buscarRede = async (): Promise<Viagem[]> => {
    const fresh = await api.get<ListaViagens>("/m/viagens?limit=10");
    const itens = fresh.itens.map(normalizarViagem);
    void cachePut(cacheKey, itens).catch(() => {});
    return itens;
  };
  return useQuery({
    queryKey: ["viagens"],
    staleTime: 60_000,
    queryFn: () =>
      cacheFirst<Viagem[]>(["viagens"], cacheKey, buscarRede, (arr) =>
        arr.map(normalizarViagem),
      ),
  });
}

export function useResumoMes(mes?: string) {
  const path = mes ? `/m/viagens/resumo?mes=${mes}` : "/m/viagens/resumo";
  const cacheKey = `q:resumo:${mes ?? "atual"}`;
  const queryKey = ["resumo-mes", mes ?? "atual"];
  const buscarRede = async (): Promise<ResumoMes> => {
    const fresh = await api.get<ResumoMes>(path);
    void cachePut(cacheKey, fresh).catch(() => {});
    return fresh;
  };
  return useQuery({
    queryKey,
    staleTime: 60_000,
    queryFn: () => cacheFirst<ResumoMes>(queryKey, cacheKey, buscarRede),
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
  // Reprocessamento de km (viagem criada sem sinal, recalculada pelo servidor).
  // kmRecalculadoEm null = não recalculada; kmAntesRecalculo = km antes (pra "de X → Y").
  kmRecalculadoEm: string | null;
  kmAntesRecalculo: string | null;
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
  const buscarRede = async (): Promise<Pedagio[]> => {
    const fresh = await api.get<ListaPedagios>("/m/pedagios?limit=10");
    void cachePut(cacheKey, fresh.itens).catch(() => {});
    return fresh.itens;
  };
  return useQuery({
    queryKey: ["pedagios"],
    staleTime: 60_000,
    queryFn: () => cacheFirst<Pedagio[]>(["pedagios"], cacheKey, buscarRede),
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
    // (A viagem "aguardando peso" só entra na lista após sincronizar — a própria
    // useViagensAguardandoPeso reavalia via onSyncChange quando o sync cai.)
    void qc.invalidateQueries({ queryKey: ["viagens"] });
    void qc.invalidateQueries({ queryKey: ["viagens-filtradas"] });
    void qc.invalidateQueries({ queryKey: ["viagens-aguardando-peso"] });
    void qc.invalidateQueries({ queryKey: ["resumo-mes"] });
  };
}

/**
 * Viagens lançadas sem peso (AGUARDANDO_PESO) que esperam o romaneio. Alimenta
 * o banner da home e a tela "aguardando peso". Cache-first pra abrir na hora.
 */
export function useViagensAguardandoPeso() {
  const qc = useQueryClient();
  const cacheKey = "q:viagens-aguardando-peso";
  const buscarRede = async (): Promise<Viagem[]> => {
    const fresh = await api.get<Viagem[]>("/m/viagens/aguardando-peso");
    const itens = fresh.map(normalizarViagem);
    void cachePut(cacheKey, itens).catch(() => {});
    return itens;
  };
  const query = useQuery({
    queryKey: ["viagens-aguardando-peso"],
    staleTime: 30_000,
    queryFn: () =>
      cacheFirst<Viagem[]>(
        ["viagens-aguardando-peso"],
        cacheKey,
        buscarRede,
        (arr) => arr.map(normalizarViagem),
      ),
  });

  // A viagem entra/sai dessa lista pelo SERVIDOR, mas criar/completar é
  // offline-first (outbox → sync em background). Sem isso, o card só atualizava
  // no staleTime (podia demorar). Aqui reavaliamos assim que o outbox sincroniza
  // — debounce pra colapsar a rajada de notify() de um drain num refetch só.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onSyncChange(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["viagens-aguardando-peso"] });
      }, 1200);
    });
    return () => {
      if (t) clearTimeout(t);
      off();
    };
  }, [qc]);

  return query;
}

/**
 * Offline-first: enfileira o "completar peso" (toneladas + ticket) de uma
 * viagem AGUARDANDO_PESO. Sync real (POST) acontece em background quando online.
 */
export function useCompletarPeso() {
  const qc = useQueryClient();
  return async (input: { viagemId: string; toneladas: number; ticket?: string }) => {
    // Some da lista/banner NA HORA (otimista). Se o envio falhar (ex: ticket
    // duplicado), o refetch pós-sync traz de volta e o erro aparece em Pendentes.
    const semItem = (cur?: Viagem[] | null): Viagem[] | undefined =>
      cur ? cur.filter((v) => v.id !== input.viagemId) : undefined;
    qc.setQueryData<Viagem[]>(["viagens-aguardando-peso"], semItem);
    // Espelha no cache em disco: o cache-first relê do AsyncStorage no próximo
    // refetch, senão o item "ressuscitava" até o servidor confirmar.
    try {
      const disk = await cacheGet<Viagem[]>("q:viagens-aguardando-peso");
      if (disk) await cachePut("q:viagens-aguardando-peso", semItem(disk) ?? []);
    } catch {
      /* cache indisponível — ignora */
    }
    await enqueueCompletarPeso(input);
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
  const queryKey = ["abastecimentos", mes ?? "todos"];
  const buscarRede = async (): Promise<Abastecimento[]> => {
    const fresh = await api.get<ListaAbastecimentos>(`/m/abastecimentos${qs}`);
    const itens = fresh.itens.map(normalizarAbastecimento);
    void cachePut(cacheKey, itens).catch(() => {});
    return itens;
  };
  return useQuery({
    queryKey,
    staleTime: 60_000,
    queryFn: () =>
      cacheFirst<Abastecimento[]>(queryKey, cacheKey, buscarRede, (arr) =>
        arr.map(normalizarAbastecimento),
      ),
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
/**
 * Config do motorista pra compartilhar posição periódica (controle de frota).
 * Opt-in: ativada=false por default. Janela horária null/null = 24/7.
 */
export type PosicaoConfig = {
  ativada: boolean;
  horarioInicio: number | null;
  horarioFim: number | null;
};

export function usePosicaoConfig() {
  return useQuery({
    queryKey: ["posicao-config"],
    queryFn: () => api.get<PosicaoConfig>("/m/posicao-config"),
    staleTime: 60_000,
  });
}

export function useSalvarPosicaoConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PosicaoConfig) =>
      api.put<PosicaoConfig>("/m/posicao-config", input),
    onSuccess: (data) => {
      qc.setQueryData(["posicao-config"], data);
    },
  });
}

export function useTrackingConfig() {
  return useQuery(
    offlineCacheQuery<TrackingConfig>("tracking-config", "/m/tracking-config", {
      staleTime: 5 * 60_000,
    }),
  );
}

/** Config da captura de GPS no "Estou no local de descarga" (editável no admin). */
export type BuscaGpsConfig = {
  // Raios da busca de locais por GPS (2 etapas). Cacheados offline pra a busca
  // local respeitar a config do painel mesmo sem sinal.
  raioInicialM: number;
  raioAmpliadoM: number;
  gpsAlvoMetros: number;
  gpsMaxSegundos: number;
  gpsLimiteSinalFracoM: number;
};

export const BUSCA_GPS_CONFIG_DEFAULTS: BuscaGpsConfig = {
  raioInicialM: 50,
  raioAmpliadoM: 500,
  gpsAlvoMetros: 10,
  gpsMaxSegundos: 20,
  gpsLimiteSinalFracoM: 50,
};

/**
 * Cacheia agressivo + offline. Falhou em buscar → usa defaults.
 * Revalidado a cada 5min (além do cold-start via prefetchDadosBase) — os raios
 * de busca afetam operação, então mudança no painel deve chegar rápido ao
 * motorista sem esperar demais. O clique de "Estou no local de descarga" lê o
 * valor já em memória, sem rede.
 */
export function useBuscaGpsConfig() {
  return useQuery(
    offlineCacheQuery<BuscaGpsConfig>("busca-locais-config", "/m/busca-locais-config", {
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

/** Uma rota alternativa do OSRM (contrato do endpoint /m/rotas/alternativas). */
export type RotaOption = {
  km: string;
  duracaoSegundos: number;
  geometria: string | null;
  recomendada: boolean;
  /** Só em /m/rotas/opcoes: true = COM retorno (curb), false = SEM retorno (direto). */
  retorno?: boolean;
};

type AlternativasResponse = { rotas: RotaOption[] } | { rotas: []; erro: string };

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
 * Referência de km do trajeto (o que a frota já rodou nesse par). Cache-first
 * igual ao useCalcularRota: tenta a rede, salva no cache local e cai no cache
 * quando offline. Gateada pela flag podeReferenciaKm — sem ela, nem busca.
 * Devolve null (sem erro) quando não há sinal nem cache: a sugestão só some.
 */
export function useReferenciaKm(cargaId?: string, destinoId?: string) {
  const me = useMe();
  const habilitado =
    me.data?.podeReferenciaKm === true &&
    !!cargaId &&
    !!destinoId &&
    cargaId !== destinoId;
  return useQuery<ReferenciaKmPayload | null>({
    queryKey: ["km-referencia", cargaId, destinoId],
    enabled: habilitado,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const cid = cargaId!;
      const did = destinoId!;
      try {
        const res = await api.get<ReferenciaKmPayload>(
          `/m/km-referencia?carga=${cid}&descarga=${did}`,
        );
        void setKmReferenciaCache(cid, did, res);
        return res;
      } catch {
        // Offline / erro: usa o cache (pré-baixado no login ou de uma consulta
        // anterior). Sem cache → null, a sugestão simplesmente não aparece.
        return (await getKmReferenciaCache(cid, did)) ?? null;
      }
    },
  });
}

/**
 * Busca as rotas alternativas (até 3) carga→descarga pro seletor de mapa.
 * Online-only: sem fallback offline. Se falhar/offline, retorna [] e a tela
 * segue com useCalcularRota (haversine/cache) e km editável. O seletor só
 * aparece quando o resultado tem mais de 1 rota.
 */
export function useRotasAlternativas(origemId?: string, destinoId?: string) {
  return useQuery<RotaOption[]>({
    queryKey: ["rota-alternativas", origemId, destinoId],
    enabled: !!origemId && !!destinoId && origemId !== destinoId,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const res = await api.get<AlternativasResponse>(
          `/m/rotas/alternativas?origem=${origemId!}&destino=${destinoId!}`,
        );
        return res.rotas ?? [];
      } catch {
        return [];
      }
    },
  });
}

/**
 * Busca as variantes COM retorno vs SEM retorno do mesmo par (endpoint
 * /m/rotas/opcoes). Online-only, sem fallback: offline/erro → []. Devolve 2
 * opções só quando há retorno real (o backend faz dedup); com 0 ou 1 o app não
 * mostra escolha. `enabled` extra permite desligar (ex.: modo edição).
 */
export function useOpcoesRota(origemId?: string, destinoId?: string, enabled = true) {
  return useQuery<RotaOption[]>({
    queryKey: ["rota-opcoes", origemId, destinoId],
    enabled: enabled && !!origemId && !!destinoId && origemId !== destinoId,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const res = await api.get<AlternativasResponse>(
          `/m/rotas/opcoes?origem=${origemId!}&destino=${destinoId!}`,
        );
        return res.rotas ?? [];
      } catch {
        return [];
      }
    },
  });
}

// ---- Navegação ao vivo (Valhalla, guia estilo Waze) ----

/** Uma manobra da navegação (Valhalla, já em pt-BR). Ver NavegacaoService no backend. */
export type ManobraNav = {
  instrucao: string;
  verbalPre: string | null;
  verbalAlerta: string | null;
  tipo: number;
  distanciaKm: number;
  beginShapeIndex: number;
  endShapeIndex: number;
};

/** Rota de navegação: shape (polyline PRECISÃO 6) + manobras. */
export type RotaNav = {
  shape: string;
  maneuvers: ManobraNav[];
  distanciaKm: number;
  tempoSeg: number;
};

type NavResponse = RotaNav | { erro: string };

/**
 * Busca a navegação ao vivo (Valhalla) da posição ATUAL do motorista até o Local
 * de destino. Online-only (o guia só faz sentido com internet). Retorna null em
 * erro/offline — o app cai no botão "Navegar no Waze".
 */
export async function buscarNavegacao(
  origemLat: number,
  origemLng: number,
  destinoId: string,
): Promise<RotaNav | null> {
  try {
    const res = await api.post<NavResponse>("/m/rotas/navegar", {
      origemLat,
      origemLng,
      destinoId,
    });
    if ("erro" in res) return null;
    return res;
  } catch {
    return null;
  }
}

export type PedagioNaRota = {
  id: string;
  nome: string;
  rodovia: string | null;
  concessionaria: string | null;
  distanciaMetros: number;
  lat: number;
  lng: number;
  /** True quando vem do fallback de linha reta (sem polyline real, offline
   * com rota nova). UI deve avisar "provavelmente passa por". */
  aproximado?: boolean;
};

// Cache local de TODOS os pedágios cadastrados — permite calcular alerta
// "rota passa por pedágio" 100% offline. ~950 pontos × ~100B = ~100KB.
const PEDAGIOS_CACHE_KEY = "ronan.pedagios-cadastrados-v1";
const PEDAGIOS_REFRESH_MS = 24 * 60 * 60_000;

/**
 * Lista compacta de pedágios cadastrados. Refresh em background a cada 24h.
 * Salva backup no AsyncStorage pra ler quando offline. Sempre retorna algo
 * se o motorista já abriu o app online pelo menos 1 vez.
 */
export function usePedagiosCadastrados() {
  return useQuery<PedagioCadastrado[]>({
    queryKey: ["pedagios-cadastrados"],
    staleTime: PEDAGIOS_REFRESH_MS,
    retry: false,
    queryFn: async () => {
      try {
        const lista = await api.get<PedagioCadastrado[]>("/m/pedagios-rodovia");
        await AsyncStorage.setItem(
          PEDAGIOS_CACHE_KEY,
          JSON.stringify(lista),
        );
        return lista;
      } catch {
        // Offline: cai no cache local salvo da última sincronização.
        try {
          const raw = await AsyncStorage.getItem(PEDAGIOS_CACHE_KEY);
          if (raw) return JSON.parse(raw) as PedagioCadastrado[];
        } catch {
          /* ignora */
        }
        return [];
      }
    },
  });
}

/**
 * Pedágios cadastrados que ficam na rota (origem→destino). Calcula 100%
 * offline quando tem geometria cacheada + lista de pedágios — alerta no
 * salvar funciona mesmo sem internet, desde que o motorista tenha aberto
 * o app online pelo menos 1x nos últimos 24h.
 *
 * Fluxo:
 * 1) Lê geometria do cache da query useCalcularRota (mesma tela já chama)
 * 2) Lê pedágios do cache local
 * 3) Roda haversine ponto-segmento — mesma lógica do backend
 * 4) Fallback: se sem geometria local, tenta endpoint server
 */
export function usePedagiosNaRota(origemId?: string, destinoId?: string) {
  const qc = useQueryClient();
  const cadastrados = usePedagiosCadastrados();
  const rotaQuery = useCalcularRota(origemId, destinoId);
  const rota = rotaQuery.data;
  const geometria =
    rota && "geometria" in rota ? rota.geometria ?? null : null;
  const pedagios = cadastrados.data ?? [];
  const geomKey = geometria
    ? geometria.length + ":" + geometria.slice(0, 8)
    : "none";

  return useQuery<PedagioNaRota[]>({
    queryKey: [
      "pedagios-na-rota",
      origemId,
      destinoId,
      pedagios.length,
      geomKey,
    ],
    // Não bloqueia em isFetched do cadastrados/rota — se queries dependentes
    // demoram ou falham, o queryFn abaixo lida (com fallback online). Bloquear
    // aqui causa "alerta nunca aparece" se uma das dependências entrar em erro.
    enabled:
      !!origemId && !!destinoId && origemId !== destinoId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      // 1) Com polyline (online ou cache_local) — calculo preciso
      if (geometria && pedagios.length > 0) {
        return pedagiosNaRotaOffline(geometria, pedagios);
      }
      // 2) Sem polyline mas com coords dos locais — fallback linha reta
      // (margem grande, pode dar falso positivo). Marca aproximado:true
      // pra UI mostrar mensagem diferente.
      if (pedagios.length > 0) {
        const catalogos = qc.getQueryData<Catalogos>(["catalogos"]);
        const origemLoc = catalogos?.locais.find((l) => l.id === origemId);
        const destinoLoc = catalogos?.locais.find((l) => l.id === destinoId);
        if (
          origemLoc?.lat != null &&
          origemLoc?.lng != null &&
          destinoLoc?.lat != null &&
          destinoLoc?.lng != null
        ) {
          const aproximados = pedagiosNaLinhaReta(
            origemLoc.lat,
            origemLoc.lng,
            destinoLoc.lat,
            destinoLoc.lng,
            pedagios,
          );
          return aproximados.map((p) => ({ ...p, aproximado: true }));
        }
      }
      // 3) Fallback online se nada local serviu
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
 * Motorista responde divergência FOTO_ILEGIVEL anexando foto nova.
 * Fluxo direto (sem outbox): upload + POST. Se offline, falha e usuário
 * tenta de novo — não vale a pena adicionar fila pro caso raro de admin
 * recusar uma foto E motorista estar sem internet ao mesmo tempo.
 */
export function useResponderFotoDivergente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      viagemId: string;
      fotoUri: string;
      fotoMime: string;
    }) => {
      const fd = new FormData();
      const filename = `ticket-${args.viagemId}.${
        args.fotoMime.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", {
        uri: args.fotoUri,
        type: args.fotoMime,
        name: filename,
      } as unknown as Blob);
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
 * Motorista informa valor de pedágio em viagem que admin marcou como
 * divergente por causa disso. Backend muda status pra AJUSTADA e limpa
 * o tipoDivergencia. Invalidamos o detalhe e listas pra refletir.
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

/** Responde uma divergência KM_DIVERGENTE: corrige o km (opcional) e justifica
 *  (obrigatório). A justificativa vai pra observação; a viagem vira AJUSTADA. */
export function useResponderKmDivergente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { viagemId: string; km?: number; justificativa: string }) => {
      return await api.post<ViagemDetalhe>(
        `/m/viagens/${args.viagemId}/responder-km-divergente`,
        { km: args.km, justificativa: args.justificativa },
      );
    },
    onSuccess: (atualizada) => {
      qc.setQueryData(["viagem-detalhe", atualizada.id], atualizada);
      void qc.invalidateQueries({ queryKey: ["viagens"] });
      void qc.invalidateQueries({ queryKey: ["viagens-filtradas"] });
      void qc.invalidateQueries({ queryKey: ["resumo-mes"] });
      // O responder-km também posta no chat → recarrega a conversa.
      void qc.invalidateQueries({ queryKey: ["viagem-mensagens", atualizada.id] });
    },
  });
}

export type MensagemViagem = {
  id: string;
  autor: "ADMIN" | "MOTORISTA";
  autorNome: string;
  texto: string;
  acao: string | null;
  criadoEm: string;
};

/** Chat da viagem (admin <-> motorista). Online — sem sinal, fica no cache. */
export function useMensagensViagem(viagemId?: string) {
  return useQuery({
    queryKey: ["viagem-mensagens", viagemId],
    enabled: !!viagemId,
    staleTime: 15_000,
    queryFn: () => api.get<MensagemViagem[]>(`/m/viagens/${viagemId}/mensagens`),
  });
}

/** Motorista manda uma mensagem no chat da viagem. Online-only. */
export function useEnviarMensagemViagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { viagemId: string; texto: string }) =>
      api.post<MensagemViagem[]>(`/m/viagens/${args.viagemId}/mensagens`, {
        texto: args.texto,
      }),
    onSuccess: (lista, args) => {
      qc.setQueryData(["viagem-mensagens", args.viagemId], lista);
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
  /** Filtra por cliente (vinculados a ele + genéricos). Usado na carga guiada. */
  clienteId?: string;
  /** Ignora o raio: traz os locais do cliente ordenados por distância mesmo
   * longe. Carga do "Iniciar viagem" quando nada dentro do raio. */
  todos?: boolean;
}): Promise<LocalProximo[]> {
  const qs = new URLSearchParams({
    lat: String(input.lat),
    lng: String(input.lng),
  });
  if (input.tipoUso) qs.set("tipoUso", input.tipoUso);
  if (input.raioM != null) qs.set("raioM", String(input.raioM));
  if (input.limit != null) qs.set("limit", String(input.limit));
  if (input.clienteId) qs.set("clienteId", input.clienteId);
  if (input.todos) qs.set("todos", "true");
  const list = await api.get<LocalProximo[]>(`/m/locais/proximos?${qs.toString()}`);
  return list.map(normalizarLocal);
}

// Raios padrão usados no fallback OFFLINE da busca de descarga (a config real
// vive no backend; offline não temos acesso a ela, então usamos os defaults).
export const DESCARGA_RAIO_INICIAL_PADRAO = 50;
export const DESCARGA_RAIO_AMPLIADO_PADRAO = 500;

export type BuscaDescargaResult = {
  locais: LocalProximo[];
  /** true = nada foi achado no raio inicial; `locais` vêm do raio ampliado e
   * devem ser tratados como SUGESTÃO (nunca auto-selecionar). */
  usouRaioAmpliado: boolean;
  raioInicialM: number;
  raioAmpliadoM: number;
};

/**
 * Busca local de descarga por GPS em 2 etapas (raio inicial → ampliado), com
 * raios configurados pela operadora no dashboard. Usado pelo botão "Estou no
 * local de descarga".
 */
export async function buscarDescargaDuasEtapas(input: {
  lat: number;
  lng: number;
  limit?: number;
}): Promise<BuscaDescargaResult> {
  const qs = new URLSearchParams({
    lat: String(input.lat),
    lng: String(input.lng),
  });
  if (input.limit != null) qs.set("limit", String(input.limit));
  const res = await api.get<BuscaDescargaResult>(
    `/m/locais/proximos-descarga?${qs.toString()}`,
  );
  return { ...res, locais: res.locais.map(normalizarLocal) };
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
      precisao?: number;
      fonte?: FonteGps;
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
          ...(input.precisao != null ? { precisao: input.precisao } : {}),
          ...(input.fonte != null ? { fonte: input.fonte } : {}),
          tipo: input.tipo,
          clienteIds: input.clienteIds,
        },
        status: "pending",
        attempts: 0,
        createdAt: Date.now(),
      });
      // Espera o local sincronizar no backend ANTES de retornar — assim a
      // próxima chamada (useCalcularRota) encontra o local e calcula via OSRM.
      // Se offline, drainLocais retorna rapido sem fazer nada e o local fica
      // pendente (próxima rota cai em haversine, comportamento esperado).
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
  /** Filtra por cliente (vinculados + genéricos), igual ao backend. */
  clienteId?: string;
  /** Ignora o raio (traz todos do cliente ordenados por distância). */
  todos?: boolean;
}): LocalProximo[] {
  const raio = input.raioM ?? 500;
  const todos = input.todos === true;
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
    // Cliente: vinculados a ele OU genéricos (sem cliente amarrado).
    if (
      input.clienteId &&
      l.clienteIds.length > 0 &&
      !l.clienteIds.includes(input.clienteId)
    ) {
      continue;
    }
    const d = haversineMetros(input.lat, input.lng, l.lat, l.lng);
    if (!todos && d > raio) continue;
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
 * Versão offline da busca de descarga em 2 etapas, sobre o catálogo cacheado.
 * Os raios vêm da config do painel (cacheada via useBuscaGpsConfig) — assim o
 * offline respeita o mesmo raio do online. As constantes são só fallback pra
 * quando a config ainda não foi cacheada.
 */
export function buscarDescargaDuasEtapasOffline(input: {
  lat: number;
  lng: number;
  locais: Local[];
  limit?: number;
  raioInicialM?: number;
  raioAmpliadoM?: number;
}): BuscaDescargaResult {
  const raioInicialM = input.raioInicialM ?? DESCARGA_RAIO_INICIAL_PADRAO;
  const raioAmpliadoM = input.raioAmpliadoM ?? DESCARGA_RAIO_AMPLIADO_PADRAO;
  const meta = { raioInicialM, raioAmpliadoM };
  const inicial = buscarLocaisProximosOffline({
    ...input,
    tipoUso: "descarga",
    raioM: raioInicialM,
  });
  if (inicial.length > 0) {
    return { locais: inicial, usouRaioAmpliado: false, ...meta };
  }
  const ampliado = buscarLocaisProximosOffline({
    ...input,
    tipoUso: "descarga",
    raioM: raioAmpliadoM,
  });
  return { locais: ampliado, usouRaioAmpliado: ampliado.length > 0, ...meta };
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

// ─── Stories (estilo Instagram) ──────────────────────────────────────────────

const STORIES_FEED_KEY = ["stories-feed"];

/** Stories do próprio motorista ainda no outbox (upload em andamento). Reativo
 * via onSyncChange — pra mostrar a bolinha "enviando" na hora que posta, sem
 * esperar o upload terminar (feel do Instagram). */
export function usePendingStories(): PendingStory[] {
  const [list, setList] = useState<PendingStory[]>([]);
  useEffect(() => {
    let vivo = true;
    const carregar = () =>
      listPendingStories()
        .then((l) => vivo && setList(l))
        .catch(() => {});
    carregar();
    const off = onSyncChange(carregar);
    return () => {
      vivo = false;
      off();
    };
  }, []);
  return list;
}

/** Feed de stories ativos agrupados por autor. staleTime curto — conteúdo
 * efêmero (24h), queremos atualizar com frequência. */
export function useStoriesFeed() {
  const me = useMe();
  return useQuery({
    queryKey: STORIES_FEED_KEY,
    queryFn: () => api.get<StoryFeedResponse>("/m/stories/feed"),
    // Rollout por flag: só busca quando o motorista tem acesso liberado.
    enabled: !!me.data?.podeVerStories,
    staleTime: 30_000,
  });
}

/** Posta um story. Vai pelo outbox (offline-first): enfileira e sincroniza
 * quando a rede permitir; o feed re-renderiza via onSyncChange no main. */
export function useEnviarStory() {
  return useMutation({
    mutationFn: async (input: {
      clientId: string;
      fotoUri: string;
      fotoMime: string;
      legenda?: string;
      lat?: number;
      lng?: number;
    }) => {
      await enqueueStory(input);
    },
  });
}

/** Aplica um patch a um story dentro do cache do feed (otimista). */
function patchStoryNoFeed(
  qc: QueryClient,
  storyId: string,
  patch: (s: StoryItem) => StoryItem,
) {
  qc.setQueryData<StoryFeedResponse>(STORIES_FEED_KEY, (cur) => {
    if (!cur) return cur;
    return {
      grupos: cur.grupos.map((g) => {
        const stories = g.stories.map((s) => (s.id === storyId ? patch(s) : s));
        const temNaoVisto = stories.some((s) => !g.ehMeu && !s.visto);
        return { ...g, stories, temNaoVisto };
      }),
    };
  });
}

/** Marca um story como visto (tira o anel). Otimista no cache do feed. */
export function useMarcarStoryVisto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) =>
      api.post<void>(`/m/stories/${storyId}/visto`, {}),
    onMutate: (storyId) => {
      patchStoryNoFeed(qc, storyId, (s) => ({ ...s, visto: true }));
    },
  });
}

/** Reage (ou tira a reação) a um story. A UI do visualizador usa estado local
 * pra resposta instantânea; aqui só persiste no servidor (sem re-render do feed,
 * que engasgava o iOS competindo com o timer da barra de progresso). */
export function useReagirStory() {
  return useMutation({
    mutationFn: (input: { storyId: string; emoji: StoryEmoji | null }) =>
      input.emoji === null
        ? api.delete<void>(`/m/stories/${input.storyId}/reacao`)
        : api.post<void>(`/m/stories/${input.storyId}/reacao`, {
            emoji: input.emoji,
          }),
  });
}

/** Apaga o próprio story. Invalida o feed. */
export function useDeletarStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) => api.delete<void>(`/m/stories/${storyId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STORIES_FEED_KEY });
    },
  });
}

/** "Visto por N": lista de espectadores + reações (só o autor consegue ver). */
export function useVisualizacoesStory(storyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["story-visualizacoes", storyId],
    enabled: enabled && !!storyId,
    staleTime: 15_000,
    queryFn: () =>
      api.get<{ total: number; visualizadores: StoryVisualizador[] }>(
        `/m/stories/${storyId}/visualizacoes`,
      ),
  });
}
