import { distanciaKm } from "./geo";

/**
 * Previsão de chegada que vai no link público da viagem ("chega por volta das
 * 14h30"). Ideia da Cobli: o cliente para de ligar perguntando do caminhão.
 *
 * ⚠️ A POSIÇÃO NÃO SAI DAQUI. O comprovante público já recusa o rastro do
 * celular ("mandar isso pro cliente é vigiar o motorista" — ver
 * `compartilhamento/viagem-publica.ts`). O que sai é só a hora prevista e o
 * nome do destino. A posição entra na conta e morre no servidor.
 *
 * Só existe previsão quando dá pra ser honesta:
 *   - viagem em andamento, JÁ CARREGADA e ainda não descarregada — antes da
 *     carga, a hora depende da fila na pedreira, que ninguém sabe;
 *   - destino conhecido (quem resolve é o service: obra com um local só, ou a
 *     programação do dia);
 *   - posição recente — com o celular sem sinal há meia hora, a previsão seria
 *     de onde ele estava, não de onde está.
 * Fora disso, `null`, e a página fica como sempre foi.
 */

export type EntradaPrevisao = {
  emAndamento: boolean;
  carregado: boolean;
  descarregado: boolean;
  destino: { nome: string; lat: number; lng: number } | null;
  posicao: { lat: number; lng: number; capturadoEm: Date } | null;
  agora: Date;
};

export type PrevisaoChegada =
  | {
      tipo: "PREVISTA";
      destinoNome: string;
      /** Hora prevista, arredondada a 5 minutos (ISO). */
      chegaEm: string;
      /** Da posição usada pra calcular (ISO) — "atualizado às 13h50". */
      atualizadoEm: string;
    }
  | { tipo: "CHEGANDO"; destinoNome: string; atualizadoEm: string };

/** Posição mais velha que isso não serve pra prever. */
export const POSICAO_MAX_MIN = 20;
/** Dentro deste raio do destino, é "chegando" — rota de 300 m vira previsão boba. */
const CHEGANDO_KM = 0.5;
/**
 * O OSRM calcula com perfil de carro. Caminhão carregado sobe serra a 30 km/h:
 * 25% a mais é a margem pra a previsão errar pro lado de chegar ANTES, que é o
 * erro que o cliente perdoa.
 */
export const FATOR_CAMINHAO = 1.25;
const CINCO_MIN_MS = 5 * 60_000;

/** Pode valer a pena chamar o roteador? Evita ida ao OSRM quando nada vai sair. */
export function precisaCalcularRota(e: EntradaPrevisao): boolean {
  if (!e.emAndamento || !e.carregado || e.descarregado || !e.destino || !e.posicao) return false;
  if (e.agora.getTime() - e.posicao.capturadoEm.getTime() > POSICAO_MAX_MIN * 60_000) return false;
  return distanciaKm(e.posicao.lat, e.posicao.lng, e.destino.lat, e.destino.lng) > CHEGANDO_KM;
}

export function previsaoChegada(
  e: EntradaPrevisao,
  /** Duração da rota posição→destino pelo roteador. Null = não deu pra calcular. */
  duracaoRotaSeg: number | null,
): PrevisaoChegada | null {
  if (!e.emAndamento || !e.carregado || e.descarregado || !e.destino || !e.posicao) return null;
  const idadeMs = e.agora.getTime() - e.posicao.capturadoEm.getTime();
  if (idadeMs > POSICAO_MAX_MIN * 60_000) return null;

  const atualizadoEm = e.posicao.capturadoEm.toISOString();
  if (distanciaKm(e.posicao.lat, e.posicao.lng, e.destino.lat, e.destino.lng) <= CHEGANDO_KM) {
    return { tipo: "CHEGANDO", destinoNome: e.destino.nome, atualizadoEm };
  }
  if (duracaoRotaSeg == null || duracaoRotaSeg <= 0) return null;

  // Conta a partir de QUANDO a posição foi capturada, não de agora: se ela tem
  // 10 min, o caminhão já andou 10 min desde então.
  const bruto = e.posicao.capturadoEm.getTime() + duracaoRotaSeg * FATOR_CAMINHAO * 1000;
  // Nunca no passado (posição velha + trecho curto): no mínimo daqui a 5 min.
  const alvo = Math.max(bruto, e.agora.getTime() + CINCO_MIN_MS);
  const arredondado = Math.ceil(alvo / CINCO_MIN_MS) * CINCO_MIN_MS;
  return {
    tipo: "PREVISTA",
    destinoNome: e.destino.nome,
    chegaEm: new Date(arredondado).toISOString(),
    atualizadoEm,
  };
}
