import { z } from "zod";

/**
 * Catálogo de permissões do RBAC — fonte ÚNICA, usada pelo backend (seed +
 * papéis sistema + guard) e pelo frontend (sidebar, TelaGuard, matriz de papéis).
 *
 * Permissão = `recurso.acao` (ex.: "viagens.editar"). `recurso.ver` = acesso à
 * tela; as demais ações gatam botões (frontend) e endpoints de escrita (backend).
 *
 * ESTRUTURA DINÂMICA — pra colocar uma TELA ou AÇÃO nova sob permissão, são 3
 * passos, sem refactor:
 *   1) Adicionar a chave aqui (no RESOURCE_DEFS).
 *   2) Gatar a UI: `temPermissao("recurso.acao")` no botão (ou <RequerTela>).
 *   3) Anotar o endpoint: `@RequerPermissao("recurso.acao")`.
 * O seed sincroniza o catálogo (upsert + poda), o papel Administrador ganha a
 * chave nova automaticamente e a matriz de papéis exibe sozinha.
 */
export type PermissaoCatalogo = {
  chave: string;
  modulo: string;
  titulo: string;
  descricao?: string;
  ordem: number;
};

// Rótulo amigável de cada ação (usado como label da checkbox na matriz).
const ACAO_TITULO: Record<string, string> = {
  ver: "Ver / acessar",
  "ver-comercial": "Ver dados comerciais",
  criar: "Criar",
  editar: "Editar",
  excluir: "Excluir",
  validar: "Pré-validar",
  compartilhar: "Compartilhar (link público)",
  corrigir: "Corrigir local",
  conferir: "Conferir / resolver",
  exportar: "Exportar",
  aprovar: "Aprovar cadastro",
  documentos: "Documentos",
  layouts: "Layouts (envio/import)",
  homologar: "Homologar / mesclar",
  importar: "Importar (OSM)",
  resolver: "Resolver",
  avisar: "Publicar aviso",
  moderar: "Moderar denúncias",
  gerenciar: "Gerenciar",
  expurgar: "Expurgar histórico",
};

type ResourceDef = { recurso: string; label: string; modulo: string; acoes: string[] };

// Ordem aqui = ordem na matriz. `acoes` em ordem de exibição.
const RESOURCE_DEFS: ResourceDef[] = [
  // ---- Operação ----
  // "ver-comercial" libera o que é da relação Schaba↔cliente dentro da viagem:
  // cliente/empresa, mínimo aplicado, km e toneladas faturados, fechamento.
  // Sem ela o backend OMITE esses campos do payload — quem não precisa (gestor
  // de frota terceira) vê só o operacional.
  // "compartilhar" gera link público do comprovante pro cliente. Exige TAMBÉM
  // "ver-comercial" no endpoint: o comprovante mostra km/toneladas faturados,
  // então quem não enxerga isso no painel não pode gerar link que mostre.
  { recurso: "viagens", label: "Viagens", modulo: "Operação", acoes: ["ver", "ver-comercial", "editar", "excluir", "validar", "compartilhar"] },
  { recurso: "descargas-suspeitas", label: "Descargas suspeitas", modulo: "Operação", acoes: ["ver", "corrigir"] },
  { recurso: "abastecimentos", label: "Abastecimentos", modulo: "Operação", acoes: ["ver", "editar", "excluir"] },
  { recurso: "fechamentos", label: "Fechamentos", modulo: "Operação", acoes: ["ver", "criar", "conferir", "exportar", "excluir"] },
  { recurso: "envios", label: "Envios", modulo: "Operação", acoes: ["ver", "criar", "excluir"] },
  { recurso: "notificacoes", label: "Notificações", modulo: "Operação", acoes: ["ver", "excluir"] },
  { recurso: "demandas", label: "Demandas do agente", modulo: "Operação", acoes: ["ver", "criar"] },
  // Chat dos motoristas. "ver" abre a tela (avisos + denúncias), "avisar"
  // publica no canal, "moderar" resolve denúncia e remove mensagem. Conversa
  // de motorista com motorista NÃO é acessível por nenhuma dessas chaves —
  // só o que chegou por denúncia aparece.
  { recurso: "chat", label: "Chat dos motoristas", modulo: "Operação", acoes: ["ver", "avisar", "moderar"] },
  // ---- Cadastros ----
  { recurso: "motoristas", label: "Motoristas", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "aprovar", "documentos"] },
  // O controller de veículos já exigia veiculos.criar/editar/excluir, mas o
  // recurso nunca existiu aqui — o seed podava as chaves órfãs e ninguém
  // conseguia mexer em veículo pelo painel. Declarado agora.
  { recurso: "veiculos", label: "Veículos", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "transportadoras", label: "Transportadoras (frotas)", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  // `expurgar` apaga posições de GPS com mais de 90 dias — é destrutivo, então
  // não pode viver sob a chave de leitura (foi o que aconteceu e virou furo).
  { recurso: "mapa", label: "Mapa", modulo: "Cadastros", acoes: ["ver", "expurgar"] },
  { recurso: "empresas", label: "Empresas", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "layouts"] },
  { recurso: "clientes", label: "Clientes", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "locais", label: "Locais", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "homologar"] },
  { recurso: "pedagios", label: "Pedágios (rodovias)", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "importar"] },
  { recurso: "materiais", label: "Materiais", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "regras-minimo", label: "Mínimos por faixa", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "tipos-evento-viagem", label: "Eventos da viagem", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  // ---- Sistema ----
  { recurso: "usuarios", label: "Usuários", modulo: "Sistema", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "permissoes", label: "Papéis e permissões", modulo: "Sistema", acoes: ["gerenciar"] },
  { recurso: "whatsapp", label: "WhatsApp", modulo: "Sistema", acoes: ["ver", "gerenciar"] },
  { recurso: "erros", label: "Erros", modulo: "Sistema", acoes: ["ver", "resolver"] },
  { recurso: "diagnosticos", label: "Diagnósticos", modulo: "Sistema", acoes: ["ver"] },
  { recurso: "config-tracking", label: "Tracking GPS", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-busca-locais", label: "Busca de locais", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-ia", label: "Inteligência Artificial", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-agente", label: "Agente WhatsApp", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-campos-layout", label: "Campos do layout", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-forca-atualizacao", label: "Forçar atualização do app", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-km-atipico", label: "Km atípico", modulo: "Sistema", acoes: ["ver", "editar"] },
];

/** Mapa recurso → rótulo amigável (usado na matriz de papéis). */
export const RECURSOS_LABEL: Record<string, string> = Object.fromEntries(
  RESOURCE_DEFS.map((r) => [r.recurso, r.label]),
);

export const CATALOGO_PERMISSOES: PermissaoCatalogo[] = RESOURCE_DEFS.flatMap((r, ri) =>
  r.acoes.map((acao, ai) => ({
    chave: `${r.recurso}.${acao}`,
    modulo: r.modulo,
    titulo: ACAO_TITULO[acao] ?? acao,
    ordem: ri * 100 + ai,
  })),
);

export const TODAS_AS_CHAVES: string[] = CATALOGO_PERMISSOES.map((p) => p.chave);

/** Ações que hoje são restritas a ADMIN (DELETEs sensíveis + importar OSM).
 * O papel Operador NÃO recebe estas — preserva o comportamento atual. */
export const ADMIN_ONLY: string[] = [
  "viagens.excluir",
  "abastecimentos.excluir",
  "fechamentos.excluir",
  "envios.excluir",
  "pedagios.excluir",
  "pedagios.importar",
];

/** Permissões do papel Operador: tudo de Operação + Cadastros, menos as
 * ADMIN-only. Sem o módulo Sistema. Espelha o acesso de hoje. */
export const PERMISSOES_OPERADOR: string[] = CATALOGO_PERMISSOES.filter(
  (p) => (p.modulo === "Operação" || p.modulo === "Cadastros") && !ADMIN_ONLY.includes(p.chave),
).map((p) => p.chave);

export const CriarPapelInput = z.object({
  nome: z.string().min(2).max(60),
  descricao: z.string().max(200).optional(),
  permissoes: z.array(z.string().min(1).max(60)).max(300).default([]),
});
export type CriarPapelInput = z.infer<typeof CriarPapelInput>;

export const AtualizarPapelInput = CriarPapelInput.partial();
export type AtualizarPapelInput = z.infer<typeof AtualizarPapelInput>;
