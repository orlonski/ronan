import type { CalendarioConferencia, DiaDoCalendarioConferencia, EventoTrilhaConferencia } from "@ronan/shared-types";
import { somarDias, hojeYmd } from "./conferencia-diaria";
import { lerTrilha } from "./conferencia-trilha";
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
 *
 * PERGUNTAS ANTERIORES (histórica) — a linha do teste é a linha do job de HOJE
 * (`@@unique [conta, motorista, dia]`), então um novo teste ZERA a linha e ela passa
 * a apontar para outro dia; o que o motorista já tinha respondido sobre o dia antigo
 * só sobra (1) no evento `TESTE` da trilha (`detalhe.antes` = estado antes do reset,
 * com `antes.diaPerguntado`) e (2) em `snapshot.perguntasAnteriores`, cópia durável
 * gravada no reset (a trilha guarda só os 20 eventos mais recentes e cada pergunta
 * gasta ~6, então teste "velho" some dela). O calendário reconstrói dessas duas fontes:
 *  - só entra pergunta que SAIU (ENVIADA/RESPONDIDA/EXPIRADA); fila/falha/suprimida não;
 *  - reenvio pro MESMO dia não é histórica (é a mesma pergunta);
 *  - a pergunta ATUAL do dia sempre vence; entre históricas do mesmo dia vale a mais
 *    recente (a que foi zerada por último);
 *  - conta em `perguntados`/`respondidos`/`retroativos`/`semResposta` como a atual: foi
 *    pergunta real enviada. `semCanal` nunca (histórica não tem canal);
 *  - `snapshot.diasPerguntadosAntes` sozinho (só o dia, sem estado) NÃO vira pergunta:
 *    inventar "esperando" seria mentir; sem estado recuperável o dia fica como estava.
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
  /** Só vêm quando o chamador pediu "dados técnicos". */
  id?: string;
  wamid?: string | null;
  respostaTexto?: string | null;
  erroEnvio?: string | null;
  reenvios?: number;
  trilha?: unknown;
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
    // SEM_MOVIMENTO não é pergunta nem falha de canal: a regra de atividade poupou o motorista.
    if (l.suprimidaPor === "SEM_MOVIMENTO") return false;
    const snap = l.snapshot as { deveriaPerguntar?: boolean } | null;
    return snap?.deveriaPerguntar === true && l.suprimidaPor != null;
  }
  return false; // SOMBRA: nada foi enviado, é registro interno.
}

export function ultimoDiaDoMes(mes: string): Ymd {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

type Anterior = {
  dia: Ymd;
  estado: string;
  opcao: string | null;
  wamid: string | null;
  enviadaEm: Date | null;
  respondidaEm: Date | null;
  respostaTexto: string | null;
  /** Quando a linha foi zerada (o instante em que esta pergunta deixou de ser a da linha). */
  zeradaEm: number;
  linha: LinhaParaCalendario;
  /** Evento da trilha de onde veio (a cópia do snapshot não tem). */
  evento?: EventoTrilhaConferencia;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const paraData = (v: unknown): Date | null => {
  const t = typeof v === "string" ? new Date(v) : null;
  return t && !Number.isNaN(t.getTime()) ? t : null;
};

function deEstado(o: unknown, zeradaEm: number, linha: LinhaParaCalendario, evento?: EventoTrilhaConferencia): Anterior | null {
  if (!o || typeof o !== "object") return null;
  const a = o as Record<string, unknown>;
  const dia = str(a.diaPerguntado) ?? str(a.dia);
  const estado = str(a.estado);
  if (!dia || !YMD.test(dia) || !estado || !ESTADOS_ENVIADOS.has(estado) || !Number.isFinite(zeradaEm)) return null;
  return {
    dia,
    estado,
    opcao: str(a.opcao),
    wamid: str(a.wamid),
    enviadaEm: paraData(a.enviadaEm),
    respondidaEm: paraData(a.respondidaEm),
    respostaTexto: str(a.respostaTexto),
    zeradaEm,
    linha,
    evento,
  };
}

/**
 * As perguntas que uma linha JÁ FEZ sobre outros dias e que o reset apagou dela
 * (regra pura, testada). Lê `TESTE`/`REENVIO`/qualquer evento com `detalhe.antes` e
 * `snapshot.perguntasAnteriores`; JSON antigo (sem `antes.diaPerguntado`) é ignorado.
 * Limite: a trilha guarda 20 eventos; o que já saiu dela só sobrevive na cópia do snapshot.
 */
export function perguntasAnterioresDaLinha(l: LinhaParaCalendario): Anterior[] {
  const atual = diaPerguntado(l);
  const achadas: Anterior[] = [];
  for (const e of lerTrilha(l.trilha)) {
    const d = e.detalhe as Record<string, unknown>;
    const a = deEstado(d.antes, new Date(e.em).getTime(), l, e);
    if (!a) continue;
    // Reenvio pro MESMO dia: é a mesma pergunta, não histórica.
    if (a.dia === (str(d.diaPerguntado) ?? atual)) continue;
    achadas.push(a);
  }
  const snap = l.snapshot as { perguntasAnteriores?: unknown } | null;
  if (Array.isArray(snap?.perguntasAnteriores)) {
    for (const o of snap.perguntasAnteriores as unknown[]) {
      const a = deEstado(o, paraData((o as Record<string, unknown> | null)?.zeradaEm)?.getTime() ?? NaN, l);
      if (a && a.dia !== atual) achadas.push(a);
    }
  }
  return achadas;
}

export function montarCalendarioConferencia(input: {
  /** YYYY-MM */
  mes: string;
  viagens: ViagemParaCalendario[];
  linhas: LinhaParaCalendario[];
  agora: Date;
  /** Anexa os "dados técnicos" de cada dia perguntado (wamid, trilha…). */
  incluirTecnico?: boolean;
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

  // Perguntas anteriores (zeradas por teste/reenvio): a mais recente por dia, e a atual sempre vence.
  const anteriorPorDia = new Map<Ymd, Anterior>();
  for (const l of input.linhas) {
    for (const a of perguntasAnterioresDaLinha(l)) {
      if (a.dia < primeiro || a.dia > ultimo || perguntaPorDia.has(a.dia)) continue;
      const outra = anteriorPorDia.get(a.dia);
      if (!outra || a.zeradaEm >= outra.zeradaEm) anteriorPorDia.set(a.dia, a);
    }
  }

  const dias: DiaDoCalendarioConferencia[] = [];
  const totais = { diasComViagem: 0, perguntados: 0, respondidos: 0, retroativos: 0, semResposta: 0, semCanal: 0 };
  type Est = NonNullable<DiaDoCalendarioConferencia["pergunta"]>["estado"];
  type Opc = NonNullable<DiaDoCalendarioConferencia["pergunta"]>["resposta"];

  for (let d = primeiro; d <= ultimo; d = somarDias(d, 1)) {
    const viagens = porDia.get(d) ?? [];
    const linha = perguntaPorDia.get(d);
    const anterior = linha ? undefined : anteriorPorDia.get(d);
    const item: DiaDoCalendarioConferencia = { dia: d, lancou: viagens.length > 0, viagens: viagens.length };
    if (item.lancou) totais.diasComViagem++;

    const fonte = linha
      ? {
          estado: linha.estado,
          enviadaEm: ESTADOS_ENVIADOS.has(linha.estado) ? (linha.enviadaEm ?? linha.criadoEm) : null,
          respondidaEm: linha.respondidaEm,
          opcao: linha.opcao,
          semCanal: linha.estado === "SUPRIMIDA" ? linha.suprimidaPor : null,
        }
      : anterior
        ? {
            estado: anterior.estado,
            enviadaEm: anterior.enviadaEm ?? anterior.linha.criadoEm,
            respondidaEm: anterior.respondidaEm,
            opcao: anterior.opcao,
            semCanal: null,
          }
        : null;

    if (fonte) {
      const { enviadaEm, semCanal } = fonte;
      const depois = enviadaEm
        ? viagens
            .map((v) => (v.criadoOfflineEm && v.criadoOfflineEm < v.sincronizadoEm ? v.criadoOfflineEm : v.sincronizadoEm))
            .filter((t) => t.getTime() > enviadaEm.getTime())
            .sort((a, b) => a.getTime() - b.getTime())
        : [];
      const base = linha ?? anterior!.linha;
      let tecnico: NonNullable<typeof item.pergunta>["tecnico"];
      if (input.incluirTecnico && base.id) {
        if (linha) {
          tecnico = {
            id: base.id,
            estado: linha.estado as Est,
            opcao: (linha.opcao as Opc) ?? null,
            wamid: linha.wamid ?? null,
            enviadaEm: linha.enviadaEm ? linha.enviadaEm.toISOString() : null,
            respondidaEm: linha.respondidaEm ? linha.respondidaEm.toISOString() : null,
            respostaTexto: linha.respostaTexto ?? null,
            erroEnvio: linha.erroEnvio ?? null,
            reenvios: linha.reenvios ?? 0,
            trilha: lerTrilha(linha.trilha),
          };
        } else if (anterior) {
          // Só o que a trilha guarda: o estado de antes do reset + os eventos do mesmo wamid.
          const doWamid = anterior.wamid
            ? lerTrilha(anterior.linha.trilha).filter((e) => (e.detalhe as Record<string, unknown>).wamid === anterior.wamid)
            : [];
          const trilha = [...(anterior.evento ? [anterior.evento] : []), ...doWamid.filter((e) => e !== anterior.evento)].sort((a, b) =>
            a.em.localeCompare(b.em),
          );
          tecnico = {
            id: base.id,
            estado: anterior.estado as Est,
            opcao: (anterior.opcao as Opc) ?? null,
            wamid: anterior.wamid,
            enviadaEm: anterior.enviadaEm ? anterior.enviadaEm.toISOString() : null,
            respondidaEm: anterior.respondidaEm ? anterior.respondidaEm.toISOString() : null,
            respostaTexto: anterior.respostaTexto,
            erroEnvio: null,
            reenvios: 0,
            trilha,
          };
        }
      }
      item.pergunta = {
        estado: fonte.estado as Est,
        enviadaEm: enviadaEm ? enviadaEm.toISOString() : null,
        respondidaEm: fonte.respondidaEm ? fonte.respondidaEm.toISOString() : null,
        resposta: (fonte.opcao as Opc) ?? null,
        semCanal,
        retroativo: depois.length > 0,
        lancouDepoisEm: depois[0] ? depois[0].toISOString() : null,
        viagensDepois: depois.length,
        linhaDia: base.dia,
        ...(anterior ? { historica: true, origem: "TESTE_ANTERIOR" as const } : {}),
        ...(tecnico ? { tecnico } : {}),
      };
      if (enviadaEm) totais.perguntados++;
      if (fonte.estado === "RESPONDIDA") totais.respondidos++;
      if (fonte.estado === "EXPIRADA") totais.semResposta++;
      if (semCanal) totais.semCanal++;
      if (depois.length > 0) totais.retroativos++;
    }
    dias.push(item);
  }

  return { mes, hoje: hojeYmd(agora), dias, totais };
}
