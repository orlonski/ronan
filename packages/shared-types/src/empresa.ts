import { z } from "zod";
import { PapelEmpresa } from "./enums";

export const CriarEmpresaInput = z.object({
  nome: z.string().min(2).max(160),
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  contato: z.string().max(160).optional(),
  papel: z.nativeEnum(PapelEmpresa).default(PapelEmpresa.AMBOS),
  layoutImport: z.unknown().optional(),
  layoutExport: z.unknown().optional(),
});
export type CriarEmpresaInput = z.infer<typeof CriarEmpresaInput>;

export const AtualizarEmpresaInput = CriarEmpresaInput.partial().extend({
  ativa: z.boolean().optional(),
});
export type AtualizarEmpresaInput = z.infer<typeof AtualizarEmpresaInput>;
