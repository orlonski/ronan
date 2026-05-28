"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi, useAuthToken } from "./client-api";

export type EventoMotorista = {
  id: string;
  motoristaId: string;
  viagemId: string | null;
  viagemClientId: string | null;
  tipo: string;
  contexto: Record<string, unknown>;
  online: boolean;
  versaoApp: string | null;
  origem: string;
  capturadoEm: string;
  recebidoEm: string;
  motorista?: { id: string; nome: string };
};

export function useEventosViagem(viagemId: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["eventos-viagem", viagemId],
    enabled: !!token && !!viagemId,
    queryFn: () =>
      fetchApi<EventoMotorista[]>(`/admin/eventos/viagem/${viagemId}`, { token }),
  });
}

export type ListarEventosParams = {
  motoristaId?: string;
  tipo?: string[];
  desde?: Date;
  ate?: Date;
  online?: boolean;
  limit?: number;
};

export function useListarEventos(params: ListarEventosParams) {
  const token = useAuthToken();
  const qs = new URLSearchParams();
  if (params.motoristaId) qs.set("motoristaId", params.motoristaId);
  if (params.tipo && params.tipo.length > 0) qs.set("tipo", params.tipo.join(","));
  if (params.desde) qs.set("desde", params.desde.toISOString());
  if (params.ate) qs.set("ate", params.ate.toISOString());
  if (params.online !== undefined) qs.set("online", String(params.online));
  if (params.limit) qs.set("limit", String(params.limit));
  const s = qs.toString();
  return useQuery({
    queryKey: ["eventos-listar", params],
    enabled: !!token,
    queryFn: () =>
      fetchApi<EventoMotorista[]>(`/admin/eventos${s ? `?${s}` : ""}`, { token }),
  });
}
