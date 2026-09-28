import { z } from "zod";

// Conferência diária de viagens: "você esqueceu de lançar alguma viagem?".
// Fase 1 = modo SOMBRA: o sistema só registra quem SERIA perguntado. Nada sai
// por WhatsApp. Os enums espelham os do Prisma.

export const RegraConferenciaDiaria = z.enum(["SEM_VIAGEM_NO_DIA_ANTERIOR", "SEM_VIAGEM_HA_N_DIAS"]);
export type RegraConferenciaDiaria = z.infer<typeof RegraConferenciaDiaria>;

export const ModoConferenciaDiaria = z.enum(["SOMBRA", "ENVIANDO"]);
export type ModoConferenciaDiaria = z.infer<typeof ModoConferenciaDiaria>;

export const QuemEntraConferenciaDiaria = z.enum(["TODOS_APROVADOS", "SO_MODALIDADES"]);
export type QuemEntraConferenciaDiaria = z.infer<typeof QuemEntraConferenciaDiaria>;

export const EstadoConferenciaDiaria = z.enum(["SOMBRA", "SUPRIMIDA"]);
export type EstadoConferenciaDiaria = z.infer<typeof EstadoConferenciaDiaria>;

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
  })
  .partial()
  .superRefine((v, ctx) => {
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
  return `${quando}, o sistema pergunta ao motorista que ${alvo}. O dia de hoje nunca conta. ${nunca} ${freq}`;
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
