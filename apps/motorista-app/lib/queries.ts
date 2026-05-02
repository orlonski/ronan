import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type Veiculo = { id: string; placa: string; modelo: string | null };

export type Me = {
  id: string;
  nome: string;
  usuario: string;
  telefone: string | null;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  ultimoLoginEm: string | null;
};

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    staleTime: 60_000,
    queryFn: () => api.get<Me>("/m/me"),
  });
}
