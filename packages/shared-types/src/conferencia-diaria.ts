import { z } from "zod";

// Conferência diária de viagens: "você esqueceu de lançar alguma viagem?".
// Modo SOMBRA: só registra quem SERIA perguntado. Modo ENVIANDO: manda a pergunta
// pelo WhatsApp (template da Meta com 4 botões) e trata a resposta. Os enums
// espelham os do Prisma.

export const RegraConferenciaDiaria = z.enum(["SEM_VIAGEM_NO_DIA_ANTERIOR", "SEM_VIAGEM_HA_N_DIAS"]);
export type RegraConferenciaDiaria = z.infer<typeof RegraConferenciaDiaria>;

export const ModoConferenciaDiaria = z.enum(["SOMBRA", "ENVIANDO"]);
export type ModoConferenciaDiaria = z.infer<typeof ModoConferenciaDiaria>;

export const QuemEntraConferenciaDiaria = z.enum(["TODOS_APROVADOS", "SO_MODALIDADES"]);
export type QuemEntraConferenciaDiaria = z.infer<typeof QuemEntraConferenciaDiaria>;

/**
 * Quem vê o lembrete dentro do app. SO_QUEM_SAIU = quem tocou "Parar perguntas" no
 * WhatsApp (o app é o canal que sobra pra ele); TODOS_QUE_ATRASARAM = qualquer motorista.
 */
export const LembreteAppParaQuem = z.enum(["SO_QUEM_SAIU", "TODOS_QUE_ATRASARAM"]);
export type LembreteAppParaQuem = z.infer<typeof LembreteAppParaQuem>;

export const EstadoConferenciaDiaria = z.enum([
  "SOMBRA",
  "SUPRIMIDA",
  "PENDENTE",
  "ENVIADA",
  "RESPONDIDA",
  "EXPIRADA",
  "FALHOU",
]);
export type EstadoConferenciaDiaria = z.infer<typeof EstadoConferenciaDiaria>;

/** O que o motorista respondeu. AMBIGUA = texto livre que não bate com nenhum botão. */
export const OpcaoConferenciaDiaria = z.enum([
  "NAO_TIVE",
  "TIVE_NAO_LANCEI",
  "SAI_DA_EMPRESA",
  "PARAR",
  "AMBIGUA",
]);
export type OpcaoConferenciaDiaria = z.infer<typeof OpcaoConferenciaDiaria>;

/**
 * Os quatro botões do template, NA ORDEM em que aparecem. O rótulo é o que a Meta
 * congela no template aprovado; o `payload` que volta no toque é `cv:<id>:<opcao>`.
 */
export const BOTOES_CONFERENCIA_DIARIA = [
  { opcao: "NAO_TIVE", rotulo: "Não tive" },
  { opcao: "TIVE_NAO_LANCEI", rotulo: "Tive, não lancei" },
  { opcao: "SAI_DA_EMPRESA", rotulo: "Saí da empresa" },
  { opcao: "PARAR", rotulo: "Parar perguntas" },
] as const satisfies readonly { opcao: Exclude<OpcaoConferenciaDiaria, "AMBIGUA">; rotulo: string }[];

/** Payload do botão. Cabe folgado nos 256 caracteres que a Meta aceita. */
export function payloadConferencia(conferenciaId: string, opcao: OpcaoConferenciaDiaria): string {
  return `cv:${conferenciaId}:${opcao}`;
}

const PAYLOAD_CONFERENCIA = /^cv:([0-9a-fA-F-]{8,64}):([A-Z_]+)$/;

/** Lê `cv:<id>:<opcao>`. `null` = não é payload da conferência (ou a opção não existe). */
export function lerPayloadConferencia(
  payload: string | undefined | null,
): { conferenciaId: string; opcao: Exclude<OpcaoConferenciaDiaria, "AMBIGUA"> } | null {
  const m = PAYLOAD_CONFERENCIA.exec(payload ?? "");
  if (!m) return null;
  const achou = BOTOES_CONFERENCIA_DIARIA.find((b) => b.opcao === m[2]);
  return achou ? { conferenciaId: m[1]!, opcao: achou.opcao } : null;
}

export const TipoSugestaoGestor = z.enum([
  "INATIVAR_VINCULO",
  "LANCAR_VIAGEM_FALTANTE",
  "RESPOSTA_AMBIGUA",
  "MOTORISTA_PAROU_WHATSAPP",
  "WHATSAPP_INALCANCAVEL",
  "NUMERO_ERRADO",
]);
export type TipoSugestaoGestor = z.infer<typeof TipoSugestaoGestor>;

export const StatusSugestaoGestor = z.enum([
  "ABERTA",
  "APROVADA",
  "RECUSADA",
  "RESOLVIDA_SOZINHA",
  "EXPIRADA",
]);
export type StatusSugestaoGestor = z.infer<typeof StatusSugestaoGestor>;

/** Recusar ou aprovar pede um motivo só quando o gestor quiser deixar um. */
export const DecidirSugestaoGestorSchema = z.object({
  motivo: z.string().trim().max(500).optional(),
});
export type DecidirSugestaoGestor = z.infer<typeof DecidirSugestaoGestorSchema>;

/**
 * Limite TÉCNICO (não é regra de negócio) de motoristas por chamada de "Confirmar todos":
 * protege o servidor de um corpo gigante. A lista do dia de uma empresa grande cabe folgada.
 */
export const LIMITE_CONFIRMAR_TELEFONES_POR_CHAMADA = 500;

/** "Confirmar os N números desta lista": os motoristas que o escritório garante serem donos do telefone. */
export const ConfirmarTelefonesSchema = z.object({
  motoristaIds: z.array(z.string().uuid()).min(1, "Escolha pelo menos um motorista.").max(LIMITE_CONFIRMAR_TELEFONES_POR_CHAMADA),
});
export type ConfirmarTelefones = z.infer<typeof ConfirmarTelefonesSchema>;

/** Resposta de confirmar telefone(s): quantos foram confirmados agora e quantos já estavam. */
export type ResultadoConfirmarTelefones = { confirmados: number; jaConfirmados: number; semTelefone: number };

/** Mínimo de caracteres do motivo pra religar quem o PRÓPRIO motorista desligou. */
export const MOTIVO_RELIGAR_MIN = 5;

/**
 * Liga/desliga a conferência de UM motorista pelo painel. Vale só pra este
 * vínculo (decisão da empresa sobre o próprio cadastro). O motivo é opcional no
 * schema porque só é obrigatório em um caso (religar quem o motorista desligou),
 * que depende do estado no banco e é conferido no serviço.
 */
export const DefinirRecebimentoConferenciaSchema = z.object({
  recebe: z.boolean(),
  motivo: z.string().trim().max(500).optional(),
});
export type DefinirRecebimentoConferencia = z.infer<typeof DefinirRecebimentoConferenciaSchema>;

/** Resposta do PATCH: o estado novo, no mesmo formato que a ficha e a lista leem. */
export type EstadoConferenciaMotorista = {
  motoristaId: string;
  receberConferenciaDiaria: boolean;
  conferenciaDesligadaEm: string | null;
  conferenciaDesligadaOrigem: "MOTORISTA" | "PAINEL" | null;
  conferenciaDesligadaPor: { id: string; nome: string } | null;
  conferenciaDesligadaMotivo: string | null;
};

/** Texto padrão de orientação depois de "Parar perguntas". {empresa} e {contato} são trocados. */
export const MENSAGEM_AO_PARAR_PADRAO =
  "Certo, não vamos mais enviar essa pergunta. Só lembrando: viagem que não é lançada no app não entra no seu acerto. Qualquer dúvida, fale com {empresa}{contato}. Se mudar de ideia, é só responder VOLTAR aqui.";

/** Monta a orientação: `{contato}` vira " (contato)" ou some quando a empresa não informou. */
export function montarMensagemAoParar(
  modelo: string | null | undefined,
  empresa: string,
  contato: string | null | undefined,
): string {
  const base = modelo?.trim() ? modelo : MENSAGEM_AO_PARAR_PADRAO;
  const c = contato?.trim() ? ` (${contato.trim()})` : "";
  return base.replaceAll("{empresa}", empresa).replaceAll("{contato}", c);
}

/** Dia da semana como o `getDay()`: 0 = domingo … 6 = sábado. */
const DiaDaSemana = z.number().int().min(0).max(6);

function semRepeticao(v: number[]): boolean {
  return new Set(v).size === v.length;
}

const listaDeDias = (nome: string) =>
  z
    .array(DiaDaSemana)
    .max(7)
    .refine(semRepeticao, { message: `${nome}: dia repetido.` });

/**
 * Guarda TÉCNICA de validação do campo `janelaAtividadeDias` (não é regra de negócio):
 * 0 desliga a regra; o valor que vale é o que cada empresa escolhe na tela. O piso evita
 * uma janela tão curta que barraria motorista em atividade normal (folga, feriado
 * prolongado); o teto é o de um ano, além do qual "parado" deixa de ter sentido.
 */
export const JANELA_ATIVIDADE_VALIDACAO_MIN_DIAS = 7;
export const JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS = 365;

/**
 * PADRÕES INICIAIS (seed) dos três limites de envio. São os valores que valiam quando
 * eram fixos no código: a coluna nasce com eles e o serviço os usa só como fallback
 * quando a empresa ainda não tem linha de configuração. Quem manda é a config da empresa.
 */
export const PADRAO_HORAS_TOLERANCIA_ENVIO = 3;
export const PADRAO_LEMBRETE_HORA_MIN = 7;
export const PADRAO_LEMBRETE_HORA_MAX = 21;
export const PADRAO_MAX_REENVIOS_POR_PERGUNTA = 5;

/** Limites TÉCNICOS de validação (não são regra de negócio): o que a tela e a API aceitam gravar. */
export const TOLERANCIA_ENVIO_VALIDACAO_MIN_HORAS = 0;
export const TOLERANCIA_ENVIO_VALIDACAO_MAX_HORAS = 12;
export const LEMBRETE_HORA_VALIDACAO_MIN = 0;
export const LEMBRETE_HORA_VALIDACAO_MAX = 24;
export const MAX_REENVIOS_VALIDACAO_MIN = 1;
export const MAX_REENVIOS_VALIDACAO_MAX = 50;

/** A regra da conferência diária, como o painel edita. */
export const AtualizarConfigConferenciaDiariaSchema = z
  .object({
    ativo: z.boolean(),
    modo: ModoConferenciaDiaria,
    horaEnvio: z.number().int().min(0).max(23),
    diasDoJob: listaDeDias("Dias do job"),
    regra: RegraConferenciaDiaria,
    diasSemViagem: z.number().int().min(1).max(30),
    diasConsiderados: listaDeDias("Dias considerados"),
    ignorarFeriados: z.boolean(),
    incluirQueNuncaLancou: z.boolean(),
    intervaloMinimoDias: z.number().int().min(1).max(30),
    maxPerguntasPorSemana: z.number().int().min(1).max(7),
    quemEntra: QuemEntraConferenciaDiaria,
    modalidadeIds: z.array(z.string().uuid()).max(200),
    transportadoraIds: z.array(z.string().uuid()).max(200),
    reenviar: z.boolean(),
    horasParaLembrar: z.number().int().min(1).max(48),
    horasParaExpirar: z.number().int().min(2).max(72),
    mensagemAoParar: z.string().trim().max(600).nullable(),
    contatoEmpresa: z.string().trim().max(120).nullable(),
    suprimirResumoQuemRecebeuPergunta: z.boolean(),
    mensagensParaSuspeitar: z.number().int().min(2).max(10),
    diasParaSuspeitar: z.number().int().min(2).max(30),
    lembreteNoApp: z.boolean(),
    lembreteParaQuem: LembreteAppParaQuem,
    diasParaLembreteNoApp: z.number().int().min(1).max(30),
    janelaAtividadeDias: z
      .number({ invalid_type_error: "Informe um número de dias." })
      .int("Informe um número inteiro de dias.")
      .refine(
        (v) => v === 0 || (v >= JANELA_ATIVIDADE_VALIDACAO_MIN_DIAS && v <= JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS),
        {
          message: `Use 0 (perguntar a todos) ou um valor entre ${JANELA_ATIVIDADE_VALIDACAO_MIN_DIAS} e ${JANELA_ATIVIDADE_VALIDACAO_MAX_DIAS} dias.`,
        },
      ),
    horasToleranciaEnvio: z
      .number({ invalid_type_error: "Informe um número de horas." })
      .int("Informe um número inteiro de horas.")
      .min(TOLERANCIA_ENVIO_VALIDACAO_MIN_HORAS, `Use de ${TOLERANCIA_ENVIO_VALIDACAO_MIN_HORAS} a ${TOLERANCIA_ENVIO_VALIDACAO_MAX_HORAS} horas.`)
      .max(TOLERANCIA_ENVIO_VALIDACAO_MAX_HORAS, `Use de ${TOLERANCIA_ENVIO_VALIDACAO_MIN_HORAS} a ${TOLERANCIA_ENVIO_VALIDACAO_MAX_HORAS} horas.`),
    lembreteHoraMin: z
      .number({ invalid_type_error: "Informe uma hora." })
      .int("Informe uma hora inteira.")
      .min(0, "A hora inicial do lembrete vai de 0 a 23.")
      .max(23, "A hora inicial do lembrete vai de 0 a 23."),
    lembreteHoraMax: z
      .number({ invalid_type_error: "Informe uma hora." })
      .int("Informe uma hora inteira.")
      .min(1, "A hora final do lembrete vai de 1 a 24.")
      .max(LEMBRETE_HORA_VALIDACAO_MAX, "A hora final do lembrete vai de 1 a 24."),
    soPerguntarNumeroConfirmado: z.boolean(),
    maxReenviosPorPergunta: z
      .number({ invalid_type_error: "Informe um número de reenvios." })
      .int("Informe um número inteiro de reenvios.")
      .min(MAX_REENVIOS_VALIDACAO_MIN, `Use de ${MAX_REENVIOS_VALIDACAO_MIN} a ${MAX_REENVIOS_VALIDACAO_MAX} reenvios por dia.`)
      .max(MAX_REENVIOS_VALIDACAO_MAX, `Use de ${MAX_REENVIOS_VALIDACAO_MIN} a ${MAX_REENVIOS_VALIDACAO_MAX} reenvios por dia.`),
  })
  .partial()
  .superRefine((v, ctx) => {
    if (v.lembreteHoraMin !== undefined && v.lembreteHoraMax !== undefined && v.lembreteHoraMin >= v.lembreteHoraMax) {
      ctx.addIssue({
        code: "custom",
        path: ["lembreteHoraMax"],
        message: "A hora final do lembrete tem que ser depois da hora inicial.",
      });
    }
    if (v.diasDoJob && v.diasDoJob.length === 0) {
      ctx.addIssue({ code: "custom", path: ["diasDoJob"], message: "Escolha pelo menos um dia em que a conferência roda." });
    }
    if (v.diasConsiderados && v.diasConsiderados.length === 0) {
      ctx.addIssue({ code: "custom", path: ["diasConsiderados"], message: "Escolha pelo menos um dia esperado de viagem." });
    }
  });
export type AtualizarConfigConferenciaDiaria = z.infer<typeof AtualizarConfigConferenciaDiariaSchema>;

export const ConfigConferenciaDiaria = z.object({
  id: z.string(),
  ativo: z.boolean(),
  modo: ModoConferenciaDiaria,
  horaEnvio: z.number(),
  diasDoJob: z.array(z.number()),
  regra: RegraConferenciaDiaria,
  diasSemViagem: z.number(),
  diasConsiderados: z.array(z.number()),
  ignorarFeriados: z.boolean(),
  incluirQueNuncaLancou: z.boolean(),
  intervaloMinimoDias: z.number(),
  maxPerguntasPorSemana: z.number(),
  quemEntra: QuemEntraConferenciaDiaria,
  modalidadeIds: z.array(z.string()),
  transportadoraIds: z.array(z.string()),
  reenviar: z.boolean(),
  horasParaLembrar: z.number(),
  horasParaExpirar: z.number(),
  mensagemAoParar: z.string().nullable(),
  contatoEmpresa: z.string().nullable(),
  suprimirResumoQuemRecebeuPergunta: z.boolean(),
  mensagensParaSuspeitar: z.number(),
  diasParaSuspeitar: z.number(),
  lembreteNoApp: z.boolean(),
  lembreteParaQuem: LembreteAppParaQuem,
  diasParaLembreteNoApp: z.number(),
  janelaAtividadeDias: z.number(),
  horasToleranciaEnvio: z.number(),
  lembreteHoraMin: z.number(),
  lembreteHoraMax: z.number(),
  maxReenviosPorPergunta: z.number(),
  soPerguntarNumeroConfirmado: z.boolean(),
});
export type ConfigConferenciaDiaria = z.infer<typeof ConfigConferenciaDiaria>;

const NOMES_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * A regra em português claro, pra tela e pro histórico. Gerada da MESMA config
 * que o sistema executa — a tela mostra isto ao vivo, então quem lê sabe
 * exatamente o que vai acontecer.
 */
export function descreverRegraConferencia(cfg: {
  horaEnvio: number;
  diasDoJob: number[];
  regra: RegraConferenciaDiaria;
  diasSemViagem: number;
  diasConsiderados: number[];
  ignorarFeriados: boolean;
  incluirQueNuncaLancou: boolean;
  intervaloMinimoDias: number;
  maxPerguntasPorSemana: number;
  /** Ausentes = lembrete no app desligado (config antiga / chamador que não conhece o campo). */
  lembreteNoApp?: boolean;
  lembreteParaQuem?: LembreteAppParaQuem;
  diasParaLembreteNoApp?: number;
  /** Ausente ou 0 = todos são perguntados, por mais parados que estejam. */
  janelaAtividadeDias?: number;
  /** Ausente ou false = pergunta a todos, com o número confirmado ou não. */
  soPerguntarNumeroConfirmado?: boolean;
  /** Ausentes = padrão inicial (não entram no texto). Só o que difere do padrão é dito. */
  reenviar?: boolean;
  horasToleranciaEnvio?: number;
  lembreteHoraMin?: number;
  lembreteHoraMax?: number;
}): string {
  const hora = `${String(cfg.horaEnvio).padStart(2, "0")}:00`;
  const quando = `${prefixoDias(cfg.diasDoJob)}, às ${hora}`;
  const esperado = descricaoDiaEsperado(cfg.diasConsiderados);
  const feriado = cfg.ignorarFeriados ? ", exceto feriado nacional" : "";
  const alvo =
    cfg.regra === "SEM_VIAGEM_NO_DIA_ANTERIOR"
      ? `não lançou viagem no último ${esperado}${feriado}`
      : `ficou ${cfg.diasSemViagem} ${cfg.diasSemViagem === 1 ? "dia esperado" : "dias esperados"} seguido${cfg.diasSemViagem === 1 ? "" : "s"} sem lançar viagem (${esperado}${feriado})`;
  const nunca = cfg.incluirQueNuncaLancou
    ? "Quem nunca lançou nenhuma viagem também entra."
    : "Quem nunca lançou nenhuma viagem não entra.";
  const freq = `No máximo 1 mensagem a cada ${cfg.intervaloMinimoDias} ${cfg.intervaloMinimoDias === 1 ? "dia" : "dias"} e ${cfg.maxPerguntasPorSemana} por semana, por motorista.`;
  const janela = cfg.janelaAtividadeDias ?? 0;
  const atividade =
    janela > 0
      ? ` Só recebe a pergunta quem lançou viagem nos últimos ${janela} dias; quem está parado há mais tempo não recebe mensagem e aparece numa lista para o escritório decidir.`
      : "";
  const confirmado = cfg.soPerguntarNumeroConfirmado
    ? " Só pergunta a quem tem o número confirmado: já usou o app, já respondeu antes ou foi confirmado pelo escritório."
    : "";
  const tol = cfg.horasToleranciaEnvio ?? PADRAO_HORAS_TOLERANCIA_ENVIO;
  const tolerancia =
    tol !== PADRAO_HORAS_TOLERANCIA_ENVIO
      ? tol === 0
        ? " Se a pergunta não sair na hora do horário, é cancelada."
        : ` Se a pergunta não sair até ${tol} ${tol === 1 ? "hora" : "horas"} depois, é cancelada.`
      : "";
  const hMin = cfg.lembreteHoraMin ?? PADRAO_LEMBRETE_HORA_MIN;
  const hMax = cfg.lembreteHoraMax ?? PADRAO_LEMBRETE_HORA_MAX;
  const janelaLembrete =
    cfg.reenviar && (hMin !== PADRAO_LEMBRETE_HORA_MIN || hMax !== PADRAO_LEMBRETE_HORA_MAX)
      ? ` Lembrete só entre ${hMin}h e ${hMax}h.`
      : "";
  const base = `${quando}, o sistema pergunta ao motorista que ${alvo}. O dia de hoje nunca conta. ${nunca}${atividade}${confirmado} ${freq}${tolerancia}${janelaLembrete}`;
  if (!cfg.lembreteNoApp) return base;
  const n = Math.max(1, cfg.diasParaLembreteNoApp ?? 3);
  const quem =
    cfg.lembreteParaQuem === "TODOS_QUE_ATRASARAM"
      ? "qualquer motorista"
      : "o motorista que pediu pra parar as perguntas no WhatsApp";
  return `${base} Além disso, o app mostra um lembrete na tela inicial para ${quem} que ficou ${n} ${n === 1 ? "dia esperado" : "dias esperados"} sem lançar viagem.`;
}

/**
 * O que a API entrega no `/m/me` (`lembreteLancamento`) quando o card deve aparecer.
 * `desde` é o dia esperado mais antigo da sequência sem viagem: viagem lançada com
 * data a partir dele desfaz o lembrete (inclusive as ainda na fila do aparelho).
 */
export const LembreteLancamentoApp = z.object({
  dias: z.number().int().min(1),
  desde: z.string(),
  calculadoEm: z.string(),
});
export type LembreteLancamentoApp = z.infer<typeof LembreteLancamentoApp>;

export function textoLembreteLancamento(dias: number): string {
  const n = Math.max(1, Math.floor(dias));
  return `Você está há ${n} ${n === 1 ? "dia" : "dias"} sem lançar viagem. Viagem que não é lançada não entra no seu acerto.`;
}

/**
 * O card aparece? Lógica pura, compartilhada com o app (que a alimenta com o
 * último `lembreteLancamento` do cache — offline segue valendo).
 *
 *  - `hoje`: Ymd de Brasília (nunca UTC do aparelho).
 *  - `dispensadoEm`: dia (Ymd) em que ele tocou "Agora não" neste cadastro.
 *  - `datasDeViagens`: dias (Ymd) das viagens que o aparelho conhece — as da lista em
 *    cache e as ainda na fila de envio. Qualquer uma com dia >= `desde` conta como lançada.
 * "Não sei" nunca inventa cobrança: sem lembrete, sem card.
 */
export function lembreteLancamentoVisivel(entrada: {
  lembrete: LembreteLancamentoApp | null | undefined;
  hoje: string;
  dispensadoEm: string | null | undefined;
  datasDeViagens: readonly string[];
}): boolean {
  const l = entrada.lembrete;
  if (!l || typeof l.dias !== "number" || typeof l.desde !== "string") return false;
  if (entrada.dispensadoEm === entrada.hoje) return false;
  return !entrada.datasDeViagens.some((d) => d >= l.desde);
}

function listaNomes(dias: number[]): string {
  const nomes = [...new Set(dias)].sort((a, b) => a - b).map((d) => NOMES_DIAS[d]);
  if (nomes.length === 0) return "nenhum dia";
  if (nomes.length === 1) return nomes[0] ?? "nenhum dia";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

const ehUteis = (dias: number[]) => new Set(dias).size === 5 && [1, 2, 3, 4, 5].every((d) => dias.includes(d));
const ehTodos = (dias: number[]) => new Set(dias).size === 7;

/** "De segunda a sexta" / "Todos os dias" / "Toda segunda, quarta e sexta". */
function prefixoDias(dias: number[]): string {
  if (ehTodos(dias)) return "Todos os dias";
  if (ehUteis(dias)) return "De segunda a sexta";
  return `Toda ${listaNomes(dias)}`;
}

/** Como o texto chama o "dia esperado de viagem". */
function descricaoDiaEsperado(dias: number[]): string {
  if (ehTodos(dias)) return "dia (qualquer dia da semana conta)";
  if (ehUteis(dias)) return "dia útil (segunda a sexta)";
  return `dia esperado (${listaNomes(dias)})`;
}

// ─── Calendário da conferência (ficha do motorista) ───────────────────────

/** `?mes=YYYY-MM`. Vazio = o mês atual em São Paulo. */
export const CalendarioConferenciaQuerySchema = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o mês no formato AAAA-MM.")
    .optional(),
});
export type CalendarioConferenciaQuery = z.infer<typeof CalendarioConferenciaQuerySchema>;

/** O que a trilha da linha registra. Um evento por coisa que aconteceu com a pergunta. */
export const EventoTrilhaConferencia = z.object({
  /** ISO 8601. */
  em: z.string(),
  evento: z.enum(["ENVIO", "TOQUE", "IGNORADO", "RESPOSTA_GRAVADA", "LEMBRETE", "EXPIRADA", "REENVIO", "TESTE", "STATUS"]),
  /**
   * Id da linha, opção, origem, `context.id`, wamid, count, motivo… — o que couber ao evento.
   * `STATUS` (recibo da Meta): `{ status, wamid, alvo: "PERGUNTA"|"LEMBRETE", codigo?, titulo?, mensagem?, metaEm? }`.
   */
  detalhe: z.record(z.unknown()),
});
export type EventoTrilhaConferencia = z.infer<typeof EventoTrilhaConferencia>;

/** Quantos eventos a trilha guarda por linha (os mais recentes). */
export const TRILHA_CONFERENCIA_MAX = 20;

/** "Dados técnicos" do dia: só sai pra quem tem `conferencia-diaria.decidir`. */
export const DadosTecnicosConferencia = z.object({
  id: z.string(),
  estado: EstadoConferenciaDiaria,
  opcao: OpcaoConferenciaDiaria.nullable(),
  wamid: z.string().nullable(),
  enviadaEm: z.string().nullable(),
  respondidaEm: z.string().nullable(),
  respostaTexto: z.string().nullable(),
  erroEnvio: z.string().nullable(),
  reenvios: z.number().int(),
  trilha: z.array(EventoTrilhaConferencia),
});
export type DadosTecnicosConferencia = z.infer<typeof DadosTecnicosConferencia>;

/** Resposta de `POST /admin/conferencia-diaria/motoristas/:id/reenviar-pergunta`. */
export const ResultadoReenvioPergunta = z.object({
  enviado: z.boolean(),
  estado: EstadoConferenciaDiaria,
  /** Preenchido quando a Meta recusou. */
  erro: z.string().nullable(),
  reenvios: z.number().int(),
});
export type ResultadoReenvioPergunta = z.infer<typeof ResultadoReenvioPergunta>;

/**
 * Até quantos dias pra trás o painel deixa "Perguntar sobre este dia". Pergunta sobre
 * um dia velho demais não faz sentido pro motorista (ele não lembra) e o calendário
 * não precisa dela. A API confere de novo: o painel só esconde o botão.
 */
export const JANELA_PERGUNTA_DE_TESTE_DIAS = 60;

/**
 * Corpo (opcional) de `POST /admin/conferencia-diaria/motoristas/:id/pergunta-de-teste`.
 * Sem corpo ou sem `dia`: pergunta sobre o último dia útil antes de hoje. Com `dia`
 * (AAAA-MM-DD): pergunta sobre AQUELE dia, que tem que ser passado e dentro da janela
 * — a conferência dos dias é da API (mensagem em PT-BR), não do schema.
 */
export const PerguntaDeTesteSchema = z.object({
  dia: z.string().max(10).optional(),
});
export type PerguntaDeTeste = z.infer<typeof PerguntaDeTesteSchema>;

/** Resposta de `POST /admin/conferencia-diaria/motoristas/:id/pergunta-de-teste`. */
export const ResultadoPerguntaDeTeste = ResultadoReenvioPergunta.extend({
  /** Telefone que recebeu, MASCARADO (o painel mostra o completo antes de enviar, na confirmação). */
  telefoneMascarado: z.string(),
  /** Id da mensagem na Meta; nulo quando não saiu. */
  wamid: z.string().nullable(),
  /** Dia (AAAA-MM-DD) sobre o qual a pergunta fala. */
  diaPerguntado: z.string(),
  /** `true` = não havia linha de hoje e o teste criou uma só pra este motorista. */
  linhaCriada: z.boolean(),
});
export type ResultadoPerguntaDeTeste = z.infer<typeof ResultadoPerguntaDeTeste>;

/** Marca no snapshot da linha que a pergunta foi pedida pelo painel, não pelo job. */
export const ORIGEM_TESTE_PAINEL = "TESTE_PAINEL";

export const PerguntaNoCalendario = z.object({
  estado: EstadoConferenciaDiaria,
  /** Quando a pergunta saiu. `null` = não saiu (na fila, falhou ou sem canal). */
  enviadaEm: z.string().nullable(),
  respondidaEm: z.string().nullable(),
  resposta: OpcaoConferenciaDiaria.nullable(),
  /** Motivo de a pergunta não poder ser feita pelo WhatsApp (SEM_TELEFONE, PAROU…). */
  semCanal: z.string().nullable(),
  /** Lançou viagem DESSE dia depois de a pergunta sair. */
  retroativo: z.boolean(),
  lancouDepoisEm: z.string().nullable(),
  viagensDepois: z.number().int(),
  /** Dia (AAAA-MM-DD) em que o job gravou a linha — o "hoje" da pergunta de hoje. Ausente em respostas antigas. */
  linhaDia: z.string().optional(),
  /**
   * `true` = pergunta ANTERIOR, reconstruída da trilha/snapshot: a linha do job de hoje foi
   * zerada por um teste/reenvio e passou a falar de outro dia. Ausente em respostas antigas.
   */
  historica: z.boolean().optional(),
  /** De onde vem a pergunta histórica. Ausente na pergunta atual. */
  origem: z.enum(["TESTE_ANTERIOR"]).optional(),
  /** Só pra quem pode decidir (`conferencia-diaria.decidir`). */
  tecnico: DadosTecnicosConferencia.optional(),
});
export type PerguntaNoCalendario = z.infer<typeof PerguntaNoCalendario>;

export const DiaDoCalendarioConferencia = z.object({
  dia: z.string(),
  lancou: z.boolean(),
  viagens: z.number().int(),
  pergunta: PerguntaNoCalendario.optional(),
});
export type DiaDoCalendarioConferencia = z.infer<typeof DiaDoCalendarioConferencia>;

export const CalendarioConferencia = z.object({
  mes: z.string(),
  hoje: z.string(),
  dias: z.array(DiaDoCalendarioConferencia),
  totais: z.object({
    diasComViagem: z.number().int(),
    perguntados: z.number().int(),
    respondidos: z.number().int(),
    retroativos: z.number().int(),
    semResposta: z.number().int(),
    semCanal: z.number().int(),
  }),
});
export type CalendarioConferencia = z.infer<typeof CalendarioConferencia>;
