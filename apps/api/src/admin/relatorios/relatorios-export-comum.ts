import type ExcelJS from "exceljs";

/**
 * O que os exports de relatório (viagens e abastecimentos) compartilham:
 * estilo da planilha, formatos numéricos, formatação pt-BR e a tabela paginada
 * do PDF — que pdfkit não tem como primitiva.
 *
 * Mora aqui, e não em cada service, pra os dois arquivos continuarem parecendo
 * do mesmo sistema. Não confundir com `ExportFechamentoService`: aquele é
 * acoplado ao layout por empresa e sempre persiste um envio.
 */

export const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE2E8F0" },
};

export const FMT_TON = "#,##0.000";
export const FMT_KM = "#,##0.00";
export const FMT_BRL = '"R$" #,##0.00';
export const FMT_LITROS = "#,##0.000";
/** R$/litro: três casas, porque a segunda decide a comparação entre postos. */
export const FMT_PRECO = '"R$" #,##0.000';
export const FMT_INT = "#,##0";

// ---------------------------------------------------------------- tabela PDF --

export type ColunaPdf = { header: string; peso: number; alinhar: "left" | "right" };

const LINHA_H = 16;
const PAD = 4;

/**
 * Tabela paginada. A quebra de página e a repetição do cabeçalho são feitas
 * aqui — sem isso, o relatório de um mês vira uma página só com o conteúdo
 * cortado no rodapé.
 */
export function desenharTabela(
  doc: PDFKit.PDFDocument,
  colunas: ColunaPdf[],
  linhas: string[][],
  larguraUtil: number,
  linhaTotal: string[] | null,
): void {
  const pesoTotal = colunas.reduce((s, c) => s + c.peso, 0);
  const larguras = colunas.map((c) => (c.peso / pesoTotal) * larguraUtil);
  const limiteY = doc.page.height - 50;

  const header = () => {
    const y = doc.y;
    doc.rect(36, y, larguraUtil, LINHA_H).fill("#E2E8F0");
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(8);
    let x = 36;
    colunas.forEach((c, i) => {
      doc.text(c.header, x + PAD, y + 4, {
        width: larguras[i]! - PAD * 2,
        align: c.alinhar,
        lineBreak: false,
      });
      x += larguras[i]!;
    });
    doc.y = y + LINHA_H;
  };

  header();
  doc.font("Helvetica").fontSize(8);

  for (const linha of linhas) {
    if (doc.y + LINHA_H > limiteY) {
      doc.addPage();
      header();
      doc.font("Helvetica").fontSize(8);
    }
    const y = doc.y;
    let x = 36;
    linha.forEach((celula, i) => {
      doc.text(celula, x + PAD, y + 4, {
        width: larguras[i]! - PAD * 2,
        align: colunas[i]!.alinhar,
        lineBreak: false,
        ellipsis: true,
      });
      x += larguras[i]!;
    });
    doc
      .moveTo(36, y + LINHA_H)
      .lineTo(36 + larguraUtil, y + LINHA_H)
      .strokeColor("#E5E7EB")
      .lineWidth(0.5)
      .stroke();
    doc.y = y + LINHA_H;
  }

  if (linhaTotal) {
    if (doc.y + LINHA_H > limiteY) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8);
    let x = 36;
    linhaTotal.forEach((celula, i) => {
      doc.text(celula, x + PAD, y + 4, {
        width: larguras[i]! - PAD * 2,
        align: colunas[i]!.alinhar,
        lineBreak: false,
      });
      x += larguras[i]!;
    });
    doc.y = y + LINHA_H;
  }
}

// ------------------------------------------------------------------ formato --

export function fmtDataBR(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * `Viagem.data` é @db.Date e chega como meia-noite UTC. Formatar no fuso local
 * volta um dia — é a armadilha que `lib/datetime-br.ts` documenta no painel.
 */
export function fmtDataUTC(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

/**
 * `Abastecimento.data` é timestamp de verdade (a hora importa). O container
 * roda em UTC, então a conversão pra Brasília é explícita — sem isso, tudo que
 * foi lançado depois das 21h aparece no dia seguinte na planilha.
 */
export function fmtDataHoraSP(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function fmtNum(valor: string, casas: number): string {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function fmtBRL(valor: string): string {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
