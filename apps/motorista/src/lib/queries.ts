import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/dexie";
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
  return !navigator.onLine;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const fresh = await api.get<Me>("/m/me");
        await db.meCache.put({ id: "current", data: fresh, cachedAt: Date.now() });
        return fresh;
      } catch (err) {
        if (isOfflineError(err)) {
          const cached = await db.meCache.get("current");
          if (cached) return cached.data;
        }
        throw err;
      }
    },
  });
}

export function useCatalogos() {
  return useQuery({
    queryKey: ["catalogos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const fresh = await api.get<Catalogos>("/m/catalogos");
        await db.catalogos.put({ id: "current", data: fresh, cachedAt: Date.now() });
        return fresh;
      } catch (err) {
        if (isOfflineError(err)) {
          const cached = await db.catalogos.get("current");
          if (cached) return cached.data;
        }
        throw err;
      }
    },
  });
}

export function useViagens() {
  return useQuery({
    queryKey: ["viagens"],
    queryFn: async () => {
      try {
        const fresh = await api.get<Viagem[]>("/m/viagens");
        await db.viagensCache.put({ id: "current", data: fresh, cachedAt: Date.now() });
        return fresh;
      } catch (err) {
        if (isOfflineError(err)) {
          const cached = await db.viagensCache.get("current");
          if (cached) return cached.data;
        }
        throw err;
      }
    },
  });
}

export function usePedagios() {
  return useQuery({
    queryKey: ["pedagios"],
    queryFn: async () => {
      try {
        const fresh = await api.get<Pedagio[]>("/m/pedagios");
        await db.pedagiosCache.put({ id: "current", data: fresh, cachedAt: Date.now() });
        return fresh;
      } catch (err) {
        if (isOfflineError(err)) {
          const cached = await db.pedagiosCache.get("current");
          if (cached) return cached.data;
        }
        throw err;
      }
    },
  });
}

/**
 * Offline-first: escreve no outbox local e retorna na hora.
 * Sem useMutation no meio — se a chamada pendurar o "Salvando..." trava na UI.
 * O refetch da lista é disparado em background com refetchQueries (não bloqueia).
 */
export function useCriarViagem() {
  const qc = useQueryClient();
  return async (input: {
    payload: Record<string, unknown>;
    foto?: { blob: Blob; mime: string };
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

