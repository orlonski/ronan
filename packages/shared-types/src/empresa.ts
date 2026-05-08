import { z } from "zod";
import { PapelEmpresa } from "./enums";

const CampoChaveMatch = z.enum(["placa", "data", "ticket"]);

export const CriarEmpresaInput = z.object({
  nome: z.string().min(2).max(160),
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  contato: z.string().max(160).optional(),
  papel: z.nativeEnum(PapelEmpresa).default(PapelEmpresa.AMBOS),
  layoutImport: z.unknown().optional(),
  layoutExport: z.unknown().optional(),
  // Chave de match: lista de campos. Default null ⇒ ["placa","data","ticket"].
  chaveMatch: z.array(CampoChaveMatch).min(1).nullable().optional(),
  toleranciaKmPct: z.number().int().min(0).max(20).optional(),
  toleranciaTonPct: z.number().int().min(0).max(10).optional(),
});
export type CriarEmpresaInput = z.infer<typeof CriarEmpresaInput>;

export const AtualizarEmpresaInput = CriarEmpresaInput.partial().extend({
  ativa: z.boolean().optional(),
});
export type AtualizarEmpresaInput = z.infer<typeof AtualizarEmpresaInput>;
