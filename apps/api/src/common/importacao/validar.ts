import { cpfDigits, documentoDigits, isCnpjValid, isCpfValid } from "@ronan/shared-types";
import type { CampoImportavel, EntidadeImportavel } from "./campos";
import { normalizar, type Celula, type Mapa } from "./mapear";

/**
 * Cada linha vira um registro — ou um erro que diz onde arrumar.
 *
 * A regra que organiza tudo aqui: **a importação nunca inventa dado**. Célula
 * vazia vira ausente, não zero nem string vazia; documento inválido vira erro
 * na linha, não um cadastro com CNPJ errado que ninguém mais consegue casar.
 *
 * E nunca é tudo ou nada. Planilha de 400 linhas com 3 problemas importa 397 e
 * mostra as 3 pra corrigir; recusar o arquivo inteiro por causa de um CPF
 * digitado errado é o que faz a implantação voltar pro e-mail.
 */

export type LinhaValidada = {
  /** Linha no arquivo, começando em 1 — é o que o usuário vê na planilha. */
  numero: number;
  valores: Record<string, string | number>;
  /** A chave natural já normalizada. Vazia quando a linha não pode ser casada. */
  chave: string;
  erros: { campo: string; mensagem: string }[];
  /** Duas linhas do MESMO arquivo com a mesma chave: a segunda é ignorada. */
  duplicadaNoArquivo?: boolean;
};

const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "),
);

export function validarLinhas(
  linhas: Celula[][],
  entidade: EntidadeImportavel,
  mapa: Mapa,
): LinhaValidada[] {
  const saida: LinhaValidada[] = [];
  const vistas = new Set<string>();

  linhas.forEach((linha, i) => {
    // Linha totalmente vazia é o rodapé da planilha, não um registro em branco.
    if (linha.every((c) => c === null || String(c).trim() === "")) return;

    const valores: Record<string, string | number> = {};
    const erros: LinhaValidada["erros"] = [];

    for (const campo of entidade.campos) {
      const indice = mapa[campo.chave];
      const bruto = indice === undefined ? null : (linha[indice] ?? null);
      const r = converter(bruto, campo);
      if (r.erro) erros.push({ campo: campo.chave, mensagem: r.erro });
      else if (r.valor !== null) valores[campo.chave] = r.valor;
      else if (campo.obrigatorio) {
        erros.push({ campo: campo.chave, mensagem: `${campo.rotulo} está em branco.` });
      }
    }

    const chaveBruta = valores[entidade.chaveNatural];
    const chave = chaveBruta === undefined ? "" : normalizar(String(chaveBruta));

    const item: LinhaValidada = { numero: i + 1, valores, chave, erros };
    if (chave !== "" && erros.length === 0) {
      // A PRIMEIRA ocorrência vale. A planilha costuma vir ordenada por data, e
      // a de cima é a linha mais recente que o escritório digitou.
      if (vistas.has(chave)) item.duplicadaNoArquivo = true;
      else vistas.add(chave);
    }
    saida.push(item);
  });

  return saida;
}

function converter(
  bruto: Celula,
  campo: CampoImportavel,
): { valor: string | number | null; erro?: string } {
  if (bruto === null) return { valor: null };
  const texto = String(bruto).trim();
  if (texto === "") return { valor: null };

  switch (campo.tipo) {
    case "numero":
    case "inteiro": {
      // "1.234,56" é o formato das planilhas BR: com vírgula presente, o ponto
      // é milhar. Sem vírgula, o ponto fica sendo decimal — é o que preserva
      // uma latitude como "-25.093", que veio de exportação de sistema.
      //
      // A exceção é o campo INTEIRO: ali "2.019" só pode ser 2019, e ler como
      // 2,019 gravaria um ano que não existe.
      let limpo = texto.includes(",")
        ? texto.replace(/\./g, "").replace(",", ".")
        : texto.replace(/\s/g, "");
      if (campo.tipo === "inteiro") limpo = limpo.replace(/\./g, "");
      const n = Number(limpo);
      if (!Number.isFinite(n)) {
        return { valor: null, erro: `${campo.rotulo}: "${texto}" não é um número.` };
      }
      return { valor: campo.tipo === "inteiro" ? Math.round(n) : n };
    }

    case "cpf": {
      const d = cpfDigits(texto);
      if (!isCpfValid(d)) {
        return { valor: null, erro: `CPF inválido: ${texto}` };
      }
      return { valor: d };
    }

    case "cnpjOuCpf": {
      const d = documentoDigits(texto);
      if (d.length === 14 && isCnpjValid(d)) return { valor: d };
      if (d.length === 11 && isCpfValid(d)) return { valor: d };
      // Sem erro duro: documento é opcional no cliente, e recusar a linha
      // inteira por causa dele perderia o nome, que é o que importa.
      return {
        valor: null,
        erro: `${campo.rotulo}: "${texto}" não é um CNPJ nem um CPF válido.`,
      };
    }

    case "placa": {
      const p = texto.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!/^[A-Z]{3}\d[A-Z\d]\d{2}$/.test(p)) {
        return { valor: null, erro: `Placa inválida: ${texto}` };
      }
      return { valor: p };
    }

    case "uf": {
      const uf = texto.toUpperCase().trim();
      if (!UFS.has(uf)) return { valor: null, erro: `UF inválida: ${texto}` };
      return { valor: uf };
    }

    case "data": {
      const d = lerData(texto);
      return d ? { valor: d } : { valor: null, erro: `Data inválida: ${texto}` };
    }

    default:
      return { valor: texto };
  }
}

/**
 * Data como brasileiro escreve.
 *
 * dd/mm/aaaa primeiro, porque `new Date("03/04/2026")` em JS entende MARÇO —
 * e uma planilha de viagens lida assim erra o mês em dois terços das linhas
 * sem nunca falhar.
 */
export function lerData(texto: string): string | null {
  const br = texto.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (br) {
    const [, d, m, a] = br;
    const ano = a!.length === 2 ? `20${a}` : a!;
    const iso = `${ano}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    return valida(iso) ? iso : null;
  }
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso && valida(iso[0]!)) return iso[0]!;
  return null;
}

function valida(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === iso;
}

/** O resumo que a tela mostra antes de aplicar. */
export function resumirValidacao(linhas: LinhaValidada[]) {
  const comErro = linhas.filter((l) => l.erros.length > 0);
  const duplicadas = linhas.filter((l) => l.duplicadaNoArquivo);
  return {
    total: linhas.length,
    prontas: linhas.length - comErro.length - duplicadas.length,
    comErro: comErro.length,
    duplicadasNoArquivo: duplicadas.length,
  };
}
