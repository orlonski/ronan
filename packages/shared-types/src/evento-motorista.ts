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
  "local_criado",
  // Lifecycle guiado (Iniciar → eventos → Finalizar). Antes o guiado não
  // emitia telemetria nenhuma, então um "iniciar abandonado" (viagem que fica
  // EM_ANDAMENTO vazia travando as próximas) era invisível. Com estes dá pra
  // reconstruir a timeline: iniciada → evento(s) → finalizada, OU iniciada →
  // silêncio → casca_orfa_limpa (abandono).
  "viagem_guiada_iniciada",
  "viagem_guiada_evento",
  "viagem_guiada_finalizada",
  "viagem_guiada_casca_orfa_limpa",
  // Telemetria de INTERAÇÃO na tela "Nova viagem" (prefixo nv_). Opt-in por
  // motorista (flag podeTelemetria) — reconstrói o que ele fez pra diagnosticar
  // ex. "selecionou local de descarga errado". contexto (Json) por tipo:
  //   nv_campo    { campo, valor }
  //   nv_busca    { campo, query, resultados, total }
  //   nv_selecao  { campo, query, escolhido:{id,label}, posicao, entreN }
  //   nv_descarga { modo, raioUsadoM?, ampliou?, trouxe:[{id,nome,distanciaM}], escolhido, pertoDaCarga? }
  //   nv_ocr      { campos, confianca? }
  //   nv_km       { modo, km, kmRota? }
  "nv_campo",
  "nv_busca",
  "nv_selecao",
  "nv_descarga",
  "nv_ocr",
  "nv_km",
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
