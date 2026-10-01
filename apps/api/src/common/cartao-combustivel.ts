import { createHash } from "node:crypto";
import type { EntidadeImportavel } from "./importacao/campos";
import { acharCabecalho, casarColunas, normalizar, type Celula, type Mapa } from "./importacao/mapear";
import { lerData } from "./importacao/validar";

/**
 * Cartão combustível: ler o extrato da operadora e cruzar com o que os
 * motoristas lançaram. Ideia da Cobli (que cruza com a telemetria do tanque).
 *
 * Não depende de operadora: Ticket Log, Repom, Valecard, Goodcard… todas
 * exportam planilha, e as colunas são achadas pelos nomes que elas costumam
 * usar — o mesmo mecanismo da importação de cadastros (common/importacao).
 *
 * O cruzamento é pelo DIA, não pela hora: a hora que o app grava é a hora em
 * que o motorista apertou salvar, não a da bomba.
 */

// ---------------------------------------------------------------- leitura --

/**
 * As colunas do extrato. `chave`/`rotulo`/`sinonimos` são o formato que
 * `acharCabecalho` e `casarColunas` entendem — reaproveitados de propósito.
 */
const CAMPOS = [
  { chave: "data", rotulo: "Data", tipo: "data", obrigatorio: true, sinonimos: ["data", "data transacao", "data da transacao", "dt transacao", "data hora", "data/hora", "data abastecimento", "data emissao"] },
  { chave: "hora", rotulo: "Hora", tipo: "texto", obrigatorio: false, sinonimos: ["hora", "hora transacao", "horario"] },
  { chave: "placa", rotulo: "Placa", tipo: "texto", obrigatorio: true, sinonimos: ["placa", "placa veiculo", "veiculo", "placa do veiculo"] },
  { chave: "motorista", rotulo: "Motorista", tipo: "texto", obrigatorio: false, sinonimos: ["motorista", "condutor", "nome motorista", "nome do motorista", "portador"] },
  { chave: "posto", rotulo: "Posto", tipo: "texto", obrigatorio: false, sinonimos: ["estabelecimento", "posto", "nome estabelecimento", "razao social", "nome fantasia", "credenciado"] },
  { chave: "combustivel", rotulo: "Combustível", tipo: "texto", obrigatorio: false, sinonimos: ["produto", "combustivel", "servico", "mercadoria", "tipo combustivel", "descricao produto"] },
  { chave: "litros", rotulo: "Litros", tipo: "numero", obrigatorio: false, sinonimos: ["litros", "quantidade", "qtd", "qtde", "volume", "quantidade litros", "qtd litros"] },
  { chave: "valor", rotulo: "Valor", tipo: "numero", obrigatorio: true, sinonimos: ["valor", "valor total", "valor transacao", "vl total", "valor emissao", "total", "valor r"] },
  { chave: "odometro", rotulo: "Hodômetro", tipo: "inteiro", obrigatorio: false, sinonimos: ["hodometro", "odometro", "km", "quilometragem", "km veiculo"] },
] as const;

/** Só os campos importam pro casador; o resto do tipo é da importação de cadastros. */
const ENTIDADE = { campos: CAMPOS } as unknown as EntidadeImportavel;

export const CAMPOS_EXTRATO = CAMPOS.map((c) => ({ chave: c.chave, rotulo: c.rotulo, obrigatorio: c.obrigatorio }));

export type TransacaoLida = {
  linha: number;
  chave: string;
  data: Date;
  placa: string;
  motorista: string | null;
  posto: string | null;
  combustivel: string | null;
  litros: number | null;
  valor: number;
  odometro: number | null;
};

export type ResultadoLeitura = {
  linhaCabecalho: number;
  mapa: Mapa;
  faltando: string[];
  transacoes: TransacaoLida[];
  erros: { linha: number; mensagem: string }[];
  /** Linhas que não são passada no cartão (estorno, taxa, total) — ignoradas sem erro. */
  ignoradas: number;
};

/** "R$ 1.234,56", "1234,56", "1234.56", 1234.56 → número. */
export function numeroBR(c: Celula): number | null {
  if (c == null) return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  let t = c.replace(/r\$/i, "").replace(/\s/g, "");
  if (!t) return null;
  const negativo = /^-|\(.*\)$/.test(t);
  t = t.replace(/[()-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

export const normalizarPlacaCartao = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Data (e hora, se vier) como instante. A hora do extrato é a de Brasília;
 * sem hora, meio-dia — o cruzamento é por dia, e meio-dia não vira o dia em
 * nenhum fuso do Brasil.
 */
function lerInstante(dataCel: Celula, horaCel: Celula): Date | null {
  if (dataCel == null) return null;
  const bruto = String(dataCel).trim();
  // "01/09/2026 14:32" numa coluna só.
  const [parteData, parteHoraJunta] = bruto.split(/[ T]+/);
  const dia = lerData(parteData ?? "");
  if (!dia) return null;
  const horaTxt = (horaCel != null ? String(horaCel) : parteHoraJunta ?? "").trim();
  const hm = /^(\d{1,2}):(\d{2})/.exec(horaTxt);
  const [h, m] = hm ? [Number(hm[1]), Number(hm[2])] : [12, 0];
  const [a, mes, d] = dia.split("-").map(Number) as [number, number, number];
  // Brasília = UTC-3 (sem horário de verão desde 2019).
  return new Date(Date.UTC(a, mes - 1, d, h + 3, m));
}

/**
 * Impressão digital da passada: o mesmo extrato subido duas vezes (ou dois
 * extratos que se sobrepõem) não duplica nada.
 */
export function chaveTransacao(t: Pick<TransacaoLida, "data" | "placa" | "litros" | "valor" | "posto">): string {
  const base = [
    t.data.toISOString(),
    normalizarPlacaCartao(t.placa),
    t.litros?.toFixed(3) ?? "",
    t.valor.toFixed(2),
    normalizar(t.posto ?? ""),
  ].join("|");
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}

export function lerExtrato(linhas: Celula[][], mapaInformado?: Mapa): ResultadoLeitura {
  const linhaCabecalho = acharCabecalho(linhas, ENTIDADE);
  const cabecalho = linhaCabecalho >= 0 ? (linhas[linhaCabecalho] ?? []) : [];
  const mapa = mapaInformado ?? (linhaCabecalho >= 0 ? casarColunas(cabecalho, ENTIDADE) : {});
  const faltando = CAMPOS.filter((c) => c.obrigatorio && mapa[c.chave] === undefined).map((c) => c.chave);

  const transacoes: TransacaoLida[] = [];
  const erros: ResultadoLeitura["erros"] = [];
  let ignoradas = 0;
  if (faltando.length > 0) return { linhaCabecalho, mapa, faltando, transacoes, erros, ignoradas };

  const cel = (linha: Celula[], chave: string): Celula => {
    const i = mapa[chave];
    return i === undefined ? null : (linha[i] ?? null);
  };
  const texto = (linha: Celula[], chave: string): string | null => {
    const v = cel(linha, chave);
    const s = v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  };

  linhas.forEach((linha, i) => {
    if (i <= linhaCabecalho) return;
    if (linha.every((c) => c == null || String(c).trim() === "")) return;
    const numero = i + 1;

    const valor = numeroBR(cel(linha, "valor"));
    const placa = texto(linha, "placa");
    const dataBruta = cel(linha, "data");
    const data = lerInstante(dataBruta, cel(linha, "hora"));
    // Rodapé de total ("TOTAL GERAL": sem placa e sem data de verdade) e
    // estorno (valor negativo) não são passada no cartão: saem quietos, não
    // como erro.
    if ((placa == null && data == null) || (valor != null && valor <= 0)) {
      ignoradas++;
      return;
    }
    if (!data) return void erros.push({ linha: numero, mensagem: `Data que não deu pra ler: "${String(dataBruta ?? "")}".` });
    if (!placa) return void erros.push({ linha: numero, mensagem: "Linha sem placa." });
    if (valor == null) return void erros.push({ linha: numero, mensagem: `Valor que não deu pra ler: "${String(cel(linha, "valor") ?? "")}".` });

    const litros = numeroBR(cel(linha, "litros"));
    const odo = numeroBR(cel(linha, "odometro"));
    const t = {
      linha: numero,
      data,
      placa,
      motorista: texto(linha, "motorista"),
      posto: texto(linha, "posto"),
      combustivel: texto(linha, "combustivel"),
      litros: litros != null && litros > 0 ? Math.round(litros * 1000) / 1000 : null,
      valor: Math.round(valor * 100) / 100,
      odometro: odo != null && odo > 0 ? Math.round(odo) : null,
    };
    transacoes.push({ ...t, chave: chaveTransacao(t) });
  });

  return { linhaCabecalho, mapa, faltando, transacoes, erros, ignoradas };
}

// ------------------------------------------------------------ conciliação --

export type TransacaoParaConciliar = {
  id: string;
  data: Date;
  placa: string | null;
  veiculoId: string | null;
  litros: number | null;
  valor: number;
};

export type AbastecimentoParaConciliar = {
  id: string;
  veiculoId: string;
  data: Date;
  litros: number;
  valorTotal: number | null;
  emComboio: boolean;
};

export type SituacaoConciliacao = "CONFERE" | "DIVERGE" | "SO_NO_CARTAO" | "PLACA_DESCONHECIDA";

export type ItemConciliado = {
  transacaoId: string;
  situacao: SituacaoConciliacao;
  abastecimentoId: string | null;
  /** Frase pronta pra tela. Vazia quando confere. */
  texto: string;
};

/** Até 2 L ou 2% de diferença é bomba, arredondamento e cupom — não é divergência. */
const TOLERANCIA_LITROS = (l: number) => Math.max(2, l * 0.02);
const TOLERANCIA_VALOR = (v: number) => Math.max(2, v * 0.02);
const DIA_MS = 86_400_000;

const diaSP = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
const distDias = (a: Date, b: Date) =>
  Math.abs(Date.parse(diaSP(a)) - Date.parse(diaSP(b))) / DIA_MS;

const fmt = (n: number, casas: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/**
 * Casa cada passada no cartão com UM abastecimento lançado, e vice-versa.
 *
 * Candidatos: mesmo caminhão, no mesmo dia ou no dia vizinho (o motorista que
 * lança à meia-noite, o extrato que fecha às 23h59). Entre os candidatos, o
 * par mais parecido (dia, depois litros, depois valor) casa primeiro — guloso
 * por proximidade, que é o que uma pessoa faria na mão com o extrato do lado.
 *
 * Comboio não entra: é diesel do caminhão-tanque da empresa, não passa cartão.
 */
export function conciliarCartao(
  transacoes: TransacaoParaConciliar[],
  abastecimentos: AbastecimentoParaConciliar[],
): { itens: ItemConciliado[]; lancadosSemCartao: string[] } {
  const elegiveis = abastecimentos.filter((a) => !a.emComboio);
  const pares: { t: TransacaoParaConciliar; a: AbastecimentoParaConciliar; custo: number }[] = [];
  for (const t of transacoes) {
    if (!t.veiculoId) continue;
    for (const a of elegiveis) {
      if (a.veiculoId !== t.veiculoId) continue;
      const dias = distDias(t.data, a.data);
      if (dias > 1) continue;
      const dl = t.litros != null ? Math.abs(t.litros - a.litros) / Math.max(1, t.litros) : 0.5;
      const dv = a.valorTotal != null ? Math.abs(t.valor - a.valorTotal) / Math.max(1, t.valor) : 0.5;
      pares.push({ t, a, custo: dias * 10 + dl * 3 + dv });
    }
  }
  pares.sort((x, y) => x.custo - y.custo);

  const casadoT = new Map<string, AbastecimentoParaConciliar>();
  const usadoA = new Set<string>();
  for (const p of pares) {
    if (casadoT.has(p.t.id) || usadoA.has(p.a.id)) continue;
    casadoT.set(p.t.id, p.a);
    usadoA.add(p.a.id);
  }

  const itens: ItemConciliado[] = transacoes.map((t) => {
    if (!t.veiculoId) {
      return {
        transacaoId: t.id,
        situacao: "PLACA_DESCONHECIDA",
        abastecimentoId: null,
        texto: `A placa ${t.placa ?? "(vazia)"} não está no cadastro de caminhões.`,
      };
    }
    const a = casadoT.get(t.id);
    if (!a) {
      return {
        transacaoId: t.id,
        situacao: "SO_NO_CARTAO",
        abastecimentoId: null,
        texto: "Passou no cartão e nenhum abastecimento desse caminhão foi lançado nesse dia.",
      };
    }
    const problemas: string[] = [];
    if (t.litros != null && Math.abs(t.litros - a.litros) > TOLERANCIA_LITROS(t.litros)) {
      problemas.push(`no cartão ${fmt(t.litros, 1)} L, lançado ${fmt(a.litros, 1)} L`);
    }
    if (a.valorTotal != null && Math.abs(t.valor - a.valorTotal) > TOLERANCIA_VALOR(t.valor)) {
      problemas.push(`no cartão R$ ${fmt(t.valor, 2)}, lançado R$ ${fmt(a.valorTotal, 2)}`);
    }
    return {
      transacaoId: t.id,
      situacao: problemas.length ? "DIVERGE" : "CONFERE",
      abastecimentoId: a.id,
      texto: problemas.length ? `Diferente do lançado: ${problemas.join("; ")}.` : "",
    };
  });

  return {
    itens,
    lancadosSemCartao: elegiveis.filter((a) => !usadoA.has(a.id)).map((a) => a.id),
  };
}
