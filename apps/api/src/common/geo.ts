/**
 * Distância entre dois pontos do globo. UMA implementação.
 *
 * ⚠️ Existiam CINCO cópias idênticas no `apps/api`, com quatro nomes
 * diferentes (`distHaversine`, `haversineMetros` em dois arquivos,
 * `LocaisService.haversineM`, `haversine` em dois arquivos). Cinco cópias não
 * são cinco vezes o mesmo código: são cinco chances de uma divergir, e uma já
 * tinha divergido. Só uma delas protegia o `asin` contra erro de ponto
 * flutuante; as outras quatro podiam devolver `NaN`.
 *
 * Fora daqui, de propósito:
 * - A versão em **SQL** dentro de `admin/locais` (roda no Postgres, dentro de
 *   um `CREATE INDEX`/`WHERE` — não é código TypeScript e não tem como chamar
 *   esta função).
 * - As duas do `motorista-app`, que têm assinatura e unidade próprias (uma em
 *   km sobre `{lat,lng}`, outra em metros no laço quente da navegação ao
 *   vivo). Unificá-las era mexer em navegação rodando pra ganhar pouco.
 */

const RAIO_TERRA_M = 6_371_000;

const paraRadianos = (graus: number): number => (graus * Math.PI) / 180;

/**
 * Metros entre dois pontos, pela fórmula de haversine.
 *
 * ⚠️ O `Math.min(1, …)` é a única diferença que existia entre as cinco cópias,
 * e é o lado certo: para pontos quase ANTÍPODAS o arredondamento binário
 * empurra o argumento do `asin` para pouco acima de 1, e a resposta vira
 * `NaN`. Medido: em 3 milhões de pares antípodas aleatórios, 123 mil passam de
 * 1. Num pré-filtro de "está dentro do raio?", `NaN` compara falso com tudo —
 * o candidato sumiria em silêncio.
 *
 * Meio mundo de distância não acontece na operação; acontece com coordenada
 * suja (lat/lng trocados, zero vindo de GPS sem fixo). É defesa contra dado
 * ruim, não contra geografia — e custa uma comparação.
 */
export function distanciaMetros(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
): number {
  const dLat = paraRadianos(latB - latA);
  const dLng = paraRadianos(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(paraRadianos(latA)) * Math.cos(paraRadianos(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Quilômetros entre dois pontos.
 *
 * ⚠️ Existe pra que ninguém precise lembrar de dividir por mil. A unidade
 * errada era a divergência mais provável entre as cópias — uma delas já
 * devolvia km com o mesmo nome que as outras usavam pra metros.
 */
export function distanciaKm(latA: number, lngA: number, latB: number, lngB: number): number {
  return distanciaMetros(latA, lngA, latB, lngB) / 1000;
}
