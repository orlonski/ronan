import { z } from "zod";

/**
 * Modo de serviço da conta: o que o lançamento da viagem exige. O admin
 * cadastra e o app monta o formulário a partir das flags — nada de fluxo
 * hardcoded por slug.
 *
 * ⚠️ Já existiu a medição por PERÍODO (diária, entrada→saída sem peso). Saiu
 * do sistema em 22/09/2026 sem nenhuma empresa ter usado; toda viagem é por peso.
 */
export const CriarTipoServicoInput = z.object({
  nome: z.string().min(2).max(60),
  // false = viagem sem material.
  exigeMaterial: z.boolean().default(true),
  // Combinado em E com Material.exigeTicket: basta um dos dois dispensar.
  exigeTicket: z.boolean().default(true),
  exigeLocalDescarga: z.boolean().default(true),
  exigeKm: z.boolean().default(true),
  // false = o app esconde o campo de pedágio (e o aviso de "a rota passa por
  // pedágio"). Não apaga nada: é só o que o formulário mostra.
  mostraPedagio: z.boolean().default(true),
  ordem: z.number().int().min(0).max(999).default(0),
});
export type CriarTipoServicoInput = z.infer<typeof CriarTipoServicoInput>;

export const AtualizarTipoServicoInput = z.object({
  nome: z.string().min(2).max(60).optional(),
  ativo: z.boolean().optional(),
  exigeMaterial: z.boolean().optional(),
  exigeTicket: z.boolean().optional(),
  exigeLocalDescarga: z.boolean().optional(),
  exigeKm: z.boolean().optional(),
  mostraPedagio: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
});
export type AtualizarTipoServicoInput = z.infer<typeof AtualizarTipoServicoInput>;

/** Leitura: o que o app e o painel recebem. */
export const TipoServico = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nome: z.string(),
  ativo: z.boolean(),
  padrao: z.boolean(),
  ordem: z.number().int(),
  exigeMaterial: z.boolean(),
  exigeTicket: z.boolean(),
  exigeLocalDescarga: z.boolean(),
  exigeKm: z.boolean(),
  mostraPedagio: z.boolean(),
});
export type TipoServico = z.infer<typeof TipoServico>;

/**
 * As regras que um modo de serviço impõe ao lançamento — o recorte do
 * TipoServico que decide o que o motorista precisa preencher.
 *
 * ⚠️ É a MESMA régua no app (validação antes de enfileirar) e na API (carimbo
 * de FALTA_* ao receber). Divergir faz o app deixar passar o que o servidor
 * carimba, ou — pior — o app exigir um campo que ele próprio escondeu, e aí o
 * motorista não tem como salvar.
 */
export type RegrasDoModo = {
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
  mostraPedagio: boolean;
};

/**
 * O comportamento de sempre: frete por tonelada, tudo obrigatório. É o que vale
 * quando não há modo nenhum (conta sem cadastro, catálogo antigo no aparelho).
 */
export const REGRAS_MODO_CLASSICO: RegrasDoModo = {
  exigeMaterial: true,
  exigeTicket: true,
  exigeLocalDescarga: true,
  exigeKm: true,
  mostraPedagio: true,
};

/**
 * Regras de um modo possivelmente INCOMPLETO. Compat on-read: catálogo em cache
 * de antes de um campo existir não o tem, e campo ausente vale o clássico
 * (true) — ausência nunca afrouxa nem esconde nada.
 */
export function regrasDoModo(
  modo?: Partial<Record<keyof RegrasDoModo, boolean | null | undefined>> | null,
): RegrasDoModo {
  return {
    exigeMaterial: modo?.exigeMaterial ?? true,
    exigeTicket: modo?.exigeTicket ?? true,
    exigeLocalDescarga: modo?.exigeLocalDescarga ?? true,
    exigeKm: modo?.exigeKm ?? true,
    mostraPedagio: modo?.mostraPedagio ?? true,
  };
}

/**
 * Qual modo vale, olhando a lista (catálogo do app): o escolhido; senão o
 * padrão da conta; senão nenhum (→ clássico). Mesma ordem do
 * `resolverModoServico` da API — que também cai no padrão quando o id não vem.
 */
export function escolherModoDaLista<T extends { id: string; padrao?: boolean | null }>(
  tipos: readonly T[] | null | undefined,
  tipoServicoId?: string | null,
): T | null {
  if (!tipos?.length) return null;
  return (
    (tipoServicoId ? tipos.find((t) => t.id === tipoServicoId) : undefined) ??
    tipos.find((t) => t.padrao) ??
    null
  );
}
