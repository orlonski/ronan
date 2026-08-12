"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/lib/client-api";

type MePayload = {
  id: string;
  nome: string;
  permissoes: string[];
  papel: { id: string; nome: string } | null;
  acessoGlobal: boolean;
  transportadoras: { id: string; nome: string }[];
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
    papelNome: data?.papel?.nome ?? null,
    temPermissao: (chave: string) => set.has(chave),
    /** false = usuário restrito a transportadora (o backend filtra o que ele lê). */
    acessoGlobal: data?.acessoGlobal ?? true,
    transportadoras: data?.transportadoras ?? [],
  };
}

/**
 * Mapa rota→permissão (prefixo). Usado pelo TelaGuard pra bloquear acesso
 * direto por URL. Ordenado por especificidade (prefixo mais longo primeiro).
 * Rotas sem mapa (ex.: "/", "/inbox") são liberadas.
 */
const ROTA_PERM: { prefixo: string; perm: string }[] = [
  { prefixo: "/configuracoes/permissoes", perm: "permissoes.gerenciar" },
  { prefixo: "/configuracoes/tracking", perm: "config-tracking.ver" },
  { prefixo: "/configuracoes/busca-locais", perm: "config-busca-locais.ver" },
  { prefixo: "/configuracoes/ia", perm: "config-ia.ver" },
  { prefixo: "/configuracoes/agente-whatsapp", perm: "config-agente.ver" },
  { prefixo: "/configuracoes/campos-layout", perm: "config-campos-layout.ver" },
  { prefixo: "/configuracoes/forca-atualizacao", perm: "config-forca-atualizacao.ver" },
  { prefixo: "/configuracoes/km-atipico", perm: "config-km-atipico.ver" },
  { prefixo: "/relatorios", perm: "relatorios.ver" },
  { prefixo: "/descargas-suspeitas", perm: "descargas-suspeitas.ver" },
  { prefixo: "/pedagios-rodovia", perm: "pedagios.ver" },
  { prefixo: "/viagens-andamento", perm: "viagens.ver" },
  { prefixo: "/viagens", perm: "viagens.ver" },
  { prefixo: "/tipos-evento-viagem", perm: "tipos-evento-viagem.ver" },
  { prefixo: "/abastecimentos", perm: "abastecimentos.ver" },
  { prefixo: "/fechamentos", perm: "fechamentos.ver" },
  { prefixo: "/envios", perm: "envios.ver" },
  { prefixo: "/notificacoes", perm: "notificacoes.ver" },
  { prefixo: "/demandas", perm: "demandas.ver" },
  { prefixo: "/motoristas", perm: "motoristas.ver" },
  { prefixo: "/veiculos", perm: "veiculos.ver" },
  { prefixo: "/transportadoras", perm: "transportadoras.ver" },
  { prefixo: "/mapa", perm: "mapa.ver" },
  { prefixo: "/empresas", perm: "empresas.ver" },
  { prefixo: "/clientes", perm: "clientes.ver" },
  { prefixo: "/locais", perm: "locais.ver" },
  { prefixo: "/materiais", perm: "materiais.ver" },
  { prefixo: "/regras-minimo", perm: "regras-minimo.ver" },
  { prefixo: "/usuarios", perm: "usuarios.ver" },
  { prefixo: "/whatsapp", perm: "whatsapp.ver" },
  { prefixo: "/erros", perm: "erros.ver" },
  { prefixo: "/diagnosticos", perm: "diagnosticos.ver" },
];

/** Permissão exigida pela rota (ou null se livre). */
export function permDaRota(pathname: string): string | null {
  const hit = ROTA_PERM.find((r) => pathname === r.prefixo || pathname.startsWith(`${r.prefixo}/`));
  return hit?.perm ?? null;
}
