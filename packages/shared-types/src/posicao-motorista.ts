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
export const PosicaoItem = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precisao: z.number().nonnegative().optional(),
  velocidade: z.number().nonnegative().optional(),
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
