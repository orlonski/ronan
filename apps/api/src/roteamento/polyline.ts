/**
 * Encoded Polyline do Google, em duas precisões.
 *
 * Por que isso existe: o OSRM devolve `geometries=polyline` em **precisão 5** e
 * é essa a convenção de TODO o resto do sistema — `Viagem.rotaGeometria`,
 * `RotaCache.geometria`, o mapa do painel, o comprovante público e o seletor do
 * app decodificam sem passar precisão (o default da lib é 5). Já o Valhalla
 * devolve `shape` em **precisão 6** (`lib/navegacao.ts` decodifica com 6
 * explícito, e só ali).
 *
 * Misturar os dois é um bug silencioso e feio: uma linha de precisão 6 lida como
 * 5 cai pra um décimo da escala — o traçado vira um risco minúsculo perto da
 * África, sem erro nenhum no log. Então rota que vem do Valhalla é convertida
 * pra precisão 5 na fronteira do serviço, e daí pra frente o sistema inteiro
 * segue com uma convenção só.
 *
 * Implementado aqui em vez de `@mapbox/polyline` porque a API não tem a lib e o
 * algoritmo é curto — não vale uma dependência (e um lockfile) a mais.
 */

/** Decodifica polyline em pares [lat, lng]. */
export function decodificarPolyline(texto: string, precisao = 5): [number, number][] {
  const fator = Math.pow(10, precisao);
  const pontos: [number, number][] = [];
  let indice = 0;
  let lat = 0;
  let lng = 0;

  while (indice < texto.length) {
    lat += lerValor();
    lng += lerValor();
    pontos.push([lat / fator, lng / fator]);
  }
  return pontos;

  // Cada valor é um zigzag varint em base64 deslocado de 63.
  function lerValor(): number {
    let resultado = 0;
    let deslocamento = 0;
    let byte: number;
    do {
      byte = texto.charCodeAt(indice++) - 63;
      resultado |= (byte & 0x1f) << deslocamento;
      deslocamento += 5;
    } while (byte >= 0x20 && indice < texto.length);
    return resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
  }
}

/** Codifica pares [lat, lng] em polyline. */
export function codificarPolyline(pontos: [number, number][], precisao = 5): string {
  const fator = Math.pow(10, precisao);
  let saida = "";
  let latAnterior = 0;
  let lngAnterior = 0;

  for (const [lat, lng] of pontos) {
    // Arredonda ANTES do delta: acumular o resto do arredondamento faria a linha
    // derivar ponto a ponto ao longo do traçado.
    const latInt = Math.round(lat * fator);
    const lngInt = Math.round(lng * fator);
    saida += escrever(latInt - latAnterior);
    saida += escrever(lngInt - lngAnterior);
    latAnterior = latInt;
    lngAnterior = lngInt;
  }
  return saida;

  function escrever(valor: number): string {
    let v = valor < 0 ? ~(valor << 1) : valor << 1;
    let texto = "";
    while (v >= 0x20) {
      texto += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    texto += String.fromCharCode(v + 63);
    return texto;
  }
}

/** Converte o `shape` do Valhalla (precisão 6) pra convenção do sistema (5). */
export function valhallaShapeParaPolyline5(shape: string): string {
  return codificarPolyline(decodificarPolyline(shape, 6), 5);
}
