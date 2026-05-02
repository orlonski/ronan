import { parseCsv } from "./csv-parser";
import { parsePdf } from "./pdf-parser";
import { parseXlsx } from "./xlsx-parser";
import type { ParsedFile } from "./types";

export type { ParsedFile, ParsedSheet, ParsedCell } from "./types";

export async function parseArquivo(
  buffer: Buffer,
  nomeArquivo: string,
  mimetype?: string,
): Promise<ParsedFile> {
  const ext = nomeArquivo.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xlsm" || mimetype?.includes("spreadsheetml")) {
    return parseXlsx(buffer, nomeArquivo);
  }
  if (ext === "csv" || mimetype === "text/csv") {
    return parseCsv(buffer, nomeArquivo);
  }
  if (ext === "pdf" || mimetype === "application/pdf") {
    return parsePdf(buffer, nomeArquivo);
  }
  throw new Error(`Formato não suportado: ${nomeArquivo} (${mimetype ?? "?"})`);
}

export function amostraParaIa(parsed: ParsedFile, linhasPorAba = 12) {
  return {
    nomeArquivo: parsed.nomeArquivo,
    abas: parsed.abas.map((a) => ({
      nome: a.nome,
      primeirasLinhas: a.linhas.slice(0, linhasPorAba),
    })),
  };
}
