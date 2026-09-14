"use client";

import { useMemo } from "react";
import { moduloDaChave } from "@ronan/shared-types";
import { useApiQuery } from "@/lib/client-api";

type MePayload = {
  id: string;
  nome: string;
  permissoes: string[];
  /** Os módulos que a empresa contratou. Vazio em payload antigo (ver o hook). */
  modulos?: string[];
  papel: { id: string; nome: string } | null;
  acessoGlobal: boolean;
  transportadoras: { id: string; nome: string }[];
  /**
   * A empresa (tenant) desta sessão — a EFETIVA. O backend já filtra tudo por
   * ela, e quando a equipe da plataforma está visitando um cliente, é a empresa
   * visitada que vem aqui.
   */
  conta: { id: string; nome: string; logoUrl: string | null; codigoConvite: string | null } | null;
  /** true = equipe da plataforma (só ela vê a tela de empresas). */
  plataforma: boolean;
  /** true = está dentro de uma empresa que não é a dele. */
  assumida?: boolean;
  /** A empresa dele, pra onde o botão "sair desta empresa" volta. */
  contaOrigem?: { id: string; nome: string } | null;
  /** Em que pé a empresa está: pode escrever? está em teste? faltam quantos dias? */
  estadoConta?: {
    podeEscrever: boolean;
    emTeste: boolean;
    diasRestantes: number | null;
    motivo: string | null;
  } | null;
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
  // `undefined` (API antiga, durante um deploy) vale como "tem tudo": a
  // alternativa seria o painel esvaziar o menu inteiro na janela entre o
  // frontend novo subir e o backend novo responder.
  const modulos = useMemo(
    () => (data?.modulos ? new Set(data.modulos) : null),
    [data],
  );
  return {
    isLoading,
    papelNome: data?.papel?.nome ?? null,
    temPermissao: (chave: string) => set.has(chave),
    /** A empresa contratou o módulo que esta chave pertence? */
    temModulo: (chave: string) => {
      if (!modulos) return true;
      const m = moduloDaChave(chave);
      return m == null || modulos.has(m);
    },
    modulos: data?.modulos ?? null,
    /** false = usuário restrito a transportadora (o backend filtra o que ele lê). */
    acessoGlobal: data?.acessoGlobal ?? true,
    transportadoras: data?.transportadoras ?? [],
    /** A empresa da sessão — só pra exibir; o recorte dos dados é do backend. */
    conta: data?.conta ?? null,
    /** Equipe da plataforma: enxerga a tela de empresas. */
    plataforma: data?.plataforma ?? false,
    /**
     * Está dentro de uma empresa que não é a dele. Quem usa isto tem obrigação
     * de deixar visível na tela: sem o aviso, uma exclusão feita achando que se
     * está em casa acontece no dado de um cliente.
     */
    assumida: data?.assumida ?? false,
    /** A empresa dele, pra onde o "sair desta empresa" volta. */
    contaOrigem: data?.contaOrigem ?? null,
    /**
     * Estado da empresa. Quem usa tem obrigação de deixar visível: sem aviso, a
     * única pista de que o teste acabou seria o erro ao tentar salvar.
     */
    estadoConta: data?.estadoConta ?? null,
  };
}

/**
 * Mapa rota→permissão (prefixo). Usado pelo TelaGuard pra bloquear acesso
 * direto por URL. Ordenado por especificidade (prefixo mais longo primeiro).
 * Rotas sem mapa (ex.: "/", "/inbox") são liberadas.
 */
const ROTA_PERM: { prefixo: string; perm: string }[] = [
  { prefixo: "/configuracoes/permissoes", perm: "permissoes.gerenciar" },
  { prefixo: "/configuracoes/empresa", perm: "minha-empresa.editar" },
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
  { prefixo: "/lancamentos-travados", perm: "lancamentos-resgatados.ver" },
  { prefixo: "/notificacoes", perm: "notificacoes.ver" },
  { prefixo: "/demandas", perm: "demandas.ver" },
  { prefixo: "/marketing", perm: "marketing.ver" },
  { prefixo: "/motoristas", perm: "motoristas.ver" },
  { prefixo: "/veiculos", perm: "veiculos.ver" },
  { prefixo: "/transportadoras", perm: "transportadoras.ver" },
  { prefixo: "/mapa", perm: "mapa.ver" },
  { prefixo: "/empresas", perm: "empresas.ver" },
  { prefixo: "/clientes", perm: "clientes.ver" },
  { prefixo: "/locais", perm: "locais.ver" },
  { prefixo: "/materiais", perm: "materiais.ver" },
  { prefixo: "/regras-minimo", perm: "regras-minimo.ver" },
  { prefixo: "/tabelas-preco", perm: "tabelas-preco.ver" },
  { prefixo: "/acertos", perm: "acertos.ver" },
  { prefixo: "/financeiro", perm: "financeiro.ver" },
  { prefixo: "/frota", perm: "manutencao.ver" },
  { prefixo: "/programacao", perm: "programacao.ver" },
  { prefixo: "/torre", perm: "programacao.ver" },
  { prefixo: "/importacao", perm: "importacao.ver" },
  { prefixo: "/cte", perm: "cte.ver" },
  { prefixo: "/configuracoes/cte", perm: "cte.ver" },
  { prefixo: "/pedidos", perm: "pedidos.ver" },
  { prefixo: "/prospeccao", perm: "prospeccao.ver" },
  { prefixo: "/conferencias", perm: "conferencia-ticket.ver" },
  { prefixo: "/chat", perm: "chat.ver" },
  // Estas duas estavam no menu e fora daqui — `permDaRota` libera o que não está
  // mapeado, então a tela montava por URL direta e quebrava nos 403 da API em
  // vez de dizer "acesso restrito".
  { prefixo: "/tipos-servico", perm: "tipos-servico.ver" },
  { prefixo: "/modalidades", perm: "modalidades.ver" },
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
