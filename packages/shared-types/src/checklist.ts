import { z } from "zod";

/**
 * Checklist do caminhão. A empresa monta o modelo no painel; o motorista
 * responde no app (fila offline). LEMBRADO, nunca obrigatório: viagem sem
 * checklist não é recusada nem marcada como divergente — o painel só mostra
 * quem rodou sem.
 */

/** O ponto de partida que a empresa ajusta — o que se confere num basculante. */
export const ITENS_CHECKLIST_SUGERIDOS: { texto: string; fotoSeReprovar: boolean; abreAviso: boolean }[] = [
  { texto: "Pneus calibrados e sem corte ou bolha", fotoSeReprovar: true, abreAviso: true },
  { texto: "Freios funcionando (inclusive o de estacionamento)", fotoSeReprovar: false, abreAviso: true },
  { texto: "Luzes, setas e luz de ré funcionando", fotoSeReprovar: false, abreAviso: true },
  { texto: "Nível de óleo e água no normal", fotoSeReprovar: false, abreAviso: true },
  { texto: "Sem vazamento embaixo do caminhão", fotoSeReprovar: true, abreAviso: true },
  { texto: "Retrovisores e para-brisa sem trinca", fotoSeReprovar: true, abreAviso: true },
  { texto: "Caçamba, tampa e lona em ordem", fotoSeReprovar: true, abreAviso: true },
  { texto: "Extintor no lugar e dentro da validade", fotoSeReprovar: false, abreAviso: true },
  { texto: "Documentos do caminhão no veículo", fotoSeReprovar: false, abreAviso: false },
];

const ItemModelo = z.object({
  /** Presente ao editar um item existente (as respostas antigas apontam pra ele). */
  id: z.string().uuid().optional(),
  texto: z.string().trim().min(3, "Descreva o item.").max(160),
  fotoSeReprovar: z.boolean().default(true),
  abreAviso: z.boolean().default(true),
});

export const SalvarModeloChecklistInput = z.object({
  nome: z.string().trim().min(2).max(80),
  ativo: z.boolean().default(true),
  itens: z.array(ItemModelo).min(1, "O checklist precisa de pelo menos um item.").max(60),
});
export type SalvarModeloChecklistInput = z.infer<typeof SalvarModeloChecklistInput>;

export const RespostaChecklistInput = z.object({
  itemId: z.string().uuid().nullish(),
  /** O texto que ele viu (o modelo pode mudar enquanto a resposta espera sinal). */
  texto: z.string().trim().min(1).max(160),
  ok: z.boolean(),
  observacao: z.string().trim().max(500).nullish(),
  /** Foto do item reprovado, já enviada pela fila. */
  fotoKey: z.string().trim().max(300).nullish(),
});

export const RegistrarChecklistInput = z.object({
  /** O `clientId` da fila offline: reenvio não duplica. */
  clientId: z.string().trim().min(8).max(80),
  veiculoId: z.string().uuid().nullish(),
  modeloId: z.string().uuid().nullish(),
  feitoEm: z.coerce.date(),
  lat: z.coerce.number().min(-90).max(90).nullish(),
  lng: z.coerce.number().min(-180).max(180).nullish(),
  respostas: z.array(RespostaChecklistInput).min(1).max(60),
});
export type RegistrarChecklistInput = z.infer<typeof RegistrarChecklistInput>;
