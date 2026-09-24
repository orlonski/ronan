/**
 * O KM ATUAL DO CAMINHÃO — estimado, e dizendo desde quando.
 *
 * O plano de manutenção por km dependia do MAIOR odômetro já anotado no
 * abastecimento. Um dígito a mais digitado uma vez (1.500.000 em vez de
 * 150.000) prendia o km lá em cima pra sempre, e quem não anota odômetro nunca
 * tinha km nenhum. Decidido com o dono em 24/09/2026 (V1 da manutenção):
 *
 *   km atual = última leitura CONFIÁVEL + km das viagens feitas depois dela.
 *
 * - Leitura conferida pelo escritório (`confiavel`) nunca é descartada: é a
 *   correção de quem olhou o painel do caminhão.
 * - Leitura de abastecimento que foge do plausível é DESCARTADA do cálculo
 *   (não apagada — o lançamento continua lá, carimbado): pulo maior que o
 *   caminhão consegue rodar no intervalo, ou um valor que o seguinte desmente.
 *
 * Função pura. Quem busca no banco é `FrotaManutencaoService.kmAtualDosVeiculos`.
 */

export type LeituraOdometro = {
  /** Dia da leitura (a hora não importa). */
  data: Date;
  odometro: number;
  /** Conferida por gente no painel do caminhão: nunca é descartada. */
  confiavel?: boolean;
  /** Pra quem chamou saber qual foi descartada. */
  ref?: string;
  /** De onde veio, pra tela dizer ("anotado no abastecimento", "no conserto"). */
  origem?: OrigemLeitura;
};

export type OrigemLeitura = "ABASTECIMENTO" | "CONSERTO" | "CONFERIDO";

/** O máximo que um caminhão roda num dia, com folga. Acima disso é digitação. */
export const KM_MAXIMO_POR_DIA = 1_500;
/** Folga mínima entre duas leituras próximas (mesmo dia, dia seguinte). */
export const FOLGA_MINIMA_KM = 3_000;

const DIA_MS = 86_400_000;

function kmPlausivel(de: LeituraOdometro, ate: LeituraOdometro): number {
  const dias = Math.max(0, (ate.data.getTime() - de.data.getTime()) / DIA_MS);
  return Math.max(FOLGA_MINIMA_KM, dias * KM_MAXIMO_POR_DIA);
}

/**
 * Separa as leituras em válidas e descartadas, em ordem de data.
 *
 * Escolhe a MAIOR sequência de leituras coerentes entre si (cada uma maior ou
 * igual à anterior, com um pulo que o caminhão consegue rodar no intervalo).
 * Olhar só pra trás, leitura a leitura, errava quando o erro vinha logo no
 * começo: não dá pra saber quem está errado com duas leituras só — com a
 * sequência inteira dá. Leitura conferida pesa como obrigatória.
 */
export function leiturasValidas(leituras: readonly LeituraOdometro[]): {
  validas: LeituraOdometro[];
  descartadas: LeituraOdometro[];
} {
  const ordenadas = [...leituras].sort(
    (a, b) => a.data.getTime() - b.data.getTime() || a.odometro - b.odometro,
  );
  const n = ordenadas.length;
  const coerente = (a: LeituraOdometro, b: LeituraOdometro) =>
    b.odometro >= a.odometro && b.odometro - a.odometro <= kmPlausivel(a, b);
  // Conferida vale muito mais que qualquer quantidade de anotadas.
  const peso = (x: LeituraOdometro) => (x.confiavel ? 10_000 : 1);

  const melhor: number[] = new Array(n).fill(0);
  const veioDe: number[] = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    melhor[i] = peso(ordenadas[i]!);
    for (let j = 0; j < i; j++) {
      if (!coerente(ordenadas[j]!, ordenadas[i]!)) continue;
      const v = melhor[j]! + peso(ordenadas[i]!);
      // Empate: fica a cadeia que chega mais tarde (j maior) — é a mais recente.
      if (v >= melhor[i]!) {
        melhor[i] = v;
        veioDe[i] = j;
      }
    }
  }
  // O fim da melhor sequência. Empate (duas leituras que não combinam e
  // nada pra desempatar): fica a de odômetro MENOR — o erro comum é o dígito
  // a mais —, e com o mesmo odômetro, a mais recente.
  let fim = -1;
  for (let i = 0; i < n; i++) {
    if (fim < 0) {
      fim = i;
      continue;
    }
    const a = ordenadas[i]!;
    const b = ordenadas[fim]!;
    if (
      melhor[i]! > melhor[fim]! ||
      (melhor[i] === melhor[fim] && (a.odometro < b.odometro || a.odometro === b.odometro))
    ) {
      fim = i;
    }
  }

  const naCadeia = new Set<number>();
  for (let k = fim; k >= 0; k = veioDe[k]!) naCadeia.add(k);
  return {
    validas: ordenadas.filter((_, i) => naCadeia.has(i)),
    descartadas: ordenadas.filter((_, i) => !naCadeia.has(i)),
  };
}

export type KmAtual = {
  /** Km estimado hoje. Nulo quando não há leitura nenhuma. */
  km: number | null;
  /** A leitura de onde a conta parte. */
  desde: Date | null;
  /** Quanto das viagens foi somado depois da leitura. */
  kmViagensDepois: number;
  /** A âncora foi conferida por alguém (e não só anotada no abastecimento). */
  conferido: boolean;
  /** De onde veio a âncora. */
  origem: OrigemLeitura | null;
  descartadas: LeituraOdometro[];
};

/**
 * O km atual: a última leitura válida mais o km das viagens DEPOIS dela.
 * `kmViagensDepois` recebe a data da âncora e devolve a soma — quem chama
 * decide de onde vem (banco, teste).
 */
export function kmAtual(
  leituras: readonly LeituraOdometro[],
  kmViagensDepois: (desde: Date) => number,
): KmAtual {
  const { validas, descartadas } = leiturasValidas(leituras);
  const ancora = validas[validas.length - 1];
  if (!ancora) return { km: null, desde: null, kmViagensDepois: 0, conferido: false, origem: null, descartadas };
  const extra = Math.max(0, Math.round(kmViagensDepois(ancora.data)));
  return {
    km: ancora.odometro + extra,
    desde: ancora.data,
    kmViagensDepois: extra,
    conferido: !!ancora.confiavel,
    origem: ancora.origem ?? (ancora.confiavel ? "CONFERIDO" : null),
    descartadas,
  };
}
