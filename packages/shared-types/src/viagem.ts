import { z } from "zod";

export const ViagemPontoInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  capturadoEm: z.coerce.date(),
  velocidade: z.number().nonnegative().optional(),
  precisao: z.number().nonnegative().optional(),
});
export type ViagemPontoInput = z.infer<typeof ViagemPontoInput>;

// Limites: respeitam o schema do banco (Decimal(10,3) e Decimal(10,2))
// e dão margem pra valores realistas. Caminhão extra-pesado raramente
// passa de 80t; 9999t cobre qualquer cenário sem deixar passar absurdos.
const MAX_TONELADAS = 9999;
const MAX_KM = 99999;
const MAX_VALOR = 999999.99;

export const CriarViagemInput = z.object({
  clientId: z.string().uuid(),
  veiculoId: z.string().uuid(),
  obraId: z.string().uuid(),
  materialId: z.string().uuid(),
  data: z.coerce.date(),
  toneladas: z.number().positive().max(MAX_TONELADAS, `Toneladas acima do limite (${MAX_TONELADAS}).`),
  ticket: z.string().min(1).max(50),
  km: z.number().nonnegative().max(MAX_KM, `Km acima do limite (${MAX_KM}).`),
  localCargaId: z.string().uuid(),
  localDescargaId: z.string().uuid(),
  valorPedagioTotal: z.number().nonnegative().max(MAX_VALOR).optional(),
  observacao: z.string().max(500).optional(),
  fotoKey: z.string().optional(),
  criadoOfflineEm: z.coerce.date().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // Tracking GPS (opcional — só preenchido se motorista usou "Iniciar viagem")
  iniciadoEm: z.coerce.date().optional(),
  kmReal: z.number().nonnegative().max(MAX_KM).optional(),
  pontos: z.array(ViagemPontoInput).max(2000).optional(),
});
export type CriarViagemInput = z.infer<typeof CriarViagemInput>;
