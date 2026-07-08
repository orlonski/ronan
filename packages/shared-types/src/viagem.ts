import { z } from "zod";
import { FonteGps } from "./enums";

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

// Fallback de auto-recovery: snapshot do local que estava no cache do app
// no momento que motorista criou a viagem. Backend usa esses dados pra
// recriar o local se o ID enviado nao existir mais (motorista offline
// usou local do cache que foi excluido por algum admin / motorista).
// Inclui apenas o essencial — endereco completo nao é necessario.
export const LocalSnapshot = z.object({
  nome: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LocalSnapshot = z.infer<typeof LocalSnapshot>;

// Base sem o refine de peso (z.object puro) — o controller do backend precisa
// dela pra .extend({ fotoKey }). O refine (peso obrigatório fora do modo
// aguardando peso) é aplicado por cima, tanto aqui quanto no payload do backend.
export const CriarViagemBase = z.object({
  clientId: z.string().uuid(),
  veiculoId: z.string().uuid(),
  clienteId: z.string().uuid(),
  materialId: z.string().uuid(),
  data: z.coerce.date(),
  // Opcional no schema por causa do modo "aguardando peso" (romaneio sai no fim
  // do dia): quando aguardandoPeso=true o motorista lança sem peso. Fora desse
  // modo é obrigatório — imposto pelo superRefine abaixo e pelo backend.
  toneladas: z.number().positive().max(MAX_TONELADAS, `Toneladas acima do limite (${MAX_TONELADAS}).`).optional(),
  // true = viagem lançada sem peso/ticket (romaneio no fim do dia). Backend cria
  // com status AGUARDANDO_PESO; motorista/admin completa depois.
  aguardandoPeso: z.boolean().optional(),
  // Opcional aqui: a obrigatoriedade depende de Material.exigeTicket e é imposta
  // no backend (autoritativo) e na UI do app com base no material escolhido.
  ticket: z.string().max(50).optional(),
  km: z.number().nonnegative().max(MAX_KM, `Km acima do limite (${MAX_KM}).`),
  // Snapshot do km que o OSRM calculou no momento do lançamento. App envia
  // sempre que `useCalcularRota` resolveu; null quando OSRM falhou ou
  // motorista digitou antes da resposta.
  kmCalculado: z.number().nonnegative().max(MAX_KM).optional(),
  // true = motorista digitou o km na mão (não aceitou o auto-calculado). O
  // reprocessamento de km no servidor respeita isso: não sobrescreve km editado.
  kmEditadoManual: z.boolean().optional(),
  // Polyline (formato Google) da rota que o motorista escolheu no seletor de
  // mapa. Ausente quando não houve escolha (rota única, offline, tela sem
  // seletor). Backend guarda em Viagem.rotaGeometria (rota real no painel).
  rotaGeometria: z.string().max(20000).optional(),
  // Escolha do motorista entre "voltei no retorno" (true) e "segui direto"
  // (false). Ausente quando não foi perguntado (sem retorno real / offline).
  // Backend guarda em Viagem.retornoConfirmado; o recalcular do painel respeita.
  retornoConfirmado: z.boolean().optional(),
  localCargaId: z.string().uuid(),
  localDescargaId: z.string().uuid(),
  // Fallback pra auto-recovery quando local foi excluido entre o cache
  // do app e a sync. Backend cria local com esses dados antes de salvar
  // a viagem. Apps devem enviar sempre que possivel.
  localCargaDados: LocalSnapshot.optional(),
  localDescargaDados: LocalSnapshot.optional(),
  valorPedagioTotal: z.number().nonnegative().max(MAX_VALOR).optional(),
  observacao: z.string().max(500).optional(),
  fotoKey: z.string().optional(),
  criadoOfflineEm: z.coerce.date().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // Captura do GPS no momento que o motorista tocou "Estou no local de
  // descarga": onde ele estava, a precisão do sinal (±m) e a distância até o
  // local que acabou selecionado. Servem pra auditar no dashboard quão
  // confiável foi a marcação. Null quando não houve captura fresca (ex.:
  // edição reaproveitando local já selecionado).
  descargaLat: z.number().min(-90).max(90).optional(),
  descargaLng: z.number().min(-180).max(180).optional(),
  descargaPrecisao: z.number().nonnegative().max(100000).optional(),
  // Fonte do sinal (PRECISA/BALANCED/CACHE) da captura da descarga. Complementa
  // a precisão: CACHE = caiu no last-known do sistema (posição pode estar defasada).
  descargaFonte: z.nativeEnum(FonteGps).optional(),
  descargaDistanciaMetros: z.number().nonnegative().max(MAX_KM * 1000).optional(),
  // Raio (m) em que o local foi encontrado (inicial ou ampliado, da config).
  descargaRaioUsadoM: z.number().int().nonnegative().max(100000).optional(),
  // true = a busca de locais no clique foi servida do catálogo em cache (sem
  // internet no momento); pode ter faltado local recém-criado por outro motorista.
  descargaBuscaOffline: z.boolean().optional(),
  // Tracking GPS (opcional — só preenchido se motorista usou "Iniciar viagem")
  iniciadoEm: z.coerce.date().optional(),
  kmReal: z.number().nonnegative().max(MAX_KM).optional(),
  pontos: z.array(ViagemPontoInput).max(2000).optional(),
  // Rastreamento OCR: campos preenchidos via IA (slugs do form). Vazio
  // quando motorista não usou OCR ou editou tudo depois.
  ocrCampos: z.array(z.string().min(1).max(40)).max(20).optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
});

// Fora do modo "aguardando peso", toneladas é obrigatório (positivo). Assim o
// app valida localmente antes de enfileirar; o modo aguardando peso libera.
// Reusado no payload do controller do backend (mesma regra na borda da API).
export function checarPesoObrigatorio(
  val: { aguardandoPeso?: boolean; toneladas?: number },
  ctx: z.RefinementCtx,
): void {
  if (!val.aguardandoPeso && (val.toneladas == null || val.toneladas <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toneladas"],
      message: "Informe as toneladas.",
    });
  }
}

export const CriarViagemInput = CriarViagemBase.superRefine(checarPesoObrigatorio);
export type CriarViagemInput = z.infer<typeof CriarViagemInput>;

// Completar o peso + ticket de uma viagem que foi lançada em AGUARDANDO_PESO
// (romaneio saiu no fim do dia). Motorista (app) ou admin (dashboard).
export const CompletarPesoInput = z.object({
  toneladas: z.number().positive().max(MAX_TONELADAS, `Toneladas acima do limite (${MAX_TONELADAS}).`),
  // Segue a regra de Material.exigeTicket, imposta no backend (autoritativo).
  ticket: z.string().max(50).optional(),
});
export type CompletarPesoInput = z.infer<typeof CompletarPesoInput>;

// Edição admin: campos que motorista lança continuam editáveis. Imutáveis aqui:
// id, clientId (idempotência), motoristaId, status, tracking GPS, fotos, timestamps.
// `null` em valorPedagioTotal/observacao permite limpar o campo.
export const AtualizarViagemInput = z.object({
  veiculoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  data: z.coerce.date().optional(),
  toneladas: z.number().positive().max(MAX_TONELADAS, `Toneladas acima do limite (${MAX_TONELADAS}).`).optional(),
  // nullable pra permitir limpar o ticket (material que não exige).
  ticket: z.string().max(50).nullable().optional(),
  km: z.number().nonnegative().max(MAX_KM, `Km acima do limite (${MAX_KM}).`).optional(),
  localCargaId: z.string().uuid().optional(),
  localDescargaId: z.string().uuid().optional(),
  valorPedagioTotal: z.number().nonnegative().max(MAX_VALOR).nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
});
export type AtualizarViagemInput = z.infer<typeof AtualizarViagemInput>;
