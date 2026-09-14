/**
 * Leitura de número digitado por gente — o único lugar do painel que decide o
 * que "2.400,50", "2400.50" e "12,5,0" querem dizer.
 *
 * Nasceu de dois defeitos reais:
 *
 * 1. `Number(v.replace(",", "."))` devolvia `NaN` pra "12,5,0" e o chamador
 *    tratava `NaN` como "campo vazio" — o valor era descartado em silêncio, a
 *    tela dizia "Viagem atualizada" e o km ficava o antigo. Pior: como o km
 *    "não mudou", a trava do "km do motorista é lei" deixava de exigir motivo.
 *    Por isso a leitura devolve `ok: false` em vez de `null`: vazio e inválido
 *    são coisas diferentes e só uma delas pode passar batido.
 *
 * 2. `Number(v.replace(/\./g,"").replace(",","."))` lia "2400.50" como 240050 —
 *    quem digita no teclado numérico usa ponto, e dar baixa de R$ 2.400,50
 *    lançava R$ 240.050,00. Sem confirmação e sem estorno na tela.
 */

export type NumeroLido =
  | { ok: true; valor: number | null }
  | { ok: false };

/** Só dígitos, separadores e sinal — deixa passar "R$", espaço e NBSP. */
function limpar(bruto: string): string {
  return bruto
    .replace(/\s| /g, "")
    .replace(/^R\$/i, "")
    .trim();
}

/**
 * Interpreta o texto como número em convenção brasileira, tolerando o ponto
 * decimal do teclado numérico.
 *
 * - vazio                 → `{ ok: true, valor: null }`
 * - "12,5" / "12.5"       → 12.5
 * - "2.400,50"            → 2400.5   (ponto = milhar, vírgula = decimal)
 * - "2400.50"             → 2400.5   (ponto decimal: o grupo final não tem 3 dígitos)
 * - "2.400"               → 2400     (grupo final de 3 dígitos = milhar, convenção BR)
 * - "12,5,0" / "abc"      → `{ ok: false }`
 */
export function lerNumero(bruto: string): NumeroLido {
  const t = limpar(bruto);
  if (!t) return { ok: true, valor: null };
  if (!/^[-+]?[\d.,]+$/.test(t)) return { ok: false };

  const negativo = t.startsWith("-");
  const corpo = t.replace(/^[-+]/, "");
  if (!corpo || !/\d/.test(corpo)) return { ok: false };

  const temVirgula = corpo.includes(",");
  const temPonto = corpo.includes(".");

  let inteiro: string;
  let decimal = "";

  if (temVirgula && temPonto) {
    // O último separador que aparece é o decimal; o outro é milhar.
    const ultimo = Math.max(corpo.lastIndexOf(","), corpo.lastIndexOf("."));
    const sepDecimal = corpo.charAt(ultimo);
    const sepMilhar = sepDecimal === "," ? "." : ",";
    const esq = corpo.slice(0, ultimo);
    decimal = corpo.slice(ultimo + 1);
    // Só um decimal, e o lado dos milhares não pode ter o separador decimal.
    if (esq.includes(sepDecimal)) return { ok: false };
    if (!/^\d*$/.test(decimal)) return { ok: false };
    inteiro = esq.split(sepMilhar).join("");
    if (!/^\d+$/.test(inteiro)) return { ok: false };
  } else if (temVirgula) {
    // Vírgula em pt-BR é sempre decimal — duas vírgulas é erro de digitação.
    const partes = corpo.split(",");
    if (partes.length !== 2) return { ok: false };
    inteiro = partes[0] ?? "";
    decimal = partes[1] ?? "";
    if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(decimal)) return { ok: false };
    if (!inteiro && !decimal) return { ok: false };
  } else if (temPonto) {
    const partes = corpo.split(".");
    if (partes.some((p) => !/^\d*$/.test(p))) return { ok: false };
    const ultimo = partes[partes.length - 1] ?? "";
    // "1.234" e "1.234.567": todo grupo depois do primeiro tem 3 dígitos → milhar.
    const pareceMilhar =
      partes.length >= 2 &&
      (partes[0]?.length ?? 0) > 0 &&
      partes.slice(1).every((p) => p.length === 3);
    if (pareceMilhar) {
      inteiro = partes.join("");
      decimal = "";
    } else {
      if (partes.length !== 2) return { ok: false };
      inteiro = partes[0] ?? "";
      decimal = ultimo;
      if (!inteiro && !decimal) return { ok: false };
    }
  } else {
    inteiro = corpo;
  }

  const n = Number(`${inteiro || "0"}.${decimal || "0"}`);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, valor: negativo ? -n : n };
}

/**
 * Atalho pra quem só quer o número e já validou antes (ou aceita perder o
 * inválido). **Não use em campo que o usuário digita** — é justamente essa
 * confusão entre "vazio" e "inválido" que descartava km em silêncio.
 */
export function numeroOuNull(bruto: string): number | null {
  const r = lerNumero(bruto);
  return r.ok ? r.valor : null;
}

/** `true` quando o usuário digitou algo que não dá pra ler como número. */
export function numeroInvalido(bruto: string): boolean {
  return !lerNumero(bruto).ok;
}

/** Eco do valor entendido, pra mostrar embaixo do campo enquanto se digita. */
export function formatarBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
