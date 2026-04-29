import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/dexie";
import { api, ApiError } from "./api";
import { drain, enqueuePedagio, enqueueViagem } from "./sync";

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
    queryFn: () => api.get<Me>("/m/me"),
    staleTime: 60_000,
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
 * Offline-first: sempre escreve no outbox primeiro. Drena depois (online).
 */
export function useCriarViagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      payload: Record<string, unknown>;
      foto?: { blob: Blob; mime: string };
    }) => {
      await enqueueViagem(input.payload, input.foto);
      await drain();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["viagens"] });
    },
  });
}

export function useCriarPedagio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      await enqueuePedagio(payload);
      await drain();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pedagios"] });
    },
  });
}
