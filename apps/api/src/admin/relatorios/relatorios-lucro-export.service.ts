import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { RelatorioLucroResposta } from "@ronan/shared-types";
import {
  type ColunaPdf,
  desenharTabela,
  FILL_HEADER,
  FMT_BRL,
  FMT_INT,
  fmtBRL,
  fmtDataBR,
} from "./relatorios-export-comum";

/** Uma linha por caminhão, mesma ordem da tela (menor "sobrou" primeiro). */
const COLUNAS_XLSX: { header: string; largura: number; fmt?: string }[] = [
  { header: "Caminhão", largura: 14 },
  { header: "Modelo", largura: 20 },
  { header: "Viagens", largura: 9, fmt: FMT_INT },
  { header: "Km", largura: 10, fmt: FMT_INT },
  { header: "Faturou", largura: 15, fmt: FMT_BRL },
  { header: "Motorista", largura: 14, fmt: FMT_BRL },
  { header: "Combustível", largura: 14, fmt: FMT_BRL },
  { header: "Pedágio", largura: 13, fmt: FMT_BRL },
  { header: "Manutenção", largura: 14, fmt: FMT_BRL },
  { header: "Multas", largura: 12, fmt: FMT_BRL },
  { header: "Custos fixos", largura: 14, fmt: FMT_BRL },
  { header: "Outras contas", largura: 14, fmt: FMT_BRL },
  { header: "Gastou", largura: 15, fmt: FMT_BRL },
  { header: "Custo/km", largura: 11, fmt: FMT_BRL },
  { header: "Sobrou", largura: 15, fmt: FMT_BRL },
  { header: "Margem %", largura: 10, fmt: "0.0" },
];

function margemTexto(m: number | null): string {
  return m == null ? "—" : `${m.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** As ressalvas da conta, em frases — vão no rodapé dos dois formatos. */
function ressalvas(r: RelatorioLucroResposta): string[] {
  const a = r.frota.avisos;
  const f: string[] = [];
  if (a.viagensSemPreco) {
    f.push(`${a.viagensSemPreco} viagem(ns) sem preço cadastrado: o faturado está menor do que é.`);
  }
  if (a.viagensSemCustoMotorista) {
    f.push(`${a.viagensSemCustoMotorista} viagem(ns) sem regra de pagamento do motorista: o custo dele não entrou.`);
  }
  if (a.viagensEmpregado) {
    f.push(`${a.viagensEmpregado} viagem(ns) de motorista registrado: o salário entra como custo fixo do caminhão.`);
  }
  if (a.abastecimentosEstimados) {
    f.push(`${a.abastecimentosEstimados} abastecimento(s) sem valor foram estimados pelo preço médio do litro.`);
  }
  if (a.abastecimentosSemPreco) {
    f.push(`${a.abastecimentosSemPreco} abastecimento(s) sem valor e sem preço pra estimar não entraram.`);
  }
  if (a.manutencoesSemValor) {
    f.push(`${a.manutencoesSemValor} manutenção(ões) concluída(s) sem valor não entraram.`);
  }
  const fora = Number(r.frota.foraDaConta.combustivel) + Number(r.frota.foraDaConta.pedagio);
  if (fora > 0) {
    f.push(`${fmtBRL(String(fora))} de combustível e pedágio pagos pelo motorista sem reembolso ficaram fora da conta.`);
  }
  return f;
}

@Injectable()
export class RelatoriosLucroExportService {
  async xlsx(r: RelatorioLucroResposta): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Movatruck";
    wb.created = new Date();
    const ws = wb.addWorksheet("Lucro por caminhão");

    let row = 1;
    ws.mergeCells(row, 1, row, COLUNAS_XLSX.length);
    ws.getCell(row, 1).value = "Lucro por caminhão";
    ws.getCell(row, 1).font = { bold: true, size: 14 };
    row++;
    ws.mergeCells(row, 1, row, COLUNAS_XLSX.length);
    ws.getCell(row, 1).value = `Período: ${fmtDataBR(r.periodo.de)} a ${fmtDataBR(r.periodo.ate)}`;
    row += 2;

    ws.getRow(row).values = COLUNAS_XLSX.map((c) => c.header);
    ws.getRow(row).font = { bold: true };
    ws.getRow(row).fill = FILL_HEADER;
    const linhaHeader = row;
    row++;

    for (const v of r.veiculos) {
      ws.getRow(row).values = [
        v.placa,
        v.modelo ?? "",
        v.viagens,
        Number(v.km),
        Number(v.faturou),
        Number(v.custos.motorista),
        Number(v.custos.combustivel),
        Number(v.custos.pedagio),
        Number(v.custos.manutencao),
        Number(v.custos.multas),
        Number(v.custos.custosFixos),
        Number(v.custos.outrasContas),
        Number(v.gastou),
        v.porKm ? Number(v.porKm.gastou) : null,
        Number(v.sobrou),
        v.margem ?? null,
      ];
      row++;
    }

    row++;
    const t = r.frota;
    ws.getRow(row).values = [
      "TOTAL",
      "",
      t.viagens,
      Number(t.km),
      Number(t.faturou),
      Number(t.custos.motorista),
      Number(t.custos.combustivel),
      Number(t.custos.pedagio),
      Number(t.custos.manutencao),
      Number(t.custos.multas),
      Number(t.custos.custosFixos),
      Number(t.custos.outrasContas),
      Number(t.gastou),
      t.porKm ? Number(t.porKm.gastou) : null,
      Number(t.sobrou),
      t.margem ?? null,
    ];
    ws.getRow(row).font = { bold: true };
    row += 2;

    for (const frase of ressalvas(r)) {
      ws.getCell(row, 1).value = frase;
      ws.getCell(row, 1).font = { size: 9, italic: true };
      row++;
    }

    COLUNAS_XLSX.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.largura;
      if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
    });
    ws.views = [{ state: "frozen", ySplit: linhaHeader }];

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async pdf(r: RelatorioLucroResposta): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pronto = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const larguraUtil = doc.page.width - 72;
    doc.font("Helvetica-Bold").fontSize(15).text("Lucro por caminhão");
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Período: ${fmtDataBR(r.periodo.de)} a ${fmtDataBR(r.periodo.ate)}`);
    doc.moveDown(0.8);

    // O PDF é pra ler, não pra recalcular: as sete colunas de custo viram
    // três (motorista, combustível+pedágio, o resto do caminhão).
    const colunas: ColunaPdf[] = [
      { header: "Caminhão", peso: 2.2, alinhar: "left" },
      { header: "Viagens", peso: 0.9, alinhar: "right" },
      { header: "Faturou", peso: 1.5, alinhar: "right" },
      { header: "Motorista", peso: 1.4, alinhar: "right" },
      { header: "Diesel e pedágio", peso: 1.5, alinhar: "right" },
      { header: "Caminhão", peso: 1.4, alinhar: "right" },
      { header: "Gastou", peso: 1.5, alinhar: "right" },
      { header: "Sobrou", peso: 1.5, alinhar: "right" },
      { header: "Margem", peso: 0.9, alinhar: "right" },
    ];
    const doCaminhao = (c: RelatorioLucroResposta["frota"]["custos"]) =>
      String(
        Number(c.manutencao) + Number(c.multas) + Number(c.custosFixos) + Number(c.outrasContas),
      );
    const linhas = r.veiculos.map((v) => [
      v.modelo ? `${v.placa} (${v.modelo})` : v.placa,
      String(v.viagens),
      fmtBRL(v.faturou),
      fmtBRL(v.custos.motorista),
      fmtBRL(String(Number(v.custos.combustivel) + Number(v.custos.pedagio))),
      fmtBRL(doCaminhao(v.custos)),
      fmtBRL(v.gastou),
      fmtBRL(v.sobrou),
      margemTexto(v.margem),
    ]);
    const t = r.frota;
    const total = [
      "TOTAL",
      String(t.viagens),
      fmtBRL(t.faturou),
      fmtBRL(t.custos.motorista),
      fmtBRL(String(Number(t.custos.combustivel) + Number(t.custos.pedagio))),
      fmtBRL(doCaminhao(t.custos)),
      fmtBRL(t.gastou),
      fmtBRL(t.sobrou),
      margemTexto(t.margem),
    ];
    desenharTabela(doc, colunas, linhas, larguraUtil, total);

    const frases = ressalvas(r);
    if (frases.length) {
      doc.moveDown(1);
      doc.font("Helvetica").fontSize(8).fillColor("#555");
      for (const frase of frases) doc.text(frase, 36, doc.y, { width: larguraUtil });
      doc.fillColor("#000");
    }

    doc.end();
    return pronto;
  }
}
