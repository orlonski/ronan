import ExcelJS from "exceljs";
import type { ParsedSheet } from "../fechamentos/parsers/types";

/**
 * A planilha de funcionários: o modelo que sai e a leitura do que volta.
 *
 * Mesma doutrina do importador de medição: NADA SOME EM SILÊNCIO. A leitura
 * devolve o que dá pra criar e o que não dá, com o motivo linha a linha —
 * importador que descarta a linha ruim entrega uma base incompleta com cara
 * de completa.
 */

export type LinhaFuncionario = {
  linha: number;
  nome: string;
  cpf: string;
  cargo?: string;
  matricula?: string;
  admitidoEm?: string;
  jornada?: string;
};

export type LeituraFuncionarios = {
  validas: LinhaFuncionario[];
  invalidas: { linha: number; descricao: string; motivo: string }[];
};

const CABECALHO = ["Nome", "CPF", "Cargo", "Matrícula", "Admitido em", "Jornada"];

export async function montarModeloFuncionarios(jornadas: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Movatruck";
  const ws = wb.addWorksheet("Funcionários");

  ws.addRow(["Quem bate ponto"]);
  ws.addRow(["Só funcionário REGISTRADO EM CARTEIRA. Parceiro autônomo vai na tela de Motoristas."]);
  ws.addRow([
    jornadas.length > 0
      ? `Na coluna Jornada, escreva exatamente um destes: ${jornadas.join(" | ")}`
      : "Cadastre ao menos uma jornada antes de importar, senão ninguém terá previsto.",
  ]);
  ws.addRow(["A primeira linha de dados é um EXEMPLO — troque pelos seus e apague o que sobrar."]);
  ws.addRow([]);
  const cab = ws.addRow(CABECALHO);
  cab.font = { bold: true };
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(3).font = { italic: true, size: 10 };

  // A linha de exemplo, e NADA depois dela: rodapé de texto solto na coluna do
  // nome vira "linha sem CPF" na volta, e o importador reclama do próprio
  // modelo. O aviso de que é exemplo mora no cabeçalho.
  ws.addRow(["João da Silva", "123.456.789-09", "Motorista", "1042", "01/09/2026", jornadas[0] ?? ""]);

  [28, 18, 20, 14, 16, 26].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 5 }];

  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** "31/12/2026", "2026-12-31" ou a data que o Excel guardou como ISO. */
export function lerData(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
}

export function lerFuncionariosDaPlanilha(abas: ParsedSheet[]): LeituraFuncionarios {
  const validas: LinhaFuncionario[] = [];
  const invalidas: LeituraFuncionarios["invalidas"] = [];
  const cpfsVistos = new Set<string>();

  for (const aba of abas) {
    const iCab = aba.linhas.findIndex((l) => l.some((c) => normalizar(c) === "cpf"));
    if (iCab === -1) continue;
    const cab = aba.linhas[iCab]!.map(normalizar);
    const col = (...nomes: string[]) => {
      for (const n of nomes) {
        const i = cab.indexOf(normalizar(n));
        if (i >= 0) return i;
      }
      return -1;
    };
    const iNome = col("nome", "nome completo", "funcionario");
    const iCpf = col("cpf");
    const iCargo = col("cargo", "funcao");
    const iMat = col("matricula", "matrícula");
    const iAdm = col("admitido em", "admissao", "admissão", "data de admissao");
    const iJor = col("jornada", "escala");

    for (let k = iCab + 1; k < aba.linhas.length; k++) {
      const l = aba.linhas[k]!;
      if (l.every((c) => c === null || String(c).trim() === "")) continue;

      const nome = iNome >= 0 ? String(l[iNome] ?? "").trim() : "";
      const cpf = iCpf >= 0 ? String(l[iCpf] ?? "").replace(/\D/g, "") : "";
      const descricao = [nome, cpf].filter(Boolean).join(" · ") || `linha ${k + 1}`;

      // Rodapé e linha de instrução não são erro nem dado perdido.
      //
      // O critério é "não tem CPF E tem uma célula preenchida só": linha de
      // gente sempre traz mais de uma informação, nem que seja o cargo. Uma
      // linha com só um texto solto é nota de rodapé. Errar pro outro lado —
      // tratar nota como funcionário — encheria a tela de alarme falso e o
      // escritório aprenderia a ignorar a lista, que é o pior resultado.
      const preenchidas = l.filter((c) => c !== null && String(c).trim() !== "").length;
      if (!cpf && preenchidas <= 1) continue;
      if (!nome && !cpf) continue;

      if (nome.length < 3) {
        invalidas.push({ linha: k + 1, descricao, motivo: "Nome incompleto." });
        continue;
      }
      if (cpf.length !== 11) {
        invalidas.push({ linha: k + 1, descricao, motivo: "CPF inválido ou faltando." });
        continue;
      }
      if (cpfsVistos.has(cpf)) {
        invalidas.push({ linha: k + 1, descricao, motivo: "CPF repetido na planilha." });
        continue;
      }
      cpfsVistos.add(cpf);

      validas.push({
        linha: k + 1,
        nome,
        cpf,
        cargo: iCargo >= 0 ? String(l[iCargo] ?? "").trim() || undefined : undefined,
        matricula: iMat >= 0 ? String(l[iMat] ?? "").trim() || undefined : undefined,
        admitidoEm: iAdm >= 0 ? lerData(l[iAdm]) : undefined,
        jornada: iJor >= 0 ? String(l[iJor] ?? "").trim() || undefined : undefined,
      });
    }
  }

  return { validas, invalidas };
}
