import { z } from "zod";

export const CriarViagemInput = z.object({
  clientId: z.string().uuid(),
  veiculoId: z.string().uuid(),
  obraId: z.string().uuid(),
  materialId: z.string().uuid(),
  data: z.coerce.date(),
  toneladas: z.number().positive(),
  ticket: z.string().min(1).max(50),
  km: z.number().nonnegative(),
  localCargaId: z.string().uuid(),
  localDescargaId: z.string().uuid(),
  valorPedagioTotal: z.number().nonnegative().optional(),
  observacao: z.string().max(500).optional(),
  fotoKey: z.string().optional(),
  criadoOfflineEm: z.coerce.date().optional(),
});
export type CriarViagemInput = z.infer<typeof CriarViagemInput>;
