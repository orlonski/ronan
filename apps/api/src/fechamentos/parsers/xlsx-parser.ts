import ExcelJS from "exceljs";
import type { ParsedCell, ParsedFile, ParsedSheet } from "./types";

export async function parseXlsx(buffer: Buffer, nomeArquivo: string): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  // exceljs aceita ArrayBuffer em runtime, mas tipo só fica feliz com Buffer
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const abas: ParsedSheet[] = [];
  for (const ws of wb.worksheets) {
    const linhas: ParsedCell[][] = [];
    const maxRow = ws.actualRowCount || ws.rowCount;
    const maxCol = ws.actualColumnCount || ws.columnCount;
    for (let r = 1; r <= maxRow; r++) {
      const row: ParsedCell[] = [];
      const wsRow = ws.getRow(r);
      for (let c = 1; c <= maxCol; c++) {
        row.push(cellValue(wsRow.getCell(c).value));
      }
      linhas.push(row);
    }
    abas.push({ nome: ws.name, linhas });
  }

  return { formato: "xlsx", nomeArquivo, abas };
}

function cellValue(value: ExcelJS.CellValue): ParsedCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value as string | number;
  }
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((rt: { text: string }) => rt.text).join("");
    }
  }
  return null;
}
