import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  AGRUPAR_POR_LABEL,
  type RelatorioViagensExportQuery,
  type RelatorioViagensResposta,
} from "@ronan/shared-types";
import type { LinhaDetalhe } from "./relatorios-viagens.service";

/**
 * Gera o arquivo do relatório e devolve o Buffer, sem persistir nada.
 *
 * Diferença deliberada pro `ExportFechamentoService`: aquele SEMPRE cria um
 * `EnvioFechamento` e sobe o arquivo pro MinIO, porque um envio pra empresa é
 * um ato rastreável. Relatório é consulta ad-hoc — persistir cada download
 * encheria a tela de Envios de ruído.
 *
 * O estilo do XLSX (negrito no header, fill cinza, numFmt por tipo, rodapé
 * TOTAL) é o mesmo de `montarXlsx` de propósito, pra os dois arquivos parecerem
 * do mesmo sistema. A função não é reusada porque aquela é acoplada a
 * ColunaLayout/ConfigLayout, que é a configuração de layout por empresa.
 */

const FILL_HEADER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE2E8F0" },
};

const FMT_TON = "#,##0.000";
const FMT_KM = "#,##0.00";
const FMT_BRL = '"R$" #,##0.00';

/** Acima disso o PDF vira um calhamaço que ninguém lê — só o resumo entra. */
const MAX_LINHAS_PDF_DETALHE = 1_500;

@Injectable()
export class RelatoriosExportService {
  async xlsx(
    relatorio: RelatorioViagensResposta,
    detalhe: { linhas: LinhaDetalhe[]; truncado: boolean } | null,
    q: RelatorioViagensExportQuery,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Ronan";
    wb.created = new Date();

    this.abaResumo(wb, relatorio, q);
    if (detalhe && detalhe.linhas.length > 0) this.abaDetalhe(wb, detalhe, relatorio.comercial);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private abaResumo(
    wb: ExcelJS.Workbook,
    r: RelatorioViagensResposta,
    q: RelatorioViagensExportQuery,
  ): void {
    const ws = wb.addWorksheet("Resumo");
    const comercial = r.comercial;

    const colunas: { header: string; largura: number; fmt?: string }[] = [
      { header: AGRUPAR_POR_LABEL[r.agruparPor], largura: 30 },
      { header: "Detalhe", largura: 22 },
      { header: "Viagens", largura: 10 },
      { header: "Toneladas", largura: 14, fmt: FMT_TON },
      ...(comercial ? [{ header: "Ton. faturada", largura: 14, fmt: FMT_TON }] : []),
      { header: "Km", largura: 12, fmt: FMT_KM },
      ...(comercial ? [{ header: "Km faturado", largura: 13, fmt: FMT_KM }] : []),
      { header: "Pedágio", largura: 14, fmt: FMT_BRL },
    ];

    let row = 1;
    ws.mergeCells(row, 1, row, colunas.length);
    ws.getCell(row, 1).value = `Produção por ${AGRUPAR_POR_LABEL[r.agruparPor].toLowerCase()}`;
    ws.getCell(row, 1).font = { bold: true, size: 14 };
    row++;

    ws.mergeCells(row, 1, row, colunas.length);
    ws.getCell(row, 1).value = `Período: ${fmtDataBR(r.periodo.de)} a ${fmtDataBR(r.periodo.ate)}`;
    row++;

    const filtros = descreverFiltros(q);
    if (filtros) {
      ws.mergeCells(row, 1, row, colunas.length);
      ws.getCell(row, 1).value = `Filtros: ${filtros}`;
      ws.getCell(row, 1).font = { italic: true, size: 9 };
      row++;
    }
    row++;

    ws.getRow(row).values = colunas.map((c) => c.header);
    ws.getRow(row).font = { bold: true };
    ws.getRow(row).fill = FILL_HEADER;
    const linhaHeader = row;
    row++;

    for (const g of r.grupos) {
      ws.getRow(row).values = [
        g.nome,
        g.detalhe ?? "",
        g.viagens,
        Number(g.toneladas),
        ...(comercial ? [Number(g.toneladasEfetiva ?? 0)] : []),
        Number(g.km),
        ...(comercial ? [Number(g.kmEfetivo ?? 0)] : []),
        Number(g.pedagio),
      ];
      row++;
    }

    row++;
    const t = r.totais;
    ws.getRow(row).values = [
      "TOTAL",
      "",
      t.viagens,
      Number(t.toneladas),
      ...(comercial ? [Number(t.toneladasEfetiva ?? 0)] : []),
      Number(t.km),
      ...(comercial ? [Number(t.kmEfetivo ?? 0)] : []),
      Number(t.pedagio),
    ];
    ws.getRow(row).font = { bold: true };
    row += 2;

    // O bloco que impede a soma errada: quem abrir a planilha precisa entender
    // por que estes números NÃO entram no total de pedágio acima.
    ws.getCell(row, 1).value = "Lançamentos de pedágio (fonte separada — não somar ao total acima)";
    ws.getCell(row, 1).font = { bold: true, size: 9 };
    row++;
    ws.getCell(row, 1).value = "Vinculados a viagem";
    ws.getCell(row, 3).value = Number(r.pedagioReconciliacao.lancamentosVinculados);
    ws.getCell(row, 3).numFmt = FMT_BRL;
    row++;
    ws.getCell(row, 1).value = "Avulsos (sem viagem)";
    ws.getCell(row, 3).value = Number(r.pedagioReconciliacao.lancamentosAvulsos);
    ws.getCell(row, 3).numFmt = FMT_BRL;
    row++;
    ws.getCell(row, 1).value = `Viagens sem pedágio informado: ${t.viagensSemPedagio}`;
    ws.getCell(row, 1).font = { size: 9, italic: true };
    if (t.viagensNaoConciliadas) {
      row++;
      ws.getCell(row, 1).value =
        `${t.viagensNaoConciliadas} viagem(ns) contam como produção aqui mas não entram no XLSX de fechamento (divergente ou em conferência).`;
      ws.getCell(row, 1).font = { size: 9, italic: true };
    }

    colunas.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.largura;
      if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
    });
    ws.views = [{ state: "frozen", ySplit: linhaHeader }];
  }

  private abaDetalhe(
    wb: ExcelJS.Workbook,
    detalhe: { linhas: LinhaDetalhe[]; truncado: boolean },
    comercial: boolean,
  ): void {
    const ws = wb.addWorksheet("Viagens");

    const colunas: { header: string; largura: number; fmt?: string }[] = [
      { header: "Data", largura: 12 },
      { header: "Motorista", largura: 24 },
      { header: "Placa", largura: 11 },
      { header: "Ticket", largura: 14 },
      ...(comercial ? [{ header: "Cliente", largura: 24 }] : []),
      { header: "Material", largura: 20 },
      { header: "Carga", largura: 22 },
      { header: "Descarga", largura: 22 },
      { header: "Toneladas", largura: 13, fmt: FMT_TON },
      ...(comercial ? [{ header: "Ton. faturada", largura: 14, fmt: FMT_TON }] : []),
      { header: "Km", largura: 11, fmt: FMT_KM },
      ...(comercial ? [{ header: "Km faturado", largura: 13, fmt: FMT_KM }] : []),
      { header: "Pedágio", largura: 12, fmt: FMT_BRL },
      { header: "Status", largura: 16 },
    ];

    let row = 1;
    if (detalhe.truncado) {
      ws.mergeCells(row, 1, row, colunas.length);
      ws.getCell(row, 1).value =
        "Lista truncada — o resumo na primeira aba considera TODAS as viagens do período.";
      ws.getCell(row, 1).font = { bold: true, color: { argb: "FFB45309" } };
      row++;
      row++;
    }

    ws.getRow(row).values = colunas.map((c) => c.header);
    ws.getRow(row).font = { bold: true };
    ws.getRow(row).fill = FILL_HEADER;
    const linhaHeader = row;
    row++;

    for (const l of detalhe.linhas) {
      ws.getRow(row).values = [
        // `data` é @db.Date (meia-noite UTC): formatar em UTC, senão volta um dia.
        l.data ? fmtDataUTC(l.data) : "",
        l.motorista,
        l.placa,
        l.ticket ?? "",
        ...(comercial ? [l.cliente ?? ""] : []),
        l.material ?? "",
        l.localCarga ?? "",
        l.localDescarga ?? "",
        Number(l.toneladas),
        ...(comercial ? [Number(l.toneladasEfetiva ?? 0)] : []),
        Number(l.km),
        ...(comercial ? [Number(l.kmEfetivo ?? 0)] : []),
        Number(l.pedagio),
        l.status,
      ];
      row++;
    }

    colunas.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.largura;
      if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
    });
    ws.views = [{ state: "frozen", ySplit: linhaHeader }];
  }

  /**
   * PDF em paisagem: a tabela tem até 8 colunas e em retrato os nomes de local
   * quebram em três linhas. Cabeçalho da tabela é redesenhado a cada página.
   */
  async pdf(
    r: RelatorioViagensResposta,
    detalhe: { linhas: LinhaDetalhe[]; truncado: boolean } | null,
    q: RelatorioViagensExportQuery,
  ): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pronto = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const comercial = r.comercial;
    const larguraUtil = doc.page.width - 72;

    doc.font("Helvetica-Bold").fontSize(15);
    doc.text(`Produção por ${AGRUPAR_POR_LABEL[r.agruparPor].toLowerCase()}`);
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Período: ${fmtDataBR(r.periodo.de)} a ${fmtDataBR(r.periodo.ate)}`);
    const filtros = descreverFiltros(q);
    if (filtros) {
      doc.fontSize(8).fillColor("#555").text(`Filtros: ${filtros}`);
      doc.fillColor("#000");
    }
    doc.moveDown(0.8);

    const colunas: ColunaPdf[] = [
      { header: AGRUPAR_POR_LABEL[r.agruparPor], peso: 3, alinhar: "left" },
      { header: "Viagens", peso: 1, alinhar: "right" },
      { header: "Toneladas", peso: 1.4, alinhar: "right" },
      ...(comercial
        ? [{ header: "Ton. faturada", peso: 1.4, alinhar: "right" } as ColunaPdf]
        : []),
      { header: "Km", peso: 1.3, alinhar: "right" },
      ...(comercial ? [{ header: "Km faturado", peso: 1.4, alinhar: "right" } as ColunaPdf] : []),
      { header: "Pedágio", peso: 1.3, alinhar: "right" },
    ];

    const linhas = r.grupos.map((g) => [
      g.detalhe ? `${g.nome} (${g.detalhe})` : g.nome,
      String(g.viagens),
      fmtNum(g.toneladas, 3),
      ...(comercial ? [fmtNum(g.toneladasEfetiva ?? "0", 3)] : []),
      fmtNum(g.km, 2),
      ...(comercial ? [fmtNum(g.kmEfetivo ?? "0", 2)] : []),
      fmtBRL(g.pedagio),
    ]);

    const t = r.totais;
    const linhaTotal = [
      "TOTAL",
      String(t.viagens),
      fmtNum(t.toneladas, 3),
      ...(comercial ? [fmtNum(t.toneladasEfetiva ?? "0", 3)] : []),
      fmtNum(t.km, 2),
      ...(comercial ? [fmtNum(t.kmEfetivo ?? "0", 2)] : []),
      fmtBRL(t.pedagio),
    ];

    desenharTabela(doc, colunas, linhas, larguraUtil, linhaTotal);

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(8).fillColor("#555");
    // x/width explícitos: depois de desenhar a tabela o cursor está parado na
    // última coluna, e sem isso o texto sai espremido na margem direita.
    doc.text(
      `Lançamentos de pedágio (fonte separada, não somada acima) — vinculados a viagem: ${fmtBRL(r.pedagioReconciliacao.lancamentosVinculados)} · avulsos: ${fmtBRL(r.pedagioReconciliacao.lancamentosAvulsos)}. Viagens sem pedágio informado: ${t.viagensSemPedagio}.` +
        (t.viagensNaoConciliadas
          ? ` ${t.viagensNaoConciliadas} viagem(ns) contam como produção mas não entram no XLSX de fechamento (divergente ou em conferência).`
          : ""),
      36,
      doc.y,
      { width: larguraUtil },
    );
    doc.fillColor("#000");

    if (detalhe && detalhe.linhas.length > 0) {
      const cortadas = detalhe.linhas.slice(0, MAX_LINHAS_PDF_DETALHE);
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).text("Viagens do período");
      doc.moveDown(0.4);
      if (detalhe.truncado || detalhe.linhas.length > cortadas.length) {
        doc.font("Helvetica").fontSize(8).fillColor("#B45309");
        doc.text(
          `Lista limitada a ${cortadas.length} viagens. O resumo da primeira página considera TODAS as viagens do período.`,
        );
        doc.fillColor("#000");
      }
      doc.moveDown(0.4);

      const colsDet: ColunaPdf[] = [
        { header: "Data", peso: 1, alinhar: "left" },
        { header: "Motorista", peso: 2.2, alinhar: "left" },
        { header: "Placa", peso: 1, alinhar: "left" },
        ...(comercial ? [{ header: "Cliente", peso: 2, alinhar: "left" } as ColunaPdf] : []),
        { header: "Material", peso: 1.8, alinhar: "left" },
        { header: "Descarga", peso: 2, alinhar: "left" },
        { header: "Ton.", peso: 1, alinhar: "right" },
        { header: "Km", peso: 1, alinhar: "right" },
      ];

      const linhasDet = cortadas.map((l) => [
        l.data ? fmtDataUTC(l.data) : "",
        l.motorista,
        l.placa,
        ...(comercial ? [l.cliente ?? ""] : []),
        l.material ?? "",
        l.localDescarga ?? "",
        fmtNum(l.toneladas, 3),
        fmtNum(l.km, 2),
      ]);

      desenharTabela(doc, colsDet, linhasDet, larguraUtil, null);
    }

    doc.end();
    return pronto;
  }
}

// --------------------------------------------------------------- tabela PDF --

type ColunaPdf = { header: string; peso: number; alinhar: "left" | "right" };

const LINHA_H = 16;
const PAD = 4;

/**
 * Tabela paginada. pdfkit não tem primitiva de tabela: a quebra de página e a
 * repetição do cabeçalho são feitas aqui. Sem isso, o relatório de um mês vira
 * uma página só com o conteúdo cortado no rodapé.
 */
function desenharTabela(
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

function fmtDataBR(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * `Viagem.data` é @db.Date e chega como meia-noite UTC. Formatar no fuso local
 * volta um dia — é a armadilha que `lib/datetime-br.ts` documenta no painel.
 */
function fmtDataUTC(d: Date): string {
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

function fmtNum(valor: string, casas: number): string {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

function fmtBRL(valor: string): string {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Só o que o usuário realmente filtrou — o arquivo tem que se explicar sozinho. */
function descreverFiltros(q: RelatorioViagensExportQuery): string {
  const partes: string[] = [];
  if (q.motoristaId) partes.push("motorista");
  if (q.clienteId) partes.push("cliente");
  if (q.empresaId) partes.push("empresa");
  if (q.materialId) partes.push("material");
  if (q.localCargaId) partes.push("local de carga");
  if (q.localDescargaId) partes.push("local de descarga");
  if (q.veiculoId) partes.push("veículo");
  if (q.transportadoraId) partes.push("frota");
  return partes.join(", ");
}
