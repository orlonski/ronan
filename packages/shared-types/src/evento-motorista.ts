import { z } from "zod";

/**
 * Telemetria de operação do motorista. Eventos semânticos (não erros JS) que
 * o app emite pra investigar falhas silenciosas no dashboard.
 *
 * Adicionar tipo novo aqui = visível em todo lugar (motorista-app, PWA,
 * backend, dashboard). Backend não restringe — aceita string livre — então
 * tipo desconhecido vindo de cliente antigo não quebra o POST.
 */
export const TipoEvento = z.enum([
  "rota_calculo_iniciado",
  "rota_calculo_sucesso",
  "rota_calculo_falhou",
  "gps_capturado",
  "gps_falhou",
  "viagem_salva",
]);
export type TipoEvento = z.infer<typeof TipoEvento>;

/** Origem do evento (qual app enviou). */
export const OrigemEvento = z.enum(["motorista-app", "motorista-pwa"]);
export type OrigemEvento = z.infer<typeof OrigemEvento>;

/** Schema de um evento individual que o motorista envia. */
export const EventoMotoristaInput = z.object({
  /** UUID gerado client-side. Idempotência: reenvio do mesmo id é no-op. */
  id: z.string().uuid(),
  /** Tipo do evento — aceita qualquer string pra permitir cliente novo enviar tipo que backend antigo desconhece. Validação semântica via TipoEvento (preferencial mas não obrigatória). */
  tipo: z.string().min(1).max(100),
  /** Payload semântico do evento. Forma depende de `tipo`. */
  contexto: z.record(z.string(), z.unknown()),
  /** Estava online no momento da captura? */
  online: z.boolean(),
  /** Versão do app que emitiu. */
  versaoApp: z.string().max(100).optional(),
  /** Timestamp do device (ISO). */
  capturadoEm: z.string().datetime(),
  /** Linkar ao clientId da viagem (pré-sync). Backend reconcilia → viagemId. */
  viagemClientId: z.string().uuid().optional(),
});
export type EventoMotoristaInput = z.infer<typeof EventoMotoristaInput>;

/** Batch de eventos enviado pelo motorista (POST /m/eventos). */
export const EventoMotoristaBatch = z.object({
  eventos: z.array(EventoMotoristaInput).min(1).max(50),
});
export type EventoMotoristaBatch = z.infer<typeof EventoMotoristaBatch>;
