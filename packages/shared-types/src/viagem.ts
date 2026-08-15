import { z } from "zod";
import { FonteGps } from "./enums";
import { KmFonte } from "./km-atipico";

export const ViagemPontoInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  capturadoEm: z.coerce.date(),
  // iOS/Android mandam speed/accuracy = -1 quando desconhecido — normaliza pra
  // undefined em vez de recusar o ponto (senão derruba a viagem inteira).
  velocidade: z
    .number()
    .optional()
    .transform((v) => (v != null && v >= 0 ? v : undefined)),
  precisao: z
    .number()
    .optional()
    .transform((v) => (v != null && v >= 0 ? v : undefined)),
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

// Tipo de trecho ADICIONAL do trajeto (além da carga→descarga base).
// RETORNO_BOTA_FORA = volta pro local de carga pra jogar a sobra (limpeza).
// ENTREGA = entrega adicional (múltiplas entregas — futuro).
export const TipoTrecho = z.enum(["RETORNO_BOTA_FORA", "ENTREGA"]);
export type TipoTrecho = z.infer<typeof TipoTrecho>;

// Trecho enviado pelo app: cada perna extra do trajeto. Hoje o app manda só o
// retorno do bota-fora; a estrutura já abre pra múltiplas entregas. O backend é
// autoritativo (valida RETORNO_BOTA_FORA contra Material.permiteBotaFora, atribui
// a ordem e recalcula o km quando reprocessa).
export const TrechoViagemInput = z.object({
  tipo: TipoTrecho,
  // Local de destino do trecho (no bota-fora = o local de carga).
  localId: z.string().uuid(),
  km: z.number().nonnegative().max(MAX_KM),
  // Futuro (múltiplas entregas): peso/ticket próprios do trecho.
  toneladas: z.number().positive().max(MAX_TONELADAS).optional(),
  ticket: z.string().max(50).optional(),
});
export type TrechoViagemInput = z.infer<typeof TrechoViagemInput>;

// Base sem o refine (z.object puro) — o controller do backend precisa dela pra
// .extend({ fotoKey }). O refine (o que cada modo de serviço exige) é aplicado
// por cima, tanto aqui quanto no payload do backend.
export const CriarViagemBase = z.object({
  clientId: z.string().uuid(),
  veiculoId: z.string().uuid(),
  clienteId: z.string().uuid(),
  // Opcional no z.object, obrigatório no refine quando não há tipoServicoId
  // (modo clássico). Um tipo de serviço com exigeMaterial=false (diária de
  // caminhão à disposição) não tem material — quem decide é o backend.
  materialId: z.string().uuid().optional(),
  // Modo de serviço (como a viagem é medida). Ausente = app antigo ou conta sem
  // tipos cadastrados: o backend resolve pro tipo `padrao` da conta, que é PESO.
  tipoServicoId: z.string().uuid().optional(),
  // Serviço medido por PERÍODO (diária): quando o caminhão entrou e saiu.
  // Datas COMPLETAS (não hora do dia) pra diária que vira a noite fechar sozinha.
  // Obrigatoriedade depende de TipoServico.medicao e é imposta no backend
  // (autoritativo), igual à do ticket. `saidaEm` ausente = diária ainda aberta:
  // o backend cria em AGUARDANDO_SAIDA.
  entradaEm: z.coerce.date().optional(),
  saidaEm: z.coerce.date().optional(),
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
  // Idem materialId: obrigatório no refine no modo clássico; um tipo de serviço
  // com exigeKm=false (diária parada no pátio) dispensa.
  km: z.number().nonnegative().max(MAX_KM, `Km acima do limite (${MAX_KM}).`).optional(),
  // Snapshot do km que o OSRM calculou no momento do lançamento. App envia
  // sempre que `useCalcularRota` resolveu; null quando OSRM falhou ou
  // motorista digitou antes da resposta.
  kmCalculado: z.number().nonnegative().max(MAX_KM).optional(),
  // true = motorista digitou o km na mão (não aceitou o auto-calculado). O
  // reprocessamento de km no servidor respeita isso: não sobrescreve km editado.
  kmEditadoManual: z.boolean().optional(),
  // Procedência do km (ROTA_OSRM | ROTA_ESCOLHIDA | HISTORICO | MANUAL). Distingue
  // "aceitou o cálculo" de "usou o que a frota já rodou no trajeto" — que NÃO é
  // "ajustou na mão" e não deve virar alerta de divergência no painel. Ausente =
  // app antigo; o backend deriva kmEditadoManual disto quando presente.
  kmFonte: KmFonte.optional(),
  // Polyline (formato Google) da rota que o motorista escolheu no seletor de
  // mapa. Ausente quando não houve escolha (rota única, offline, tela sem
  // seletor). Backend guarda em Viagem.rotaGeometria (rota real no painel).
  rotaGeometria: z.string().max(20000).optional(),
  // Trechos ADICIONAIS do trajeto (retorno do bota-fora hoje; entregas múltiplas
  // no futuro). O `km` acima já inclui a soma dos trechos. Backend valida e grava
  // em TrechoViagem. Ausente/[] = viagem normal carga→descarga.
  trechos: z.array(TrechoViagemInput).max(20).optional(),
  // Sempre obrigatório: mesmo a diária acontece em algum lugar.
  localCargaId: z.string().uuid(),
  // Idem materialId: obrigatório no refine no modo clássico; um tipo com
  // exigeLocalDescarga=false (diária que começa e termina no mesmo lugar) dispensa.
  localDescargaId: z.string().uuid().optional(),
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
  // Texto que o motorista escreveu ao insistir num km fora do padrão do trajeto.
  // Ausente é válido mesmo com km atípico (offline, app antigo, flag off): o
  // backend carimba assim mesmo e nunca bloqueia o lançamento.
  justificativaKm: z.string().min(10).max(500).optional(),
});

/**
 * O que o lançamento exige, de acordo com o modo de serviço.
 *
 * ⚠️ Esta função é a fronteira de compatibilidade da feature de diária. Quando
 * `tipoServicoId` está AUSENTE — app antigo, conta sem tipos cadastrados, PWA —
 * ela se comporta exatamente como antes: peso, material, km e local de descarga
 * obrigatórios, com as mesmas mensagens. Nada muda pra quem lança por tonelada.
 *
 * Quando `tipoServicoId` está presente, quem manda é o cadastro do tipo
 * (medicao/exige*), que só o backend conhece — mesmo racional já usado pro
 * ticket, que depende de Material.exigeTicket e é imposto lá. O app continua
 * validando pela UI (ele sabe as flags pelo catálogo); aqui a checagem afrouxa
 * pra não reprovar um payload legítimo antes de sair do celular.
 *
 * Reusado no payload do controller do backend (mesma regra na borda da API).
 */
export function checarObrigatoriosDoModo(
  val: {
    aguardandoPeso?: boolean;
    toneladas?: number;
    tipoServicoId?: string;
    materialId?: string;
    km?: number;
    localDescargaId?: string;
  },
  ctx: z.RefinementCtx,
): void {
  // Modo de serviço explícito: o backend é a autoridade (ele tem as flags).
  if (val.tipoServicoId) return;

  if (!val.aguardandoPeso && (val.toneladas == null || val.toneladas <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toneladas"],
      message: "Informe as toneladas.",
    });
  }
  if (!val.materialId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materialId"], message: "Escolha o material." });
  }
  if (val.km == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["km"], message: "Informe o km rodado." });
  }
  if (!val.localDescargaId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["localDescargaId"],
      message: "Escolha o local de descarga.",
    });
  }
}

export const CriarViagemInput = CriarViagemBase.superRefine(checarObrigatoriosDoModo);
export type CriarViagemInput = z.infer<typeof CriarViagemInput>;

// Completar o peso + ticket de uma viagem que foi lançada em AGUARDANDO_PESO
// (romaneio saiu no fim do dia). Motorista (app) ou admin (dashboard).
export const CompletarPesoInput = z.object({
  toneladas: z.number().positive().max(MAX_TONELADAS, `Toneladas acima do limite (${MAX_TONELADAS}).`),
  // Segue a regra de Material.exigeTicket, imposta no backend (autoritativo).
  ticket: z.string().max(50).optional(),
});
export type CompletarPesoInput = z.infer<typeof CompletarPesoInput>;

// Encerrar uma diária que foi aberta em AGUARDANDO_SAIDA (motorista marcou a
// entrada e seguiu à disposição). Espelha o CompletarPesoInput.
// `saidaEm` é DateTime completo: o app carimba o relógio ou o motorista corrige
// a hora, e a virada da noite fecha sozinha.
export const EncerrarDiariaInput = z.object({
  saidaEm: z.coerce.date(),
});
export type EncerrarDiariaInput = z.infer<typeof EncerrarDiariaInput>;

// Edição admin: campos que motorista lança continuam editáveis. Imutáveis aqui:
// id, clientId (idempotência), motoristaId, status, tracking GPS, fotos, timestamps.
// `null` em valorPedagioTotal/observacao permite limpar o campo.
export const AtualizarViagemInput = z.object({
  veiculoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  data: z.coerce.date().optional(),
  toneladas: z.number().positive().max(MAX_TONELADAS, `Toneladas acima do limite (${MAX_TONELADAS}).`).optional(),
  // Serviço medido por período (diária). O admin corrige a hora que o motorista
  // errou, ou fecha a diária que ficou aberta. Gravar `saidaEm` numa viagem em
  // AGUARDANDO_SAIDA a promove pra ENVIADA (backend).
  entradaEm: z.coerce.date().optional(),
  saidaEm: z.coerce.date().optional(),
  // nullable pra permitir limpar o ticket (material que não exige).
  ticket: z.string().max(50).nullable().optional(),
  km: z.number().nonnegative().max(MAX_KM, `Km acima do limite (${MAX_KM}).`).optional(),
  localCargaId: z.string().uuid().optional(),
  localDescargaId: z.string().uuid().optional(),
  valorPedagioTotal: z.number().nonnegative().max(MAX_VALOR).nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
});
export type AtualizarViagemInput = z.infer<typeof AtualizarViagemInput>;
