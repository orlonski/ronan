import { PDFParse } from "pdf-parse";
import type { ParsedCell, ParsedFile, ParsedSheet } from "./types";

/**
 * PDFs de boletim normalmente vêm como texto layout-preservado.
 * Aqui extraímos linha por linha; cada bloco de página vira uma "aba" se houver
 * cabeçalho de seção identificável (RELAÇÃO PEDÁGIOS, RELAÇÃO DE CAMINHÕES).
 *
 * Esse parser é menos preciso que XLSX — depende muito da IA pra entender as colunas.
 * Convertemos cada linha em um array de células separando por 2+ espaços.
 */
export async function parsePdf(buffer: Buffer, nomeArquivo: string): Promise<ParsedFile> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let text = "";
  try {
    const result = await parser.getText();
    text = result.text ?? "";
  } finally {
    await parser.destroy().catch(() => {});
  }

  const SECTION_PATTERNS = [
    { name: "Boletim de Medição", regex: /BOLETIM DE MEDI[ÇC][AÃ]O/i },
    { name: "Relação de Pedágios", regex: /RELA[ÇC][AÃ]O\s+PED[AÁ]GIOS?/i },
    { name: "Relação de Caminhões", regex: /RELA[ÇC][AÃ]O\s+(?:DE\s+)?CAMINH[ÕO]ES|REL[\.\s]*CAMIN/i },
    { name: "Descontos", regex: /DESCONTOS?/i },
  ];

  const lines = text.split(/\r?\n/);
  const abas: ParsedSheet[] = [];
  let abaAtual: ParsedSheet = { nome: "página 1", linhas: [] };
  abas.push(abaAtual);

  for (const line of lines) {
    const trimmed = line.trim();
    const match = SECTION_PATTERNS.find((p) => p.regex.test(trimmed));
    if (match && trimmed.length < 60) {
      abaAtual = { nome: match.name, linhas: [] };
      abas.push(abaAtual);
      continue;
    }
    if (!trimmed) continue;
    abaAtual.linhas.push(splitLine(line));
  }

  const final = abas.filter((a) => a.linhas.length > 0);
  return { formato: "pdf", nomeArquivo, abas: final };
}

function splitLine(line: string): ParsedCell[] {
  return line
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter((c) => c !== "")
    .map((c) => {
      if (/^R?\$?\s*[\d.,]+$/.test(c)) {
        const num = Number(c.replace(/[R$\s.]/g, "").replace(",", "."));
        if (!Number.isNaN(num)) return num;
      }
      const m = c.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      return c;
    });
}
