"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MotoristaDocumentoOutput, TipoDocumentoMotorista } from "@ronan/shared-types";
import { fetchApi, useAuthToken } from "./client-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

function basePath(motoristaId: string) {
  return `/admin/motoristas/${motoristaId}/documentos`;
}

export function useDocumentosMotorista(motoristaId: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["motorista-documentos", motoristaId],
    enabled: !!token && !!motoristaId,
    queryFn: () =>
      fetchApi<MotoristaDocumentoOutput[]>(basePath(motoristaId!), { token }),
  });
}

export function useUploadDocumento(motoristaId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      tipo: TipoDocumentoMotorista;
      arquivo: File;
      validade?: string | null;
    }) => {
      const fd = new FormData();
      fd.append("arquivo", input.arquivo);
      if (input.validade) fd.append("validade", input.validade);
      return fetchApi<MotoristaDocumentoOutput>(`${basePath(motoristaId)}/${input.tipo}`, {
        method: "POST",
        body: fd,
        token,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["motorista-documentos", motoristaId] });
      qc.invalidateQueries({ queryKey: ["/admin/motoristas"] });
    },
  });
}

export function useAtualizarValidadeDocumento(motoristaId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { tipo: TipoDocumentoMotorista; validade: string | null }) =>
      fetchApi<MotoristaDocumentoOutput>(
        `${basePath(motoristaId)}/${input.tipo}/validade`,
        {
          method: "PATCH",
          body: JSON.stringify({ validade: input.validade }),
          token,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["motorista-documentos", motoristaId] });
      qc.invalidateQueries({ queryKey: ["/admin/motoristas"] });
    },
  });
}

export function useRemoverDocumento(motoristaId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tipo: TipoDocumentoMotorista) =>
      fetchApi<{ ok: true }>(`${basePath(motoristaId)}/${tipo}`, {
        method: "DELETE",
        token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["motorista-documentos", motoristaId] });
      qc.invalidateQueries({ queryKey: ["/admin/motoristas"] });
    },
  });
}

/**
 * Download autenticado (fetch + Bearer → Blob → <a download>). Endpoint protegido
 * por @Roles não aceita <a href> direto pq não envia o header Authorization.
 */
export async function baixarDocumento(
  motoristaId: string,
  tipo: TipoDocumentoMotorista,
  token: string,
  fallbackName = "documento",
) {
  const res = await fetch(`${API_URL}${basePath(motoristaId)}/${tipo}/download`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Falha ao baixar (${res.status})`);
  await downloadResponse(res, fallbackName);
}

export async function baixarZipDocumentos(
  motoristaId: string,
  token: string,
  fallbackName = "documentos.zip",
) {
  const res = await fetch(`${API_URL}${basePath(motoristaId)}/zip`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = `Falha ao baixar (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) msg = String(body.message);
    } catch {
      // ignora
    }
    throw new Error(msg);
  }
  await downloadResponse(res, fallbackName);
}

async function downloadResponse(res: Response, fallbackName: string) {
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename="?([^"]+)"?/i.exec(cd);
  const nome = m?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
