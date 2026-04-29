import { z } from "zod";

export const CriarPedagioInput = z.object({
  clientId: z.string().uuid(),
  veiculoId: z.string().uuid(),
  data: z.coerce.date(),
  pracaPedagio: z.string().min(1).max(120),
  valor: z.number().nonnegative(),
  viagemId: z.string().uuid().optional(),
});
export type CriarPedagioInput = z.infer<typeof CriarPedagioInput>;
