"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/lib/client-api";

type MePayload = {
  id: string;
  nome: string;
  perfil: "ADMIN" | "OPERADOR";
  permissoes: string[];
  papel: { id: string; nome: string } | null;
};

/**
 * Permissões efetivas do usuário logado (chaves do papel), vindas de
 * /admin/users/me. Cacheado pelo React Query; atualiza no refetch sem precisar
 * relogar. Base do controle de acesso do dashboard (sidebar + guards de tela).
 */
export function usePermissoes() {
  const { data, isLoading } = useApiQuery<MePayload>("/admin/users/me", {
    staleTime: 5 * 60_000,
  });
  const set = useMemo(() => new Set(data?.permissoes ?? []), [data]);
  return {
    isLoading,
    perfil: data?.perfil,
    papelNome: data?.papel?.nome ?? null,
    temPermissao: (chave: string) => set.has(chave),
  };
}

/**
 * Mapa rota→permissão (prefixo). Usado pelo TelaGuard pra bloquear acesso
 * direto por URL. Ordenado por especificidade (prefixo mais longo primeiro).
 * Rotas sem mapa (ex.: "/", "/inbox") são liberadas.
 */
const ROTA_PERM: { prefixo: string; perm: string }[] = [
  { prefixo: "/configuracoes/permissoes", perm: "tela.permissoes" },
  { prefixo: "/configuracoes/tracking", perm: "tela.config-tracking" },
  { prefixo: "/configuracoes/busca-locais", perm: "tela.config-busca-locais" },
  { prefixo: "/configuracoes/ia", perm: "tela.config-ia" },
  { prefixo: "/configuracoes/agente-whatsapp", perm: "tela.config-agente" },
  { prefixo: "/configuracoes/campos-layout", perm: "tela.config-campos-layout" },
  { prefixo: "/descargas-suspeitas", perm: "tela.descargas-suspeitas" },
  { prefixo: "/pedagios-rodovia", perm: "tela.pedagios-rodovia" },
  { prefixo: "/viagens", perm: "tela.viagens" },
  { prefixo: "/abastecimentos", perm: "tela.abastecimentos" },
  { prefixo: "/fechamentos", perm: "tela.fechamentos" },
  { prefixo: "/envios", perm: "tela.envios" },
  { prefixo: "/notificacoes", perm: "tela.notificacoes" },
  { prefixo: "/motoristas", perm: "tela.motoristas" },
  { prefixo: "/mapa", perm: "tela.mapa" },
  { prefixo: "/empresas", perm: "tela.empresas" },
  { prefixo: "/clientes", perm: "tela.clientes" },
  { prefixo: "/locais", perm: "tela.locais" },
  { prefixo: "/materiais", perm: "tela.materiais" },
  { prefixo: "/usuarios", perm: "tela.usuarios" },
  { prefixo: "/whatsapp", perm: "tela.whatsapp" },
  { prefixo: "/erros", perm: "tela.erros" },
  { prefixo: "/diagnosticos", perm: "tela.diagnosticos" },
];

/** Permissão exigida pela rota (ou null se livre). */
export function permDaRota(pathname: string): string | null {
  const hit = ROTA_PERM.find((r) => pathname === r.prefixo || pathname.startsWith(`${r.prefixo}/`));
  return hit?.perm ?? null;
}
