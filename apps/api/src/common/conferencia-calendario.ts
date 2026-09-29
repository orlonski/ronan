import type { CalendarioConferencia, DiaDoCalendarioConferencia } from "@ronan/shared-types";
import { somarDias, hojeYmd } from "./conferencia-diaria";
import type { Ymd } from "./ponto-jornada";

/**
 * Calendário da conferência de viagens de UM motorista — regra PURA (sem Prisma).
 *
 * Marca o dia SOBRE O QUAL A PERGUNTA FALA (o dia esperado sem viagem, gravado no
 * snapshot), não o dia em que o job rodou.
 *
 * RETROATIVO — critério explícito: a viagem é retroativa quando tem `data` igual ao
 * dia perguntado e foi LANÇADA depois de a pergunta sair. O instante do lançamento
 * é o mais antigo entre `criadoOfflineEm` (o motorista lançou sem sinal) e
 * `sincronizadoEm` (o servidor recebeu). Assim, viagem feita offline ANTES da
 * pergunta e sincronizada depois NÃO conta como retroativa: ele já tinha lançado,
 * o sistema é que ainda não sabia. Sem pergunta enviada (fila, falha, sem canal),
 * nada é retroativo.
 */

export type ViagemParaCalendario = {
  /** `Viagem.data` (@db.Date) como Ymd. Qualquer status conta. */
  data: Ymd;
  sincronizadoEm: Date;
  criadoOfflineEm: Date | null;
};

export type LinhaParaCalendario = {
  /** Dia (Ymd) em que o job gravou a linha. */
  dia: Ymd;
  estado: string;
  suprimidaPor: string | null;
  enviadaEm: Date | null;
  respondidaEm: Date | null;
  opcao: string | null;
  criadoEm: Date;
  snapshot: unknown;
};

const ESTADOS_ENVIADOS = new Set(["ENVIADA", "RESPONDIDA", "EXPIRADA"]);

/** O dia sobre o qual a pergunta fala: o 1º dia esperado do snapshot; sem ele, o dia anterior ao do job. */
export function diaPerguntado(l: Pick<LinhaParaCalendario, "dia" | "snapshot">): Ymd {
  const snap = l.snapshot as { evidencias?: { diasEsperadosVerificados?: Ymd[] } } | null;
  return snap?.evidencias?.diasEsperadosVerificados?.[0] ?? somarDias(l.dia, -1);
}

/** Só entra no calendário o que o motorista viveu (ou deveria ter vivido) como pergunta. */
function conta(l: LinhaParaCalendario): boolean {
  if (ESTADOS_ENVIADOS.has(l.estado) || l.estado === "PENDENTE" || l.estado === "FALHOU") return true;
  if (l.estado === "SUPRIMIDA") {
    const snap = l.snapshot as { deveriaPerguntar?: boolean } | null;
    return snap?.deveriaPerguntar === true && l.suprimidaPor != null;
  }
  return false; // SOMBRA: nada foi enviado, é registro interno.
}

export function ultimoDiaDoMes(mes: string): Ymd {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function montarCalendarioConferencia(input: {
  /** YYYY-MM */
  mes: string;
  viagens: ViagemParaCalendario[];
  linhas: LinhaParaCalendario[];
  agora: Date;
}): CalendarioConferencia {
  const { mes, agora } = input;
  const primeiro: Ymd = `${mes}-01`;
  const ultimo = ultimoDiaDoMes(mes);

  const porDia = new Map<Ymd, ViagemParaCalendario[]>();
  for (const v of input.viagens) {
    if (v.data < primeiro || v.data > ultimo) continue;
    const l = porDia.get(v.data) ?? [];
    l.push(v);
    porDia.set(v.data, l);
  }

  // Duas linhas pro mesmo dia perguntado (nova pergunta depois): vale a mais recente.
  const perguntaPorDia = new Map<Ymd, LinhaParaCalendario>();
  for (const l of [...input.linhas].filter(conta).sort((a, b) => a.dia.localeCompare(b.dia))) {
    const ref = diaPerguntado(l);
    if (ref < primeiro || ref > ultimo) continue;
    perguntaPorDia.set(ref, l);
  }

  const dias: DiaDoCalendarioConferencia[] = [];
  const totais = { diasComViagem: 0, perguntados: 0, respondidos: 0, retroativos: 0, semResposta: 0, semCanal: 0 };

  for (let d = primeiro; d <= ultimo; d = somarDias(d, 1)) {
    const viagens = porDia.get(d) ?? [];
    const linha = perguntaPorDia.get(d);
    const item: DiaDoCalendarioConferencia = { dia: d, lancou: viagens.length > 0, viagens: viagens.length };
    if (item.lancou) totais.diasComViagem++;

    if (linha) {
      const enviadaEm = ESTADOS_ENVIADOS.has(linha.estado) ? (linha.enviadaEm ?? linha.criadoEm) : null;
      const depois = enviadaEm
        ? viagens
            .map((v) => (v.criadoOfflineEm && v.criadoOfflineEm < v.sincronizadoEm ? v.criadoOfflineEm : v.sincronizadoEm))
            .filter((t) => t.getTime() > enviadaEm.getTime())
            .sort((a, b) => a.getTime() - b.getTime())
        : [];
      const semCanal = linha.estado === "SUPRIMIDA" ? linha.suprimidaPor : null;
      item.pergunta = {
        estado: linha.estado as NonNullable<typeof item.pergunta>["estado"],
        enviadaEm: enviadaEm ? enviadaEm.toISOString() : null,
        respondidaEm: linha.respondidaEm ? linha.respondidaEm.toISOString() : null,
        resposta: (linha.opcao as NonNullable<typeof item.pergunta>["resposta"]) ?? null,
        semCanal,
        retroativo: depois.length > 0,
        lancouDepoisEm: depois[0] ? depois[0].toISOString() : null,
        viagensDepois: depois.length,
      };
      if (enviadaEm) totais.perguntados++;
      if (linha.estado === "RESPONDIDA") totais.respondidos++;
      if (linha.estado === "EXPIRADA") totais.semResposta++;
      if (semCanal) totais.semCanal++;
      if (depois.length > 0) totais.retroativos++;
    }
    dias.push(item);
  }

  return { mes, hoje: hojeYmd(agora), dias, totais };
}
