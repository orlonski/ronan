import { parse } from "csv-parse/sync";
import type { ParsedFile } from "./types";

export function parseCsv(buffer: Buffer, nomeArquivo: string): ParsedFile {
  const text = buffer.toString("utf8");
  // detecta separador: ; é o mais comum em planilhas BR
  const sample = text.slice(0, 2000);
  const semicolons = (sample.match(/;/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  const delimiter = semicolons > commas ? ";" : ",";

  const records = parse(text, {
    delimiter,
    columns: false,
    skip_empty_lines: false,
    relax_quotes: true,
    relax_column_count: true,
  }) as string[][];

  const linhas = records.map((row) =>
    row.map((cell) => {
      if (cell === "" || cell === null || cell === undefined) return null;
      const num = Number(cell.replace(/\./g, "").replace(",", "."));
      if (!Number.isNaN(num) && /^[\d.,\s-]+$/.test(cell)) return num;
      return cell.trim();
    }),
  );

  return {
    formato: "csv",
    nomeArquivo,
    abas: [{ nome: "csv", linhas }],
  };
}
