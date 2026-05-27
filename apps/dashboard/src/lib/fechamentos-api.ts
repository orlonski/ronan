"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, useAuthToken, usePaginatedList } from "./client-api";
import type { DataTableParams } from "@/hooks/use-data-table-state";

export type StatusFechamento =
  | "RECEBIDO"
  | "EM_PROCESSAMENTO"
  | "AGUARDANDO_REVISAO"
  | "CONFERIDO"
  | "EXPORTADO"
  | "SUBSTITUIDO";

export type StatusLinhaFechamento =
  | "MATCH"
  | "MATCH_IA"
  | "DIVERGENCIA"
  | "FALTANDO"
  | "EXTRA"
  | "RESOLVIDA_OPERADORA";

export type FechamentoLista = {
  id: string;
  empresa: { id: string; nome: string };
  periodoInicio: string;
  periodoFim: string;
  versao: number;
  status: StatusFechamento;
  arquivoOriginalNome: string | null;
  resumoIa: {
    total: number;
    matchAuto: number;
    matchIa: number;
    divergencia: number;
    faltando?: number;
    extra?: number;
  } | null;
  criadoEm: string;
  _count: { linhas: number; envios: number };
};

export type FechamentoDetalhe = FechamentoLista & {
  arquivoMimetype: string | null;
  substituidoPor: { id: string; versao: number; criadoEm: string } | null;
  substitui: { id: string; versao: number; criadoEm: string }[];
  layoutSalvo: unknown;
  envios: EnvioFechamento[];
  _count: { linhas: number };
};

export type EnvioFechamento = {
  id: string;
  fechamentoId: string;
  layoutId: string | null;
  arquivoNome: string;
  geradoEm: string;
  status: "GERADO" | "ENVIADO";
  marcadoEnviadoEm: string | null;
  canalEnvio: string | null;
  observacao: string | null;
  geradoPor: { id: string; nome: string } | null;
  layout: { id: string; nome: string } | null;
};

export type LinhaFechamento = {
  id: string;
  fechamentoId: string;
  ordem: number;
  rawData: Record<string, unknown>;
  placa: string | null;
  data: string | null;
  ticket: string | null;
  km: string | null;
  toneladas: string | null;
  valor: string | null;
  clienteTexto: string | null;
  materialTexto: string | null;
  status: StatusLinhaFechamento;
  divergencias: Record<string, { motorista: unknown; empresa: unknown }> | null;
  sugestaoIa: { viagemId?: string; confidence?: number; motivo?: string } | null;
  motivoResolucao: string | null;
  resolvidoEm: string | null;
  viagemMatch: {
    id: string;
    data: string;
    ticket: string;
    km: string;
    toneladas: string;
    toneladasInformada: string;
    toneladasEfetiva: string;
    toneladasAjustada: boolean;
    kmInformado: string;
    kmEfetivo: string;
    kmAjustada: boolean;
    veiculo: { placa: string };
    motorista: { nome: string };
    cliente: { nome: string; toneladasMinimas: string | null; kmMinimos: string | null };
    material: { nome: string };
  } | null;
  resolvidoPor: { id: string; nome: string } | null;
};

export type LayoutEnvio = {
  id: string;
  empresaId: string;
  nome: string;
  colunas: Array<{
    campo: string;
    header: string;
    ordem: number;
    formato?: string;
  }>;
  config: {
    incluiCabecalhoEmpresa?: boolean;
    formatoData?: string;
    separadorDecimal?: string;
    agruparPor?: string;
    totaisRodape?: boolean;
  } | null;
  padrao: boolean;
  criadoEm: string;
};

export type AuditEntry = {
  id: string;
  usuarioId: string | null;
  entidade: string;
  entidadeId: string;
  acao: string;
  campo: string | null;
  valorAntes: unknown;
  valorDepois: unknown;
  motivo: string | null;
  metadata: unknown;
  criadoEm: string;
  usuario: { id: string; nome: string; email: string } | null;
};

const PATH = "/admin/fechamentos";

export function useFechamentos(params: Partial<DataTableParams>) {
  return usePaginatedList<FechamentoLista>(PATH, params);
}

export function useFechamento(id: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["fechamento", id],
    enabled: !!token && !!id,
    queryFn: () => fetchApi<FechamentoDetalhe>(`${PATH}/${id}`, { token }),
  });
}

export function useLinhasFechamento(
  fechamentoId: string | undefined,
  status?: string,
  tipo?: "VIAGEM" | "PEDAGIO" | "COMBUSTIVEL",
) {
  const token = useAuthToken();
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (tipo) params.set("tipo", tipo);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return useQuery({
    queryKey: ["fechamento-linhas", fechamentoId, status, tipo],
    enabled: !!token && !!fechamentoId,
    queryFn: () => fetchApi<LinhaFechamento[]>(`${PATH}/${fechamentoId}/linhas${qs}`, { token }),
  });
}

export function useUploadFechamento() {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      empresaId: string;
      periodoInicio: string;
      periodoFim: string;
      substituirFechamentoId?: string;
      arquivo: File;
    }) => {
      const fd = new FormData();
      fd.append("empresaId", input.empresaId);
      fd.append("periodoInicio", input.periodoInicio);
      fd.append("periodoFim", input.periodoFim);
      if (input.substituirFechamentoId)
        fd.append("substituirFechamentoId", input.substituirFechamentoId);
      fd.append("arquivo", input.arquivo);
      return fetchApi<FechamentoDetalhe>(PATH, { method: "POST", body: fd, token });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/admin/fechamentos"] }),
  });
}

export function useResolverLinha(fechamentoId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      linhaId: string;
      acao: "aceitar_sugestao" | "escolher_viagem" | "erro_cliente" | "criar_retroativa";
      viagemId?: string;
      motivo?: string;
    }) =>
      fetchApi<LinhaFechamento>(`${PATH}/${fechamentoId}/linhas/${input.linhaId}/resolver`, {
        method: "POST",
        body: JSON.stringify({ acao: input.acao, viagemId: input.viagemId, motivo: input.motivo }),
        token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fechamento-linhas", fechamentoId] });
      qc.invalidateQueries({ queryKey: ["fechamento", fechamentoId] });
      qc.invalidateQueries({ queryKey: ["/admin/fechamentos"] });
    },
  });
}

export function useExportarFechamento(fechamentoId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { layoutEnvioId?: string }) =>
      fetchApi<{ envio: EnvioFechamento; arquivoNome: string }>(
        `${PATH}/${fechamentoId}/exportar`,
        {
          method: "POST",
          body: JSON.stringify(input),
          token,
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fechamento", fechamentoId] }),
  });
}

export function useMarcarEnviado(fechamentoId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { envioId: string; canalEnvio: string; observacao?: string }) =>
      fetchApi<EnvioFechamento>(`${PATH}/${fechamentoId}/envios/marcar-enviado`, {
        method: "POST",
        body: JSON.stringify(input),
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fechamento", fechamentoId] }),
  });
}

export function useReprocessar(fechamentoId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tipo?: "VIAGEM" | "PEDAGIO" | "COMBUSTIVEL") => {
      const qs = tipo ? `?tipo=${tipo}` : "";
      return fetchApi<{ ok: true }>(
        `${PATH}/${fechamentoId}/reprocessar${qs}`,
        { method: "POST", token },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fechamento", fechamentoId] });
      qc.invalidateQueries({ queryKey: ["fechamento-linhas", fechamentoId] });
    },
  });
}

// Layouts de envio
export function useLayoutsEnvio(empresaId: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["layouts-envio", empresaId],
    enabled: !!token && !!empresaId,
    queryFn: () =>
      fetchApi<LayoutEnvio[]>(`/admin/empresas/${empresaId}/layouts-envio`, { token }),
  });
}

export function useSalvarLayout(empresaId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      nome: string;
      colunas: LayoutEnvio["colunas"];
      config?: LayoutEnvio["config"];
      padrao?: boolean;
    }) => {
      const path = `/admin/empresas/${empresaId}/layouts-envio${input.id ? `/${input.id}` : ""}`;
      return fetchApi<LayoutEnvio>(path, {
        method: input.id ? "PATCH" : "POST",
        body: JSON.stringify({
          nome: input.nome,
          colunas: input.colunas,
          config: input.config,
          padrao: input.padrao,
        }),
        token,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["layouts-envio", empresaId] }),
  });
}

export function useRemoverLayout(empresaId: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (layoutId: string) =>
      fetchApi<void>(`/admin/empresas/${empresaId}/layouts-envio/${layoutId}`, {
        method: "DELETE",
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["layouts-envio", empresaId] }),
  });
}

// Envios standalone (pra empresas que SÓ recebem planilha)
export type EnvioStandalone = EnvioFechamento & {
  empresa: { id: string; nome: string } | null;
  fechamento: {
    id: string;
    versao: number;
    periodoInicio: string;
    periodoFim: string;
  } | null;
  layout: { id: string; nome: string } | null;
  geradoPor: { id: string; nome: string } | null;
  empresaId: string | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  totalLinhas: number | null;
};

export function useEnvios(params: Partial<DataTableParams>) {
  return usePaginatedList<EnvioStandalone>("/admin/envios", params);
}

export function useCriarEnvio() {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      empresaId: string;
      periodoInicio: string;
      periodoFim: string;
      layoutEnvioId?: string;
      clienteIds?: string[];
    }) =>
      fetchApi<{ envio: EnvioStandalone; arquivoNome: string; totalLinhas: number }>(
        "/admin/envios",
        { method: "POST", body: JSON.stringify(input), token },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/admin/envios"] }),
  });
}

export function useMarcarEnvioEnviado() {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { envioId: string; canalEnvio: string; observacao?: string }) =>
      fetchApi<EnvioStandalone>(`/admin/envios/${input.envioId}/marcar-enviado`, {
        method: "POST",
        body: JSON.stringify({ canalEnvio: input.canalEnvio, observacao: input.observacao }),
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/admin/envios"] }),
  });
}

// Download autenticado: faz fetch com Bearer token, recebe Blob e
// dispara download no browser. Necessario pq <a href> nao envia o
// header Authorization, e endpoints com @Roles dao 401.
export function useBaixarArquivo() {
  const token = useAuthToken();
  const API = process.env.NEXT_PUBLIC_API_URL ?? "";
  return async (path: string, fallbackName = "arquivo.xlsx") => {
    if (!token) throw new Error("Sem sessao");
    const res = await fetch(`${API}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Falha ao baixar: ${res.status}`);
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
  };
}

// Histórico de viagem
export function useHistoricoViagem(viagemId: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["viagem-historico", viagemId],
    enabled: !!token && !!viagemId,
    queryFn: () =>
      fetchApi<AuditEntry[]>(`/admin/viagens/${viagemId}/historico`, { token }),
  });
}

export function useViagem(viagemId: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: ["viagem", viagemId],
    enabled: !!token && !!viagemId,
    queryFn: () => fetchApi<unknown>(`/admin/viagens/${viagemId}`, { token }),
  });
}

