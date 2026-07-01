import { z } from "zod";

// Mínimos de km/toneladas foram aposentados aqui — agora são regras por faixa
// (RegraMinimo, empresa+material+faixa de km). Ver packages/shared-types/regra-minimo.ts.
export const CriarClienteInput = z.object({
  nome: z.string().min(2).max(160),
  empresaId: z.string().uuid(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CriarClienteInput = z.infer<typeof CriarClienteInput>;

export const AtualizarClienteInput = z.object({
  nome: z.string().min(2).max(160).optional(),
  empresaId: z.string().uuid().optional(),
  ativa: z.boolean().optional(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).optional(),
});
export type AtualizarClienteInput = z.infer<typeof AtualizarClienteInput>;
