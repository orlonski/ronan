import { z } from "zod";

/**
 * Catálogo de permissões do RBAC — fonte única usada pelo backend (seed do
 * catálogo + papéis sistema) e pelo frontend (sidebar, matriz de papéis).
 *
 * `chave` é o identificador estável referenciado no código. `modulo` agrupa na
 * UI seguindo os grupos do menu (Operação/Cadastros/Sistema). Permissões são
 * SOMENTE de acesso a telas — o resumo diário é preferência por usuário (ver
 * `resumo.ts`), não um papel. Adicionar tela nova = adicionar uma chave aqui.
 */
export type PermissaoCatalogo = {
  chave: string;
  modulo: string;
  titulo: string;
  descricao?: string;
  ordem: number;
};

export const CATALOGO_PERMISSOES: PermissaoCatalogo[] = [
  // ---- Telas · Operação ----
  { chave: "tela.viagens", modulo: "Operação", titulo: "Viagens", ordem: 10 },
  { chave: "tela.descargas-suspeitas", modulo: "Operação", titulo: "Descargas suspeitas", ordem: 20 },
  { chave: "tela.abastecimentos", modulo: "Operação", titulo: "Abastecimentos", ordem: 30 },
  { chave: "tela.fechamentos", modulo: "Operação", titulo: "Fechamentos", ordem: 40 },
  { chave: "tela.envios", modulo: "Operação", titulo: "Envios", ordem: 50 },
  { chave: "tela.notificacoes", modulo: "Operação", titulo: "Notificações", ordem: 60 },
  // ---- Telas · Cadastros ----
  { chave: "tela.motoristas", modulo: "Cadastros", titulo: "Motoristas", ordem: 110 },
  { chave: "tela.mapa", modulo: "Cadastros", titulo: "Mapa", ordem: 120 },
  { chave: "tela.empresas", modulo: "Cadastros", titulo: "Empresas", ordem: 130 },
  { chave: "tela.clientes", modulo: "Cadastros", titulo: "Clientes", ordem: 140 },
  { chave: "tela.locais", modulo: "Cadastros", titulo: "Locais", ordem: 150 },
  { chave: "tela.pedagios-rodovia", modulo: "Cadastros", titulo: "Pedágios (rodovias)", ordem: 160 },
  { chave: "tela.materiais", modulo: "Cadastros", titulo: "Materiais", ordem: 170 },
  // ---- Telas · Sistema ----
  { chave: "tela.usuarios", modulo: "Sistema", titulo: "Usuários", ordem: 210 },
  { chave: "tela.permissoes", modulo: "Sistema", titulo: "Papéis e permissões", ordem: 215 },
  { chave: "tela.whatsapp", modulo: "Sistema", titulo: "WhatsApp", ordem: 220 },
  { chave: "tela.erros", modulo: "Sistema", titulo: "Erros", ordem: 230 },
  { chave: "tela.diagnosticos", modulo: "Sistema", titulo: "Diagnósticos", ordem: 240 },
  { chave: "tela.config-tracking", modulo: "Sistema", titulo: "Tracking GPS", ordem: 250 },
  { chave: "tela.config-busca-locais", modulo: "Sistema", titulo: "Busca de locais", ordem: 260 },
  { chave: "tela.config-ia", modulo: "Sistema", titulo: "Inteligência Artificial", ordem: 270 },
  { chave: "tela.config-agente", modulo: "Sistema", titulo: "Agente WhatsApp", ordem: 280 },
  { chave: "tela.config-campos-layout", modulo: "Sistema", titulo: "Campos do layout", ordem: 290 },
];

export const TODAS_AS_CHAVES: string[] = CATALOGO_PERMISSOES.map((p) => p.chave);

/** Permissões do papel Operador embutido: tudo de Operação + Cadastros
 * (espelha o acesso de hoje; sem o módulo Sistema). */
export const PERMISSOES_OPERADOR: string[] = CATALOGO_PERMISSOES.filter(
  (p) => p.modulo === "Operação" || p.modulo === "Cadastros",
).map((p) => p.chave);

export const CriarPapelInput = z.object({
  nome: z.string().min(2).max(60),
  descricao: z.string().max(200).optional(),
  permissoes: z.array(z.string().min(1).max(60)).max(200).default([]),
});
export type CriarPapelInput = z.infer<typeof CriarPapelInput>;

export const AtualizarPapelInput = CriarPapelInput.partial();
export type AtualizarPapelInput = z.infer<typeof AtualizarPapelInput>;
