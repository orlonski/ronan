import { z } from "zod";

/**
 * Configuração do motorista pra compartilhar posição periódica (controle
 * de frota). Opt-in: ativada=false por default. Janela horária null/null
 * significa 24/7.
 */
export const PosicaoMotoristaConfig = z.object({
  ativada: z.boolean(),
  horarioInicio: z.number().int().min(0).max(23).nullable().optional(),
  horarioFim: z.number().int().min(0).max(23).nullable().optional(),
});
export type PosicaoMotoristaConfig = z.infer<typeof PosicaoMotoristaConfig>;

/** Posição individual capturada pela task periódica. */
// iOS/Android devolvem speed/accuracy = -1 quando o valor é desconhecido (parado,
// sinal ruim). Normaliza qualquer negativo pra undefined em vez de RECUSAR o lote
// inteiro — senão 1 ponto com -1 derruba as 100 posições.
const naoNegativoOuNulo = z
  .number()
  .optional()
  .transform((v) => (v != null && v >= 0 ? v : undefined));

export const PosicaoItem = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precisao: naoNegativoOuNulo,
  velocidade: naoNegativoOuNulo,
  /** Timestamp do device em ISO. */
  capturadoEm: z.string().datetime(),
});
export type PosicaoItem = z.infer<typeof PosicaoItem>;

/** Batch enviado pelo app: drena fila local de uma vez. */
export const EnviarPosicoesInput = z.object({
  posicoes: z.array(PosicaoItem).min(1).max(100),
});
export type EnviarPosicoesInput = z.infer<typeof EnviarPosicoesInput>;

/** Item retornado pelo admin pra montar o mapa de frota. */
export type MapaFrotaItem = {
  motorista: {
    id: string;
    nome: string;
    veiculo: { id: string; placa: string } | null;
  };
  ultimaPosicao: {
    lat: number;
    lng: number;
    capturadoEm: string;
    precisao: number | null;
  };
};
