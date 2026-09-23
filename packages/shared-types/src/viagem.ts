import { z } from "zod";
import { FonteGps } from "./enums";
import { KmFonte } from "./km-atipico";
import { REGRAS_MODO_CLASSICO, type RegrasDoModo } from "./tipo-servico";

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

// Mesmo auto-recovery do local, pro veículo. `veiculoId` é a única FK
// obrigatória da Viagem: sem a placa que o motorista tinha em mãos, uma placa
// excluída do cadastro obrigaria o servidor a inventar um caminhão. Com o
// snapshot ele readota a placa certa e só carimba a divergência pra conferência.
export const VeiculoSnapshot = z.object({
  placa: z.string().min(1).max(20),
  modelo: z.string().max(100).optional(),
});
export type VeiculoSnapshot = z.infer<typeof VeiculoSnapshot>;

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
  // (modo clássico). Um tipo de serviço com exigeMaterial=false não tem
  // material — quem decide é o backend.
  materialId: z.string().uuid().optional(),
  // Modo de serviço (o que o lançamento exige). Ausente = app antigo ou conta
  // sem tipos cadastrados: o backend resolve pro tipo `padrao` da conta.
  // `entradaEm`/`saidaEm` (da diária, que saiu) chegam de app antigo e o Zod
  // descarta — nada a fazer aqui.
  tipoServicoId: z.string().uuid().optional(),
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
  // Idem, pra placa (ver VeiculoSnapshot).
  veiculoDados: VeiculoSnapshot.optional(),
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
  // Por que veio sem a foto do comprovante, numa empresa que exige. O APP é quem
  // bloqueia (não salva sem foto nem justificativa); aqui é opcional de propósito
  // — recusar no backend mataria item de outbox offline. Ver common/exige-foto.ts.
  justificativaSemFoto: z.string().min(10).max(500).optional(),
});

/** Campo do lançamento que o modo de serviço pode exigir. */
export type CampoExigidoPeloModo = "toneladas" | "materialId" | "km" | "localDescargaId";

/**
 * O que falta no lançamento, pela régua do modo de serviço.
 *
 * ⚠️ UMA régua pra dois lados: o app valida com ela antes de enfileirar, e a
 * API usa ela pra decidir o que carimbar como FALTA_* ao receber. Quem exige
 * o que o modo não pede prende o motorista num campo que a tela nem mostra —
 * foi assim que conta com um modo só sem km ficou sem conseguir salvar.
 *
 * Peso não depende do modo: toda viagem é por peso (sem peso só no fluxo
 * "aguardando peso", que completa depois). Ticket também fica de fora — a
 * exigência dele combina modo E material, e o catálogo de material só o
 * backend e a tela conhecem por inteiro.
 */
export function camposFaltandoPeloModo(
  val: {
    aguardandoPeso?: boolean;
    toneladas?: number | null;
    materialId?: string | null;
    km?: number | null;
    localDescargaId?: string | null;
  },
  regras: Pick<RegrasDoModo, "exigeMaterial" | "exigeKm" | "exigeLocalDescarga">,
): { campo: CampoExigidoPeloModo; mensagem: string }[] {
  const falta: { campo: CampoExigidoPeloModo; mensagem: string }[] = [];
  if (!val.aguardandoPeso && (val.toneladas == null || val.toneladas <= 0)) {
    falta.push({ campo: "toneladas", mensagem: "Informe as toneladas." });
  }
  if (regras.exigeMaterial && !val.materialId) {
    falta.push({ campo: "materialId", mensagem: "Escolha o material." });
  }
  if (regras.exigeKm && val.km == null) {
    falta.push({ campo: "km", mensagem: "Informe o km rodado." });
  }
  if (regras.exigeLocalDescarga && !val.localDescargaId) {
    falta.push({ campo: "localDescargaId", mensagem: "Escolha o local de descarga." });
  }
  return falta;
}

function refinarPeloModo(regras: RegrasDoModo) {
  return (
    val: Parameters<typeof camposFaltandoPeloModo>[0],
    ctx: z.RefinementCtx,
  ): void => {
    for (const f of camposFaltandoPeloModo(val, regras)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f.campo], message: f.mensagem });
    }
  };
}

/**
 * O que o lançamento exige quando o chamador NÃO sabe o modo.
 *
 * ⚠️ Fronteira de compatibilidade: sem `tipoServicoId` vale o clássico (tudo
 * obrigatório, mensagens de sempre); com ele, afrouxa — quem tem as flags é o
 * backend. Quem SABE o modo (o app, pelo catálogo) usa `criarViagemInputDoModo`
 * com as regras dele, que é a validação que conta.
 */
export function checarObrigatoriosDoModo(
  val: Parameters<typeof camposFaltandoPeloModo>[0] & { tipoServicoId?: string },
  ctx: z.RefinementCtx,
): void {
  if (val.tipoServicoId) return;
  refinarPeloModo(REGRAS_MODO_CLASSICO)(val, ctx);
}

export const CriarViagemInput = CriarViagemBase.superRefine(checarObrigatoriosDoModo);

/**
 * O schema do lançamento com a régua de UM modo conhecido — o que o app usa
 * antes de enfileirar. `regrasDoModo(null)` = clássico.
 */
export function criarViagemInputDoModo(regras: RegrasDoModo) {
  return CriarViagemBase.superRefine(refinarPeloModo(regras));
}
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
/**
 * Chave de acesso de documento fiscal, como ela chega do formulário.
 *
 * Guarda SÓ OS NÚMEROS: a chave é copiada do DACTE, do e-mail ou do WhatsApp, e
 * chega com espaço, ponto e quebra de linha. Normalizar aqui evita a mesma
 * chave virar dois valores diferentes no banco conforme de onde foi colada.
 *
 * String vazia vira null — é como o formulário manda "apaguei esse campo".
 */
const ChaveFiscalSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => v.length === 0 || v.length === 44, "A chave precisa ter 44 números.")
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

export const AtualizarViagemInput = z.object({
  veiculoId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  data: z.coerce.date().optional(),
  toneladas: z.number().positive().max(MAX_TONELADAS, `Toneladas acima do limite (${MAX_TONELADAS}).`).optional(),
  // nullable pra permitir limpar o ticket (material que não exige).
  ticket: z.string().max(50).nullable().optional(),
  km: z.number().nonnegative().max(MAX_KM, `Km acima do limite (${MAX_KM}).`).optional(),
  // O km que o motorista informou é lei: o painel só passa por cima dele
  // escrevendo o porquê. Não é coluna da Viagem — o service tira do input antes
  // do update e grava em kmAlteracaoMotivo + auditoria ADMIN_ALTEROU_KM.
  motivoKm: z
    .string()
    .trim()
    .min(10, "Explique em pelo menos 10 caracteres por que está alterando o km.")
    .max(300, "Motivo muito longo (máx. 300 caracteres).")
    .optional(),
  localCargaId: z.string().uuid().optional(),
  localDescargaId: z.string().uuid().optional(),
  valorPedagioTotal: z.number().nonnegative().max(MAX_VALOR).nullable().optional(),
  /**
   * Valor da MERCADORIA transportada — o `vCarga` do CT-e, não o frete.
   *
   * Opcional porque quase sempre a referência por tonelada do material dá
   * conta. Existe pra quando o valor real é sabido (veio da NF-e): aproximação
   * não deve passar por cima de número conhecido.
   */
  valorCarga: z.number().nonnegative().max(MAX_VALOR).nullable().optional(),
  observacao: z.string().max(500).nullable().optional(),
  // --- documentos fiscais emitidos FORA daqui ---
  // O sistema não emite; ele amarra. Guardar a chave é o que mata a digitação
  // dupla entre o emissor fiscal do cliente e este sistema — e digitação dupla
  // é o que faz sistema de operação ser abandonado em 90 dias.
  //
  // A validação real (44 dígitos, DV módulo 11, modelo certo) mora no backend,
  // em `common/chave-fiscal.ts`: ela precisa dizer POR QUE a chave não serve, e
  // um regex de 44 dígitos aceitaria a chave de outro documento calada.
  nfeChave: ChaveFiscalSchema,
  nfeNumero: z.string().trim().max(20).nullable().optional(),
  nfeSerie: z.string().trim().max(5).nullable().optional(),
  cteChave: ChaveFiscalSchema,
  cteNumero: z.string().trim().max(20).nullable().optional(),
  cteSerie: z.string().trim().max(5).nullable().optional(),
  mdfeChave: ChaveFiscalSchema,
  // Quem recebeu a carga. Com o GPS e a foto que já existem, fecha os quatro
  // requisitos do Comprovante de Entrega Eletrônico (evento 110180 do CT-e).
  recebedorNome: z.string().trim().max(120).nullable().optional(),
  recebedorDoc: z.string().trim().max(20).nullable().optional(),
});
export type AtualizarViagemInput = z.infer<typeof AtualizarViagemInput>;

/**
 * Painel escolhe a estrada de uma viagem já lançada.
 *
 * Existe porque o motorista lançou numa época em que a tela oferecia uma opção
 * só (ou nenhuma), e quem opera a plataforma precisa poder corrigir o traçado
 * depois, com calma — sem cobrar do motorista que volte no passado.
 *
 * A geometria NÃO vem do cliente por confiança: o backend recalcula as
 * alternativas do par e só aceita uma que esteja na lista. Assim ninguém
 * desenha uma linha arbitrária no comprovante de uma viagem.
 */
export const EscolherRotaViagemInput = z.object({
  /** Polyline (precisão 5) de uma das alternativas devolvidas por GET :id/rotas. */
  geometria: z.string().min(1),
  /**
   * Levar o km faturado junto com a estrada escolhida. Falso = só o traçado
   * muda, o km fica como está. O km do motorista é lei: só cede com motivo.
   */
  atualizarKm: z.boolean().default(false),
  motivo: z
    .string()
    .trim()
    .min(10, "Explique em pelo menos 10 caracteres por que está alterando o km.")
    .max(300, "Motivo muito longo (máx. 300 caracteres).")
    .optional(),
});
export type EscolherRotaViagemInput = z.infer<typeof EscolherRotaViagemInput>;
