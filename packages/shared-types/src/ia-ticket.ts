import { z } from "zod";

// Limite de tamanho: imagem comprimida pelo PhotoCapture fica em 200-500 KB
// (max 1920px, JPEG 0.85). Base64 do JPEG ~30% maior. 5MB cobre folga.
const MAX_BASE64_LEN = 5 * 1024 * 1024;

export const ExtrairTicketInput = z.object({
  fotoBase64: z.string().min(1).max(MAX_BASE64_LEN),
  mime: z.string().regex(/^image\/(jpeg|png|webp)$/),
});
export type ExtrairTicketInput = z.infer<typeof ExtrairTicketInput>;

/**
 * Resposta da extração de campos do ticket de pesagem por IA.
 * Campos vazios/null = IA não conseguiu identificar com confiança.
 * `*Sugerido` é texto bruto quando a IA leu mas não casou com o catálogo.
 */
export type ExtrairTicketResult = {
  ticket?: string;
  toneladas?: number;
  data?: string; // YYYY-MM-DD
  km?: number;
  clienteId?: string;
  clienteSugerido?: string;
  materialId?: string;
  materialSugerido?: string;
  veiculoId?: string;
  placaSugerida?: string;
  observacoes?: string;
  confidence: number; // 0..1
};
