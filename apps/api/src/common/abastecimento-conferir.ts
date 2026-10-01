import { calcularConsumo, type TrechoConsumo } from "./consumo";
import { distanciaKm } from "./geo";

/**
 * Abastecimento que pede conferência — sem câmera nem rastreador, só com o que
 * o app já grava. A ideia veio da Cobli, que faz isso com câmera no posto.
 *
 * Três sinais, cada um com um jeito diferente de dar errado:
 *
 *   TANQUE   — mais litros do que cabe no tanque. Só existe quando a empresa
 *              cadastrou a capacidade do caminhão.
 *   CONSUMO  — entrou muito mais diesel do que o caminhão rodou desde o último
 *              tanque cheio. É o desvio pro galão, ou o carro particular
 *              abastecido na conta do caminhão.
 *   LONGE    — lançado na hora, mas longe do trajeto que o caminhão fez naquele
 *              dia (carga → descarga). O caminhão não estava lá.
 *   META     — o trecho fez bem menos km/l do que a meta do caminhão.
 *   PRECO    — litro bem mais caro que o normal da frota no mês.
 *   INTERVALO — abasteceu de novo poucas horas depois, quase sem rodar.
 *
 * ⚠️ SINAL NÃO É ACUSAÇÃO. Motorista é parceiro; o texto diz o que o número
 * mostra ("entraram 480 L pra 300 km") e quem confere decide. Tanque que não
 * estava cheio de verdade, odômetro digitado errado e posto fora da rota por
 * desvio de obra explicam boa parte. Nada aqui recusa ou trava lançamento.
 *
 * ⚠️ Não compara com o GPS do celular do motorista na mesma hora: quem lança e
 * quem "é" o caminhão no rastreamento é o mesmo aparelho — a comparação daria
 * sempre zero. A referência de onde o caminhão estava é o trajeto das viagens.
 */

export type TipoSinalAbastecimento = "TANQUE" | "CONSUMO" | "LONGE" | "META" | "PRECO" | "INTERVALO";

export type SinalAbastecimento = {
  tipo: TipoSinalAbastecimento;
  /** Frase pronta pra tela, com os números. */
  texto: string;
};

export type AbastecimentoParaConferir = {
  id: string;
  data: Date;
  tipo: string;
  litros: number;
  /** Valor pago. Null no comboio. */
  valorTotal?: number | null;
  odometro: number | null;
  tanqueCheio: boolean;
  emComboio: boolean;
  lat: number | null;
  lng: number | null;
  precisao: number | null;
  /** Quando o motorista apertou "salvar" no app. Null = lançado pelo painel. */
  criadoOfflineEm: Date | null;
};

export type TrajetoDoDia = {
  cargaLat: number;
  cargaLng: number;
  descargaLat: number;
  descargaLng: number;
};

/** Folga sobre a capacidade: bomba e marcador não são instrumentos de precisão. */
const FOLGA_TANQUE = 1.05;
/** Entrou 50% a mais do que o consumo do caminhão explica... */
const FATOR_CONSUMO = 1.5;
/** ...e pelo menos 50 L a mais — diferença de 20 L num trecho curto é ruído. */
const EXCESSO_MINIMO_LITROS = 50;
/** Quantos trechos o caminhão precisa ter pra servir de régua dele mesmo. */
const TRECHOS_MINIMOS_PROPRIOS = 2;
/** Distância do trajeto do dia a partir da qual vale olhar. Posto de estrada fica perto da rota. */
const LONGE_KM = 30;
/** GPS pior que isso não serve pra dizer onde foi. */
const PRECISAO_MAXIMA_M = 500;
/**
 * O app grava `data` como o dia escolhido + a hora em que se apertou salvar.
 * Se o lançamento foi feito nas mesmas ~3 h, o GPS é do momento do abastecimento;
 * lançado no dia seguinte, o GPS é de onde ele estava DEPOIS, e não prova nada.
 */
const JANELA_LANCAMENTO_MS = 3 * 3600_000;

/** Abaixo de 85% da meta é sinal; entre 85% e 100% é variação de rota e carga. */
const FATOR_META = 0.85;
/** Litro 15% mais caro que a mediana da frota no tipo. */
const FATOR_PRECO = 1.15;
/** Dois abastecimentos em menos de 6h... */
const INTERVALO_HORAS = 6;
/** ...com menos de 50 km rodados entre eles. */
const INTERVALO_KM = 50;

const ehArla = (tipo: string) => tipo === "ARLA_32";

/** Km/l ponderado pelo km de um conjunto de trechos. */
export function kmPorLitroDosTrechos(trechos: TrechoConsumo[]): number | null {
  const km = trechos.reduce((s, t) => s + t.km, 0);
  const litros = trechos.reduce((s, t) => s + t.litros, 0);
  return litros > 0 && km > 0 ? km / litros : null;
}

/**
 * Distância (km) de um ponto ao segmento A→B. Projeção plana local: em
 * distâncias de trajeto de caminhão (dezenas a centenas de km) o erro é
 * desprezível perto do limite de 30 km.
 */
export function distanciaAoSegmentoKm(
  lat: number,
  lng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  const ax = (aLng - lng) * kx;
  const ay = (aLat - lat) * ky;
  const bx = (bLng - lng) * kx;
  const by = (bLat - lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const px = ax + t * dx;
  const py = ay + t * dy;
  // Segmento degenerado (carga = descarga): cai na distância até o ponto.
  if (len2 === 0) return distanciaKm(lat, lng, aLat, aLng);
  return Math.sqrt(px * px + py * py);
}

const fmt = (n: number, casas = 0) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/**
 * Os sinais de UM abastecimento.
 *
 * `historico` é a lista de abastecimentos do MESMO caminhão (inclui o alvo),
 * numa janela que cubra pelo menos o tanque cheio anterior. `kmPorLitroFrota`
 * é a régua quando o caminhão ainda não tem trechos suficientes pra ser a dele.
 */
export function sinaisDoAbastecimento(args: {
  alvo: AbastecimentoParaConferir;
  historico: AbastecimentoParaConferir[];
  capacidadeTanqueLitros: number | null;
  kmPorLitroFrota: number | null;
  trajetosDoDia: TrajetoDoDia[];
  /** Meta de km/l do caminhão. Null = sem meta, sem sinal. */
  metaKmL?: number | null;
  /** Preço/litro "normal" da frota (mediana do tipo nos últimos 30 dias). */
  precoReferencia?: number | null;
}): SinalAbastecimento[] {
  const { alvo } = args;
  const sinais: SinalAbastecimento[] = [];

  // ---- TANQUE --------------------------------------------------------------
  // ARLA tem tanque próprio, pequeno; comparar com o do diesel não diz nada.
  const cap = args.capacidadeTanqueLitros;
  if (cap != null && cap > 0 && !ehArla(alvo.tipo) && alvo.litros > cap * FOLGA_TANQUE) {
    sinais.push({
      tipo: "TANQUE",
      texto: `${fmt(alvo.litros)} L num tanque de ${fmt(cap)} L.`,
    });
  }

  // ---- CONSUMO -------------------------------------------------------------
  // O trecho tanque-a-tanque que TERMINA neste abastecimento já vem pronto do
  // consumo (com os parciais no meio e o odômetro absurdo descartado). A régua
  // são os OUTROS trechos do caminhão — com o próprio trecho suspeito dentro,
  // ele puxaria a média pra si e nunca acusaria nada.
  if (!ehArla(alvo.tipo) && alvo.tanqueCheio) {
    const consumo = calcularConsumo(
      args.historico
        .filter((a) => !ehArla(a.tipo))
        .map((a) => ({
          id: a.id,
          data: a.data,
          odometro: a.odometro,
          litros: a.litros,
          tanqueCheio: a.tanqueCheio,
          emComboio: a.emComboio,
        })),
    );
    const trecho = consumo.trechos.find((t) => t.ateId === alvo.id);
    // META: o trecho que termina aqui ficou bem abaixo do que o dono espera.
    const meta = args.metaKmL;
    if (trecho && meta != null && meta > 0 && trecho.kmPorLitro < meta * FATOR_META) {
      sinais.push({
        tipo: "META",
        texto: `Fez ${fmt(trecho.kmPorLitro, 2)} km/l nesse trecho; a meta do caminhão é ${fmt(meta, 2)}.`,
      });
    }
    if (trecho) {
      const outros = consumo.trechos.filter((t) => t !== trecho);
      const regua =
        outros.length >= TRECHOS_MINIMOS_PROPRIOS ? kmPorLitroDosTrechos(outros) : args.kmPorLitroFrota;
      if (regua != null && regua > 0) {
        const esperado = trecho.km / regua;
        if (trecho.litros > esperado * FATOR_CONSUMO && trecho.litros - esperado >= EXCESSO_MINIMO_LITROS) {
          sinais.push({
            tipo: "CONSUMO",
            texto:
              `Entraram ${fmt(trecho.litros)} L pra ${fmt(trecho.km)} km rodados desde o último tanque cheio. ` +
              `No consumo de ${fmt(regua, 1)} km/l${outros.length >= TRECHOS_MINIMOS_PROPRIOS ? " deste caminhão" : " da frota"}, ` +
              `seriam uns ${fmt(esperado)} L.`,
          });
        }
      }
    }
  }

  // ---- PRECO ---------------------------------------------------------------
  const ref = args.precoReferencia;
  if (ref != null && ref > 0 && alvo.valorTotal != null && alvo.valorTotal > 0 && alvo.litros > 0) {
    const preco = alvo.valorTotal / alvo.litros;
    if (preco > ref * FATOR_PRECO) {
      sinais.push({
        tipo: "PRECO",
        texto: `Litro a R$ ${fmt(preco, 2)}, ${fmt(((preco / ref) - 1) * 100)}% acima do normal da frota (R$ ${fmt(ref, 2)}).`,
      });
    }
  }

  // ---- INTERVALO -----------------------------------------------------------
  // O abastecimento anterior do mesmo caminhão (mesmo combustível, ARLA fora).
  if (!ehArla(alvo.tipo)) {
    const anterior = args.historico
      .filter((a) => a.id !== alvo.id && !ehArla(a.tipo) && a.data.getTime() < alvo.data.getTime())
      .sort((a, b) => b.data.getTime() - a.data.getTime())[0];
    if (anterior) {
      const horas = (alvo.data.getTime() - anterior.data.getTime()) / 3600_000;
      const km = alvo.odometro != null && anterior.odometro != null ? alvo.odometro - anterior.odometro : null;
      if (horas < INTERVALO_HORAS && km != null && km >= 0 && km < INTERVALO_KM) {
        sinais.push({
          tipo: "INTERVALO",
          texto: `Abasteceu de novo ${fmt(Math.max(1, horas))}h depois do anterior, com ${fmt(km)} km rodados.`,
        });
      }
    }
  }

  // ---- LONGE ---------------------------------------------------------------
  const gpsBom =
    alvo.lat != null &&
    alvo.lng != null &&
    (alvo.precisao == null || alvo.precisao <= PRECISAO_MAXIMA_M);
  const lancadoNaHora =
    alvo.criadoOfflineEm != null &&
    Math.abs(alvo.criadoOfflineEm.getTime() - alvo.data.getTime()) <= JANELA_LANCAMENTO_MS;
  if (gpsBom && lancadoNaHora && args.trajetosDoDia.length > 0) {
    const menor = Math.min(
      ...args.trajetosDoDia.map((t) =>
        distanciaAoSegmentoKm(alvo.lat!, alvo.lng!, t.cargaLat, t.cargaLng, t.descargaLat, t.descargaLng),
      ),
    );
    if (menor > LONGE_KM) {
      sinais.push({
        tipo: "LONGE",
        texto: `Lançado a ${fmt(menor)} km do trajeto que o caminhão fez nesse dia.`,
      });
    }
  }

  return sinais;
}
