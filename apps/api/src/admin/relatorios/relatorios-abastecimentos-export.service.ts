import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  AGRUPAR_POR_ABASTECIMENTO_LABEL,
  type RelatorioAbastecimentosExportQuery,
  type RelatorioAbastecimentosResposta,
  TIPO_COMBUSTIVEL_LABEL,
} from "@ronan/shared-types";
import type { LinhaDetalheAbastecimento } from "./relatorios-abastecimentos.service";
import {
  type ColunaPdf,
  desenharTabela,
  FILL_HEADER,
  FMT_BRL,
  FMT_INT,
  FMT_LITROS,
  FMT_PRECO,
  fmtBRL,
  fmtDataBR,
  fmtDataHoraSP,
  fmtNum,
} from "./relatorios-export-comum";

/**
 * XLSX/PDF do relatório de abastecimentos. Espelha o de viagens (mesmo estilo,
 * mesma estrutura de duas abas), com uma regra própria: valor em branco é
 * BRANCO, nunca zero. Abastecimento de comboio entra sem valor, e escrever 0,00
 * faria a soma da planilha bater com o rodapé e mentir sobre o custo.
 */

const MAX_LINHAS_PDF_DETALHE = 1_500;

@Injectable()
export class RelatoriosAbastecimentosExportService {
  async xlsx(
    relatorio: RelatorioAbastecimentosResposta,
    detalhe: { linhas: LinhaDetalheAbastecimento[]; truncado: boolean } | null,
    q: RelatorioAbastecimentosExportQuery,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Ronan";
    wb.created = new Date();

    this.abaResumo(wb, relatorio, q);
    if (detalhe && detalhe.linhas.length > 0) this.abaDetalhe(wb, detalhe);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private abaResumo(
    wb: ExcelJS.Workbook,
    r: RelatorioAbastecimentosResposta,
    q: RelatorioAbastecimentosExportQuery,
  ): void {
    const ws = wb.addWorksheet("Resumo");
    const titulo = AGRUPAR_POR_ABASTECIMENTO_LABEL[r.agruparPor];

    const colunas: { header: string; largura: number; fmt?: string }[] = [
      { header: titulo, largura: 30 },
      { header: "Detalhe", largura: 22 },
      { header: "Abastecimentos", largura: 15, fmt: FMT_INT },
      { header: "Litros", largura: 14, fmt: FMT_LITROS },
      { header: "Valor", largura: 15, fmt: FMT_BRL },
      { header: "R$/litro", largura: 12, fmt: FMT_PRECO },
      { header: "Sem valor", largura: 11, fmt: FMT_INT },
    ];

    let row = 1;
    ws.mergeCells(row, 1, row, colunas.length);
    ws.getCell(row, 1).value = `Abastecimentos por ${titulo.toLowerCase()}`;
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
        g.abastecimentos,
        Number(g.litros),
        Number(g.valor),
        Number(g.precoMedio),
        g.semValor,
      ];
      row++;
    }

    row++;
    const t = r.totais;
    ws.getRow(row).values = [
      "TOTAL",
      "",
      t.abastecimentos,
      Number(t.litros),
      Number(t.valor),
      Number(t.precoMedio),
      t.semValor,
    ];
    ws.getRow(row).font = { bold: true };
    row += 2;

    // Quem abre a planilha precisa entender por que o R$/litro do TOTAL não é a
    // divisão das duas colunas ao lado quando existe comboio.
    ws.getCell(row, 1).value =
      `R$/litro considera só os ${fmtNum(t.litrosComValor, 3)} litros com valor informado.`;
    ws.getCell(row, 1).font = { size: 9, italic: true };
    if (t.semValor) {
      row++;
      ws.getCell(row, 1).value =
        `${t.semValor} abastecimento(s) sem valor informado — ${t.emComboio} marcado(s) como comboio. Os litros contam; o custo não.`;
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
    detalhe: { linhas: LinhaDetalheAbastecimento[]; truncado: boolean },
  ): void {
    const ws = wb.addWorksheet("Abastecimentos");

    const colunas: { header: string; largura: number; fmt?: string }[] = [
      { header: "Data", largura: 17 },
      { header: "Motorista", largura: 24 },
      { header: "Placa", largura: 11 },
      { header: "Empresa", largura: 22 },
      { header: "Combustível", largura: 14 },
      { header: "Posto", largura: 24 },
      { header: "Litros", largura: 12, fmt: FMT_LITROS },
      { header: "Valor", largura: 14, fmt: FMT_BRL },
      { header: "R$/litro", largura: 12, fmt: FMT_PRECO },
      { header: "Odômetro", largura: 13, fmt: FMT_INT },
      { header: "Tanque cheio", largura: 13 },
      { header: "Comboio", largura: 10 },
    ];

    let row = 1;
    if (detalhe.truncado) {
      ws.mergeCells(row, 1, row, colunas.length);
      ws.getCell(row, 1).value =
        "Lista truncada — o resumo na primeira aba considera TODOS os abastecimentos do período.";
      ws.getCell(row, 1).font = { bold: true, color: { argb: "FFB45309" } };
      row += 2;
    }

    ws.getRow(row).values = colunas.map((c) => c.header);
    ws.getRow(row).font = { bold: true };
    ws.getRow(row).fill = FILL_HEADER;
    const linhaHeader = row;
    row++;

    for (const l of detalhe.linhas) {
      ws.getRow(row).values = [
        fmtDataHoraSP(l.data),
        l.motorista,
        l.placa,
        l.empresa ?? "",
        TIPO_COMBUSTIVEL_LABEL[l.tipo] ?? l.tipo,
        l.posto ?? "",
        Number(l.litros),
        // Célula VAZIA quando não tem valor — ver o comentário do topo.
        l.valor === null ? "" : Number(l.valor),
        l.precoLitro === null ? "" : Number(l.precoLitro),
        l.odometro,
        l.tanqueCheio ? "Sim" : "Não",
        l.emComboio ? "Sim" : "",
      ];
      row++;
    }

    colunas.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.largura;
      if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
    });
    ws.views = [{ state: "frozen", ySplit: linhaHeader }];
  }

  async pdf(
    r: RelatorioAbastecimentosResposta,
    detalhe: { linhas: LinhaDetalheAbastecimento[]; truncado: boolean } | null,
    q: RelatorioAbastecimentosExportQuery,
  ): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pronto = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const larguraUtil = doc.page.width - 72;
    const titulo = AGRUPAR_POR_ABASTECIMENTO_LABEL[r.agruparPor];

    doc.font("Helvetica-Bold").fontSize(15);
    doc.text(`Abastecimentos por ${titulo.toLowerCase()}`);
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
      { header: titulo, peso: 3, alinhar: "left" },
      { header: "Abastec.", peso: 1.1, alinhar: "right" },
      { header: "Litros", peso: 1.5, alinhar: "right" },
      { header: "Valor", peso: 1.6, alinhar: "right" },
      { header: "R$/litro", peso: 1.3, alinhar: "right" },
      { header: "Sem valor", peso: 1.1, alinhar: "right" },
    ];

    const linhas = r.grupos.map((g) => [
      g.detalhe ? `${g.nome} (${g.detalhe})` : g.nome,
      String(g.abastecimentos),
      fmtNum(g.litros, 3),
      fmtBRL(g.valor),
      fmtNum(g.precoMedio, 3),
      g.semValor ? String(g.semValor) : "",
    ]);

    const t = r.totais;
    const linhaTotal = [
      "TOTAL",
      String(t.abastecimentos),
      fmtNum(t.litros, 3),
      fmtBRL(t.valor),
      fmtNum(t.precoMedio, 3),
      t.semValor ? String(t.semValor) : "",
    ];

    desenharTabela(doc, colunas, linhas, larguraUtil, linhaTotal);

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(8).fillColor("#555");
    // x/width explícitos: depois da tabela o cursor está parado na última
    // coluna, e sem isso o texto sai espremido na margem direita.
    doc.text(
      `R$/litro considera só os ${fmtNum(t.litrosComValor, 3)} litros com valor informado.` +
        (t.semValor
          ? ` ${t.semValor} abastecimento(s) entraram sem valor (${t.emComboio} em comboio): os litros contam, o custo não.`
          : ""),
      36,
      doc.y,
      { width: larguraUtil },
    );
    doc.fillColor("#000");

    if (detalhe && detalhe.linhas.length > 0) {
      const cortadas = detalhe.linhas.slice(0, MAX_LINHAS_PDF_DETALHE);
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).text("Abastecimentos do período");
      doc.moveDown(0.4);
      if (detalhe.truncado || detalhe.linhas.length > cortadas.length) {
        doc.font("Helvetica").fontSize(8).fillColor("#B45309");
        doc.text(
          `Lista limitada a ${cortadas.length} abastecimentos. O resumo da primeira página considera TODOS os do período.`,
        );
        doc.fillColor("#000");
      }
      doc.moveDown(0.4);

      const colsDet: ColunaPdf[] = [
        { header: "Data", peso: 1.6, alinhar: "left" },
        { header: "Motorista", peso: 2.2, alinhar: "left" },
        { header: "Placa", peso: 1, alinhar: "left" },
        { header: "Posto", peso: 2.2, alinhar: "left" },
        { header: "Combustível", peso: 1.4, alinhar: "left" },
        { header: "Litros", peso: 1.2, alinhar: "right" },
        { header: "Valor", peso: 1.4, alinhar: "right" },
        { header: "Odômetro", peso: 1.3, alinhar: "right" },
      ];

      const linhasDet = cortadas.map((l) => [
        fmtDataHoraSP(l.data),
        l.motorista,
        l.placa,
        l.posto ?? "",
        TIPO_COMBUSTIVEL_LABEL[l.tipo] ?? l.tipo,
        fmtNum(l.litros, 3),
        l.valor === null ? "—" : fmtBRL(l.valor),
        l.odometro.toLocaleString("pt-BR"),
      ]);

      desenharTabela(doc, colsDet, linhasDet, larguraUtil, null);
    }

    doc.end();
    return pronto;
  }
}

/** Só o que o usuário realmente filtrou — o arquivo tem que se explicar sozinho. */
function descreverFiltros(q: RelatorioAbastecimentosExportQuery): string {
  const partes: string[] = [];
  if (q.motoristaId) partes.push("motorista");
  if (q.veiculoId) partes.push("veículo");
  if (q.empresaId) partes.push("empresa");
  if (q.transportadoraId) partes.push("frota");
  if (q.tipo) partes.push(`combustível ${TIPO_COMBUSTIVEL_LABEL[q.tipo] ?? q.tipo}`);
  if (q.posto) partes.push(`posto ${q.posto}`);
  return partes.join(", ");
}
