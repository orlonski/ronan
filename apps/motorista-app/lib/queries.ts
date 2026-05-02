import { useQuery } from "@tanstack/react-query";
import { cacheGet, cachePut } from "@/db/database";
import { api, ApiError } from "./api";

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

export function useViagens() {
  return useQuery(offlineCacheQuery<Viagem[]>("viagens", "/m/viagens"));
}

export function usePedagios() {
  return useQuery(offlineCacheQuery<Pedagio[]>("pedagios", "/m/pedagios"));
}
