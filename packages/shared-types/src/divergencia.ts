import { z } from "zod";

/**
 * Os dados do lançamento que se confere contra o ticket. É a lista que o
 * painel oferece em "Dados do ticket não conferem", a que o conferente
 * automático aponta, e a que o app do motorista mostra pra corrigir — as três
 * pontas falam a mesma chave.
 *
 * "cliente" é a obra: no cadastro, Cliente = obra e Empresa = quem paga.
 */
export const CAMPOS_DIVERGENTES = ["ticket", "toneladas", "data", "placa", "cliente", "material"] as const;
export type CampoDivergente = (typeof CAMPOS_DIVERGENTES)[number];

export const ROTULO_CAMPO_DIVERGENTE: Record<CampoDivergente, string> = {
  ticket: "Número do ticket",
  toneladas: "Toneladas",
  data: "Data",
  placa: "Placa",
  cliente: "Obra",
  material: "Material",
};

/**
 * Resposta do motorista a DADOS_DIVERGENTES. Cada campo é opcional: ele manda
 * só o que corrigiu. Não mudar nada é permitido — ele pode estar certo e a
 * leitura errada —, mas aí a justificativa é obrigatória (o servidor confere).
 */
export const CorrigirDadosDivergentesInput = z.object({
  ticket: z.string().trim().min(1).max(50).optional(),
  toneladas: z.number().positive().max(9999).optional(),
  /** YYYY-MM-DD, como o lançamento manda. */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  veiculoId: z.string().min(1).optional(),
  clienteId: z.string().min(1).optional(),
  materialId: z.string().min(1).optional(),
  justificativa: z.string().trim().max(500).optional(),
});
export type CorrigirDadosDivergentesInput = z.infer<typeof CorrigirDadosDivergentesInput>;
