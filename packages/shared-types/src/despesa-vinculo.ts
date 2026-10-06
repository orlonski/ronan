/**
 * "Foi nesta viagem?" — qual viagem SUGERIR pra um gasto.
 *
 * Uma função, dois lugares: a API (fila do painel) e o app (offline, com as
 * viagens do cache + as que ainda estão no celular). Divergir faria o celular
 * sugerir uma viagem e o painel outra.
 *
 * Nunca vincula sozinha e nunca vem marcada: é sugestão. Quem decide é gente.
 *
 * ⚠️ Pura e sem `Intl`: roda no Hermes. O dia civil é o de São Paulo por
 * deslocamento fixo de −3h (o Brasil não tem horário de verão desde 2019).
 */

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Tolerância padrão pra cada lado da janela da viagem guiada. */
export const TOLERANCIA_VINCULO_MIN_PADRAO = 120;

type Instante = Date | string | number;

function ms(v: Instante): number {
  return v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime();
}

/** "YYYY-MM-DD" do dia civil de São Paulo de um instante. */
export function diaSaoPauloDe(instante: Instante): string {
  return new Date(ms(instante) - SP_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instante de 00:00 em São Paulo do dia "YYYY-MM-DD". */
function inicioDiaSP(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getTime() + SP_OFFSET_MS;
}

/** `Viagem.data` é @db.Date (meia-noite UTC do dia civil): o dia é o texto. */
function ymdDaData(data: Date | string | null | undefined): string | null {
  if (data == null) return null;
  if (data instanceof Date) return Number.isNaN(data.getTime()) ? null : data.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(data);
  return m ? m[1]! : null;
}

export type ViagemParaSugestao = {
  id: string;
  clientId?: string | null;
  motoristaId?: string | null;
  veiculoId?: string | null;
  /** Dia da viagem (@db.Date ou "YYYY-MM-DD"). */
  data?: Date | string | null;
  /** Quando ele tocou Iniciar (viagem guiada). */
  iniciadoEm?: Instante | null;
  /** Quando terminou, se o banco souber. Sem isso, cai no fim do dia (ou "agora" em andamento). */
  finalizadoEm?: Instante | null;
  status?: string | null;
};

export type GastoParaSugestao = {
  data: Instante;
  motoristaId?: string | null;
  veiculoId?: string | null;
};

export type JanelaViagem = { inicio: number; fim: number };

/**
 * A janela de tempo em que a viagem aconteceu.
 *
 * - Guiada (tem `iniciadoEm`): do início − tolerância até o fim + tolerância.
 *   O fim é `finalizadoEm`; sem ele, "agora" se ainda está em andamento, senão
 *   o fim do dia da viagem (a viagem não guarda a hora do fim — usa a data).
 * - Manual (sem `iniciadoEm`): o dia civil de São Paulo da `data`, inteiro.
 * - Sem nada: null (não dá pra sugerir).
 */
export function janelaDaViagem(
  v: ViagemParaSugestao,
  toleranciaMin = TOLERANCIA_VINCULO_MIN_PADRAO,
  agora: Instante = Date.now(),
): JanelaViagem | null {
  const tol = toleranciaMin * 60_000;
  const dia = ymdDaData(v.data ?? null);
  if (v.iniciadoEm != null && !Number.isNaN(ms(v.iniciadoEm))) {
    const ini = ms(v.iniciadoEm);
    let fim: number;
    if (v.finalizadoEm != null && !Number.isNaN(ms(v.finalizadoEm))) fim = ms(v.finalizadoEm);
    else if (v.status === "EM_ANDAMENTO") fim = Math.max(ms(agora), ini);
    else fim = Math.max(inicioDiaSP(dia ?? diaSaoPauloDe(ini)) + DIA_MS - 1, ini);
    return { inicio: ini - tol, fim: fim + tol };
  }
  if (!dia) return null;
  const ini = inicioDiaSP(dia);
  return { inicio: ini, fim: ini + DIA_MS - 1 };
}

export type SugestaoViagem<V extends ViagemParaSugestao = ViagemParaSugestao> = {
  viagem: V;
  /** FORTE: dentro da janela (mesmo caminhão, ou gasto sem caminhão). MEDIA: mesmo dia, fora da janela ou outro caminhão. */
  forca: "FORTE" | "MEDIA";
  janela: JanelaViagem;
};

/**
 * Ranqueia as viagens candidatas pra um gasto. A primeira é a sugestão.
 *
 * Só viagens do MESMO motorista (quando os dois lados sabem quem é). Viagem
 * cancelada nunca é sugerida. Empate: a de janela mais curta (mais precisa),
 * depois a que começou mais perto do gasto.
 */
export function sugerirViagens<V extends ViagemParaSugestao>(
  gasto: GastoParaSugestao,
  viagens: readonly V[],
  opcoes: { toleranciaMin?: number; agora?: Instante } = {},
): SugestaoViagem<V>[] {
  const t = ms(gasto.data);
  if (Number.isNaN(t)) return [];
  const diaGasto = diaSaoPauloDe(t);
  const saida: (SugestaoViagem<V> & { _ord: number[] })[] = [];

  for (const v of viagens) {
    if (gasto.motoristaId && v.motoristaId && gasto.motoristaId !== v.motoristaId) continue;
    if (v.status === "CANCELADA") continue;
    const janela = janelaDaViagem(v, opcoes.toleranciaMin, opcoes.agora);
    if (!janela) continue;
    const dentro = t >= janela.inicio && t <= janela.fim;
    const mesmoCaminhao = !gasto.veiculoId || !v.veiculoId || gasto.veiculoId === v.veiculoId;
    const diaViagem = ymdDaData(v.data ?? null) ?? diaSaoPauloDe(janela.inicio);
    let forca: "FORTE" | "MEDIA" | null = null;
    if (dentro && mesmoCaminhao) forca = "FORTE";
    else if (dentro || diaViagem === diaGasto) forca = "MEDIA";
    if (!forca) continue;
    saida.push({
      viagem: v,
      forca,
      janela,
      _ord: [forca === "FORTE" ? 0 : 1, janela.fim - janela.inicio, Math.abs(t - janela.inicio)],
    });
  }

  saida.sort((a, b) => {
    for (let i = 0; i < a._ord.length; i++) {
      const d = a._ord[i]! - b._ord[i]!;
      if (d !== 0) return d;
    }
    return 0;
  });
  return saida.map(({ _ord: _, ...s }) => s);
}

/** "06:40–15:10" (ou "dia inteiro") pra mostrar a janela, em horário de SP. */
export function textoJanela(j: JanelaViagem): string {
  const hm = (x: number) => new Date(x - SP_OFFSET_MS).toISOString().slice(11, 16);
  if (j.fim - j.inicio >= DIA_MS - 1000) return "dia inteiro";
  return `${hm(j.inicio)}–${hm(j.fim)}`;
}
