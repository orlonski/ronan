import type { ParsedCell, ParsedSheet } from "../fechamentos/parsers/types";

/**
 * A planilha da medição: o modelo que a gente manda e a leitura do que volta.
 *
 * ⚠️ POR QUE EXISTE UM MODELO, e não só um importador.
 *
 * A primeira versão do mensal deixou o lançamento manual de propósito, com o
 * argumento de que "o formato da planilha varia por contratante e um
 * importador escrito contra um arquivo imaginado quebra no primeiro cliente
 * diferente". O argumento continua verdadeiro — e a saída não é esperar uma
 * planilha real aparecer: é **a gente definir o formato** e mandar o arquivo
 * pronto, já preenchido com os motoristas, as placas e os dias do período.
 * Quem recebe um modelo preenchido devolve o modelo preenchido.
 *
 * ⚠️ O QUE NUNCA PODE ACONTECER AQUI: linha sumir em silêncio.
 *
 * Um importador que descarta a linha que não reconheceu é pior que digitar na
 * mão, porque o número fecha na tela e falta gente na conta — e ninguém
 * procura o que não sabe que existe. Por isso a leitura devolve TRÊS listas:
 * o que casou, o que veio na planilha e não achou dono, e quem está alocado e
 * não apareceu. As três vão pra tela antes de qualquer coisa ser salva.
 *
 * ⚠️ E não corrige nada. A medição é guardada como o contratante mandou — é
 * ela que sustenta o pedido de ajuste. Se eles contaram 20 e a gente acha que
 * são 22, quem resolve é a conversa, não o parser.
 */

/** Uma alocação do período, do nosso lado, pra casar com a linha da planilha. */
export type AlvoMedicao = {
  alocacaoId: string;
  motorista: string;
  cpf?: string | null;
  obra: string;
  placa: string;
};

export type LinhaLida = {
  alocacaoId: string;
  /** Marcados dia a dia (grade). Vence o total quando os dois vierem. */
  dias?: string[];
  totalDias?: number;
  /** Como esta linha achou o dono — vai pra tela, porque nem todo jeito é igual. */
  casouPor: "codigo" | "placa" | "cpf" | "nome";
};

export type LeituraMedicao = {
  linhas: LinhaLida[];
  /** Veio na planilha e não achou dono. Some da conta se ninguém olhar. */
  semDono: { descricao: string; totalDias: number | null }[];
  /** Está alocado no período e não apareceu na planilha. O erro mais caro. */
  semLinha: { alocacaoId: string; motorista: string; obra: string }[];
};

const RÓTULO_CODIGO = "codigo";
const RÓTULO_TOTAL = "total de dias";

/** Sem acento, sem caixa, sem espaço sobrando — cabeçalho de planilha é caos. */
function normalizar(v: ParsedCell): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Só os dígitos: CPF e placa vêm com ponto, traço e espaço conforme o humor. */
function soAlfaNum(v: ParsedCell): string {
  return String(v ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** "21/08" de uma data ISO — é assim que o cabeçalho de dia sai no modelo. */
export function rotuloDia(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Lê a planilha devolvida.
 *
 * `dias` é o período da competência em ISO, na ordem — é ele que dá sentido a
 * uma coluna "21/08". Sem isso o número do dia seria ambíguo: a competência
 * atravessa dois meses quando o corte não é dia 31.
 */
export function lerMedicaoDaPlanilha(
  abas: ParsedSheet[],
  alvos: AlvoMedicao[],
  dias: string[],
): LeituraMedicao {
  const porRotulo = new Map(dias.map((d) => [rotuloDia(d), d]));

  const porCodigo = new Map(alvos.map((a) => [a.alocacaoId, a]));
  const porPlaca = new Map(alvos.map((a) => [soAlfaNum(a.placa), a]));
  const porCpf = new Map(alvos.filter((a) => a.cpf).map((a) => [soAlfaNum(a.cpf!), a]));
  const porNome = new Map(alvos.map((a) => [normalizar(a.motorista), a]));

  const linhas: LinhaLida[] = [];
  const semDono: LeituraMedicao["semDono"] = [];
  const vistos = new Set<string>();

  for (const aba of abas) {
    const iCabecalho = aba.linhas.findIndex((l) =>
      l.some((c) => normalizar(c) === RÓTULO_TOTAL || normalizar(c) === RÓTULO_CODIGO),
    );
    if (iCabecalho === -1) continue;

    const cabecalho = aba.linhas[iCabecalho]!.map(normalizar);
    const col = (rotulo: string) => cabecalho.indexOf(rotulo);
    const iCodigo = col(RÓTULO_CODIGO);
    const iTotal = col(RÓTULO_TOTAL);
    const iPlaca = col("placa");
    const iCpf = col("cpf");
    const iMotorista = col("motorista");

    // Colunas de dia: qualquer cabeçalho que seja um dia DO PERÍODO.
    const colunasDeDia: { indice: number; iso: string }[] = [];
    cabecalho.forEach((c, i) => {
      const iso = porRotulo.get(c);
      if (iso) colunasDeDia.push({ indice: i, iso });
    });

    for (const linha of aba.linhas.slice(iCabecalho + 1)) {
      const vazia = linha.every((c) => c === null || String(c).trim() === "");
      if (vazia) continue;

      let alvo: AlvoMedicao | undefined;
      let casouPor: LinhaLida["casouPor"] = "codigo";
      const codigo = iCodigo >= 0 ? String(linha[iCodigo] ?? "").trim() : "";
      if (codigo && porCodigo.has(codigo)) {
        alvo = porCodigo.get(codigo);
      } else if (iPlaca >= 0 && porPlaca.has(soAlfaNum(linha[iPlaca]))) {
        alvo = porPlaca.get(soAlfaNum(linha[iPlaca]));
        casouPor = "placa";
      } else if (iCpf >= 0 && porCpf.has(soAlfaNum(linha[iCpf]))) {
        alvo = porCpf.get(soAlfaNum(linha[iCpf]));
        casouPor = "cpf";
      } else if (iMotorista >= 0 && porNome.has(normalizar(linha[iMotorista]))) {
        alvo = porNome.get(normalizar(linha[iMotorista]));
        casouPor = "nome";
      }

      const marcados = colunasDeDia
        .filter(({ indice }) => marcado(linha[indice]))
        .map(({ iso }) => iso);
      const total = iTotal >= 0 ? inteiro(linha[iTotal]) : null;

      if (!alvo) {
        // Linha de rodapé ("TOTAL", "Assinatura") não é medição perdida: sem
        // nenhum número ela não tem o que reclamar.
        if (marcados.length === 0 && total === null) continue;
        semDono.push({
          descricao:
            [iMotorista, iPlaca, iCpf]
              .filter((i) => i >= 0)
              .map((i) => String(linha[i] ?? "").trim())
              .filter(Boolean)
              .join(" · ") || "linha sem identificação",
          totalDias: marcados.length > 0 ? marcados.length : total,
        });
        continue;
      }

      // Uma linha por alocação. Planilha com a mesma pessoa duas vezes é erro
      // deles, e somar as duas em silêncio inventaria diária.
      if (vistos.has(alvo.alocacaoId)) continue;
      vistos.add(alvo.alocacaoId);

      // A grade vence o total: ela diz QUAIS dias, e é com o dia na mão que se
      // contesta. Com o total só dá pra dizer que o número não bate.
      if (marcados.length > 0) linhas.push({ alocacaoId: alvo.alocacaoId, dias: marcados, casouPor });
      else if (total !== null) linhas.push({ alocacaoId: alvo.alocacaoId, totalDias: total, casouPor });
    }
  }

  const semLinha = alvos
    .filter((a) => !vistos.has(a.alocacaoId))
    .map((a) => ({ alocacaoId: a.alocacaoId, motorista: a.motorista, obra: a.obra }));

  return { linhas, semDono, semLinha };
}

/** X, x, 1, "sim", qualquer marca. Zero e vazio não são marca. */
function marcado(c: ParsedCell): boolean {
  if (c === null || c === undefined) return false;
  const s = normalizar(c);
  if (s === "" || s === "0" || s === "-" || s === "nao" || s === "n") return false;
  return true;
}

function inteiro(c: ParsedCell): number | null {
  if (c === null || c === undefined || String(c).trim() === "") return null;
  const n = Number(String(c).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 31) return null;
  return Math.round(n);
}
