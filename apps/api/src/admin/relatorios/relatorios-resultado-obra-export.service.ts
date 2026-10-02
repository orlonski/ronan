import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { LinhaResultadoObra, RelatorioResultadoObraResposta } from "@ronan/shared-types";
import type { RelatoriosResultadoObraService } from "./relatorios-resultado-obra.service";
import {
  type ColunaPdf,
  desenharTabela,
  FILL_HEADER,
  FMT_BRL,
  FMT_INT,
  FMT_TON,
  fmtBRL,
  fmtDataBR,
  fmtNum,
} from "./relatorios-export-comum";

type Completo = Awaited<ReturnType<RelatoriosResultadoObraService["completo"]>>;

const COLUNAS_XLSX: { header: string; largura: number; fmt?: string }[] = [
  { header: "Obra", largura: 28 },
  { header: "Cliente", largura: 24 },
  { header: "Viagens", largura: 9, fmt: FMT_INT },
  { header: "Toneladas", largura: 12, fmt: FMT_TON },
  { header: "Km", largura: 10, fmt: FMT_INT },
  { header: "Frete", largura: 14, fmt: FMT_BRL },
  { header: "Pedágio repassado", largura: 14, fmt: FMT_BRL },
  { header: "Estadia", largura: 12, fmt: FMT_BRL },
  { header: "Receita", largura: 15, fmt: FMT_BRL },
  { header: "Motorista", largura: 14, fmt: FMT_BRL },
  { header: "Pedágio da viagem", largura: 14, fmt: FMT_BRL },
  { header: "Combustível", largura: 14, fmt: FMT_BRL },
  { header: "Caminhão (rateado)", largura: 15, fmt: FMT_BRL },
  { header: "Custo", largura: 15, fmt: FMT_BRL },
  { header: "Margem", largura: 15, fmt: FMT_BRL },
  { header: "Margem %", largura: 10, fmt: "0.0" },
  { header: "Margem/t", largura: 11, fmt: FMT_BRL },
  { header: "Margem/viagem", largura: 13, fmt: FMT_BRL },
  { header: "Viagens sem preço", largura: 11, fmt: FMT_INT },
];

/** O que é do caminhão e chega rateado, numa coluna só. */
function doCaminhao(c: LinhaResultadoObra["custos"]): number {
  return (
    Number(c.pedagioAvulso) +
    Number(c.manutencao) +
    Number(c.multas) +
    Number(c.custosFixos) +
    Number(c.outrasContas)
  );
}

function margemTexto(m: number | null): string {
  return m == null ? "—" : `${m.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function ressalvas(r: Pick<RelatorioResultadoObraResposta, "total" | "parado" | "conferencia">): string[] {
  const f: string[] = [
    "Motorista e pedágio da viagem são diretos; combustível e o resto do caminhão (manutenção, multas, custos fixos, contas) são rateados pelo km que cada viagem rodou no caminhão.",
  ];
  const a = r.total.avisos;
  if (a.viagensSemPreco) {
    f.push(
      `${a.viagensSemPreco} viagem(ns) sem preço: o custo delas (${fmtBRL(r.total.semPreco.custo)}) entrou, a receita não.`,
    );
  }
  if (a.viagensSemCustoMotorista) {
    f.push(`${a.viagensSemCustoMotorista} viagem(ns) sem regra de pagamento do motorista: o custo dele não entrou.`);
  }
  if (a.viagensEmpregado) {
    f.push(`${a.viagensEmpregado} viagem(ns) de motorista registrado: o salário entra pelo custo fixo do caminhão.`);
  }
  if (r.parado) {
    f.push(`${fmtBRL(r.parado.custo)} de caminhões que não rodaram no período não têm obra pra carregar e estão no total.`);
  }
  if (r.conferencia) {
    f.push(
      `Lucro por caminhão no mesmo período: faturou ${fmtBRL(r.conferencia.faturouLucro)}, gastou ${fmtBRL(r.conferencia.gastouLucro)} (sem estadia).`,
    );
  }
  return f;
}

function valoresLinha(l: LinhaResultadoObra): (string | number | null)[] {
  return [
    l.obra,
    l.empresa ?? "",
    l.viagens,
    Number(l.toneladas),
    Number(l.km),
    Number(l.receita.frete),
    Number(l.receita.pedagio),
    Number(l.receita.estadia),
    Number(l.receita.total),
    Number(l.custos.motorista),
    Number(l.custos.pedagio),
    Number(l.custos.combustivel),
    doCaminhao(l.custos),
    Number(l.custo),
    Number(l.margem),
    l.margemPct,
    l.porTonelada ? Number(l.porTonelada.margem) : null,
    l.porViagem ? Number(l.porViagem.margem) : null,
    l.semPreco.viagens,
  ];
}

@Injectable()
export class RelatoriosResultadoObraExportService {
  async xlsx(r: Completo): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Movatruck";
    wb.created = new Date();
    const ws = wb.addWorksheet("Resultado por obra");

    let row = 1;
    ws.mergeCells(row, 1, row, COLUNAS_XLSX.length);
    ws.getCell(row, 1).value = "Resultado por obra";
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

    const linhas = [...r.obras, ...(r.semObra ? [r.semObra] : [])];
    for (const l of linhas) {
      ws.getRow(row).values = valoresLinha(l);
      row++;
    }
    if (r.parado) {
      const c = r.parado.custos;
      ws.getRow(row).values = [
        "Caminhão parado (sem viagem)",
        r.parado.caminhoes.map((x) => x.placa).join(", "),
        0, 0, 0, 0, 0, 0, 0,
        Number(c.motorista),
        Number(c.pedagio),
        Number(c.combustivel),
        doCaminhao(c),
        Number(r.parado.custo),
        -Number(r.parado.custo),
        null, null, null, 0,
      ];
      row++;
    }

    row++;
    const t = r.total;
    ws.getRow(row).values = [
      "TOTAL",
      "",
      t.viagens,
      Number(t.toneladas),
      Number(t.km),
      Number(t.receita.frete),
      Number(t.receita.pedagio),
      Number(t.receita.estadia),
      Number(t.receita.total),
      Number(t.custos.motorista),
      Number(t.custos.pedagio),
      Number(t.custos.combustivel),
      doCaminhao(t.custos),
      Number(t.custo),
      Number(t.margem),
      t.margemPct,
      null,
      null,
      t.semPreco.viagens,
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

    // Segunda aba: viagem a viagem, pra quem quer refazer a soma ou filtrar.
    const wv = wb.addWorksheet("Viagens");
    const colsV: { header: string; largura: number; fmt?: string }[] = [
      { header: "Data", largura: 11 },
      { header: "Obra", largura: 28 },
      { header: "Cliente", largura: 24 },
      { header: "Caminhão", largura: 11 },
      { header: "Ticket", largura: 12 },
      { header: "Toneladas", largura: 11, fmt: FMT_TON },
      { header: "Km", largura: 9, fmt: FMT_INT },
      { header: "Receita", largura: 14, fmt: FMT_BRL },
      { header: "Custo direto", largura: 14, fmt: FMT_BRL },
      { header: "Custo rateado", largura: 14, fmt: FMT_BRL },
      { header: "Custo", largura: 14, fmt: FMT_BRL },
      { header: "Margem", largura: 14, fmt: FMT_BRL },
      { header: "Sem preço", largura: 10 },
    ];
    wv.getRow(1).values = colsV.map((c) => c.header);
    wv.getRow(1).font = { bold: true };
    wv.getRow(1).fill = FILL_HEADER;
    let rv = 2;
    for (const l of linhas) {
      for (const v of l.viagensLista) {
        wv.getRow(rv).values = [
          fmtDataBR(v.data),
          l.obra,
          l.empresa ?? "",
          v.placa,
          v.ticket ?? "",
          Number(v.toneladas),
          Number(v.km),
          Number(v.receita),
          Number(v.custoDireto),
          Number(v.custoRateado),
          Number(v.custo),
          Number(v.margem),
          v.semPreco ? "sim" : "",
        ];
        rv++;
      }
    }
    colsV.forEach((c, i) => {
      wv.getColumn(i + 1).width = c.largura;
      if (c.fmt) wv.getColumn(i + 1).numFmt = c.fmt;
    });
    wv.views = [{ state: "frozen", ySplit: 1 }];

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async pdf(r: Completo): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const pronto = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const larguraUtil = doc.page.width - 72;
    doc.font("Helvetica-Bold").fontSize(15).text("Resultado por obra");
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Período: ${fmtDataBR(r.periodo.de)} a ${fmtDataBR(r.periodo.ate)}`);
    doc.moveDown(0.8);

    const colunas: ColunaPdf[] = [
      { header: "Obra", peso: 2.4, alinhar: "left" },
      { header: "Cliente", peso: 1.8, alinhar: "left" },
      { header: "Viagens", peso: 0.8, alinhar: "right" },
      { header: "Toneladas", peso: 1.1, alinhar: "right" },
      { header: "Receita", peso: 1.4, alinhar: "right" },
      { header: "Custo", peso: 1.4, alinhar: "right" },
      { header: "Margem", peso: 1.4, alinhar: "right" },
      { header: "Margem %", peso: 0.9, alinhar: "right" },
      { header: "Margem/t", peso: 1.0, alinhar: "right" },
    ];
    const linhas = [...r.obras, ...(r.semObra ? [r.semObra] : [])].map((l) => [
      l.semPreco.viagens ? `${l.obra} (${l.semPreco.viagens} sem preço)` : l.obra,
      l.empresa ?? "—",
      String(l.viagens),
      fmtNum(l.toneladas, 1),
      fmtBRL(l.receita.total),
      fmtBRL(l.custo),
      fmtBRL(l.margem),
      margemTexto(l.margemPct),
      l.porTonelada ? fmtBRL(l.porTonelada.margem) : "—",
    ]);
    if (r.parado) {
      linhas.push([
        "Caminhão parado",
        r.parado.caminhoes.map((c) => c.placa).join(", "),
        "0",
        "—",
        fmtBRL("0"),
        fmtBRL(r.parado.custo),
        fmtBRL(String(-Number(r.parado.custo))),
        "—",
        "—",
      ]);
    }
    const t = r.total;
    const total = [
      "TOTAL",
      "",
      String(t.viagens),
      fmtNum(t.toneladas, 1),
      fmtBRL(t.receita.total),
      fmtBRL(t.custo),
      fmtBRL(t.margem),
      margemTexto(t.margemPct),
      "",
    ];
    desenharTabela(doc, colunas, linhas, larguraUtil, total);

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(8).fillColor("#555");
    for (const frase of ressalvas(r)) doc.text(frase, 36, doc.y, { width: larguraUtil });
    doc.fillColor("#000");

    doc.end();
    return pronto;
  }
}
