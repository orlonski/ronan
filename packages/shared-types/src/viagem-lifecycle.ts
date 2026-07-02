import { z } from "zod";
import { LocalSnapshot } from "./viagem";

// Limites espelham o schema do banco (Decimal(10,3)/Decimal(10,2)).
const MAX_TONELADAS = 9999;
const MAX_KM = 99999;
const MAX_VALOR = 999999.99;
const MAX_PRECISAO = 100000; // metros

// ---------------------------------------------------------------------------
// Catálogo dinâmico de tipos de evento (admin gerencia; app renderiza botões)
// ---------------------------------------------------------------------------

// slug: chave estável usada no código/snapshot. kebab-case minúsculo, imutável.
const slugSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z][a-z0-9-]*$/, "slug deve ser minúsculo, kebab-case (ex: 'carga').");

export const TipoEventoViagem = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nome: z.string(),
  ativo: z.boolean(),
  ordem: z.number().int(),
  obrigatorio: z.boolean(),
  repetivel: z.boolean(),
  ehCarga: z.boolean(),
  ehDescarga: z.boolean(),
  pedeGps: z.boolean(),
  pedeFoto: z.boolean(),
  pedeToneladas: z.boolean(),
  pedeValor: z.boolean(),
  pedeTicket: z.boolean(),
  pedeObservacao: z.boolean(),
});
export type TipoEventoViagem = z.infer<typeof TipoEventoViagem>;

// Admin — criação. slug obrigatório e imutável (não entra no update).
export const CriarTipoEventoViagemInput = z.object({
  slug: slugSchema,
  nome: z.string().min(1).max(60),
  ativo: z.boolean().optional(),
  ordem: z.number().int().min(0).max(9999).optional(),
  obrigatorio: z.boolean().optional(),
  repetivel: z.boolean().optional(),
  ehCarga: z.boolean().optional(),
  ehDescarga: z.boolean().optional(),
  pedeGps: z.boolean().optional(),
  pedeFoto: z.boolean().optional(),
  pedeToneladas: z.boolean().optional(),
  pedeValor: z.boolean().optional(),
  pedeTicket: z.boolean().optional(),
  pedeObservacao: z.boolean().optional(),
});
export type CriarTipoEventoViagemInput = z.infer<typeof CriarTipoEventoViagemInput>;

// Admin — atualização. slug NÃO é editável (é a chave estável do código).
export const AtualizarTipoEventoViagemInput = CriarTipoEventoViagemInput.omit({
  slug: true,
}).partial();
export type AtualizarTipoEventoViagemInput = z.infer<typeof AtualizarTipoEventoViagemInput>;

// ---------------------------------------------------------------------------
// Lifecycle da viagem: iniciar → eventos → finalizar
// ---------------------------------------------------------------------------

// Iniciar: cria a viagem EM_ANDAMENTO. Só o mínimo que dá pra saber no começo.
// localCarga é opcional (preenchido se o GPS detectou um local cadastrado).
export const IniciarViagemInput = z.object({
  clientId: z.string().uuid(),
  veiculoId: z.string().uuid(),
  // Cliente é escolhido no início (filtra os locais de carga possíveis).
  clienteId: z.string().uuid(),
  iniciadoEm: z.coerce.date(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  precisao: z.number().nonnegative().max(MAX_PRECISAO).optional(),
  localCargaId: z.string().uuid().optional(),
  // Auto-recovery: recria o local se o ID sumiu entre o cache do app e a sync.
  localCargaDados: LocalSnapshot.optional(),
  criadoOfflineEm: z.coerce.date().optional(),
});
export type IniciarViagemInput = z.infer<typeof IniciarViagemInput>;

// Registrar evento (carga/descarga/parada...). Idempotente por `id`.
// Os campos capturados dependem do TipoEventoViagem (pedeGps/pedeFoto/etc);
// a obrigatoriedade por tipo é validada no backend (autoritativo).
export const RegistrarEventoInput = z.object({
  id: z.string().uuid(),
  tipoSlug: slugSchema,
  ocorridoEm: z.coerce.date(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  precisao: z.number().nonnegative().max(MAX_PRECISAO).optional(),
  localId: z.string().uuid().optional(),
  localDados: LocalSnapshot.optional(),
  fotoKey: z.string().optional(),
  toneladas: z.number().positive().max(MAX_TONELADAS).optional(),
  valor: z.number().nonnegative().max(MAX_VALOR).optional(),
  ticket: z.string().max(50).optional(),
  observacao: z.string().max(500).optional(),
  criadoOfflineEm: z.coerce.date().optional(),
});
export type RegistrarEventoInput = z.infer<typeof RegistrarEventoInput>;

// Finalizar: preenche os campos que faltavam e fecha (EM_ANDAMENTO → ENVIADA).
// ticket é opcional aqui; a obrigatoriedade depende de Material.exigeTicket e
// é imposta no backend, igual ao fluxo de CriarViagemInput.
export const FinalizarViagemInput = z.object({
  // Opcional: o cliente já foi escolhido no iniciar (backend reusa o da viagem
  // se não vier). Mantido no schema pra compat/edição.
  clienteId: z.string().uuid().optional(),
  materialId: z.string().uuid(),
  data: z.coerce.date(),
  toneladas: z.number().positive().max(MAX_TONELADAS),
  km: z.number().nonnegative().max(MAX_KM),
  kmCalculado: z.number().nonnegative().max(MAX_KM).optional(),
  ticket: z.string().max(50).optional(),
  localDescargaId: z.string().uuid(),
  localDescargaDados: LocalSnapshot.optional(),
  // Captura fresca do GPS no clique "descarreguei aqui" (auditoria), espelha
  // os campos descarga* da Viagem. Normalmente vem do evento de descarga.
  descargaLat: z.number().min(-90).max(90).optional(),
  descargaLng: z.number().min(-180).max(180).optional(),
  descargaPrecisao: z.number().nonnegative().max(MAX_PRECISAO).optional(),
  descargaDistanciaMetros: z.number().nonnegative().max(MAX_KM * 1000).optional(),
  valorPedagioTotal: z.number().nonnegative().max(MAX_VALOR).optional(),
  observacao: z.string().max(500).optional(),
  fotoKey: z.string().optional(),
});
export type FinalizarViagemInput = z.infer<typeof FinalizarViagemInput>;

// Leitura de um evento já registrado (app timeline + dashboard).
export const EventoViagem = z.object({
  id: z.string().uuid(),
  viagemId: z.string().uuid(),
  tipoEventoId: z.string().uuid(),
  tipoSlug: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  precisao: z.number().nullable(),
  localId: z.string().nullable(),
  fotoKey: z.string().nullable(),
  toneladas: z.number().nullable(),
  valor: z.number().nullable(),
  ticket: z.string().nullable(),
  observacao: z.string().nullable(),
  ocorridoEm: z.coerce.date(),
});
export type EventoViagem = z.infer<typeof EventoViagem>;
