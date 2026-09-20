import ExcelJS from "exceljs";
import { rotuloDia, type AlvoMedicao } from "./medicao-planilha";

/**
 * O arquivo que a gente MANDA pro contratante — já preenchido com quem está
 * alocado, as placas e cada dia do período.
 *
 * É a peça que destrava o importador. Enquanto o produto esperava "uma
 * planilha real de contratante" pra escrever o parser contra ela, o
 * lançamento ficou manual; mandando o modelo, o formato passa a ser nosso e o
 * que volta é previsível. Quem recebe um modelo preenchido devolve o modelo
 * preenchido — e quem não devolver, a leitura ainda tenta casar por placa,
 * CPF e nome.
 *
 * Dois jeitos de preencher, na mesma folha, porque os dois existem na vida
 * real: escrever o TOTAL de dias, ou marcar X dia a dia. A grade vale mais —
 * com ela dá pra apontar QUAL dia caiu, que é a contestação que se ganha.
 */
export async function montarModeloMedicao(args: {
  contratante: string;
  competencia: string;
  de: string;
  ate: string;
  dias: string[];
  alvos: AlvoMedicao[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Movatruck";
  const ws = wb.addWorksheet("Medição");

  const colunasDeDia = args.dias.map(rotuloDia);
  const cabecalho = ["Motorista", "CPF", "Obra", "Placa", "Total de dias", ...colunasDeDia, "Código"];

  ws.addRow([`Medição — ${args.contratante}`]);
  ws.addRow([`Competência ${args.competencia} · período de ${br(args.de)} a ${br(args.ate)}`]);
  ws.addRow([
    "Preencha o TOTAL de dias, ou marque X nos dias trabalhados. Não altere a coluna Código.",
  ]);
  ws.addRow([]);
  const linhaCabecalho = ws.addRow(cabecalho);

  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(3).font = { italic: true, size: 10 };
  linhaCabecalho.font = { bold: true };
  linhaCabecalho.alignment = { horizontal: "center", wrapText: true };

  for (const a of args.alvos) {
    ws.addRow([a.motorista, a.cpf ?? "", a.obra, a.placa, "", ...colunasDeDia.map(() => ""), a.alocacaoId]);
  }

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 24;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 14;
  for (let i = 0; i < colunasDeDia.length; i++) ws.getColumn(6 + i).width = 6;
  // O código é feio e ninguém precisa ver — mas tem que VIAJAR no arquivo, ou
  // a volta perde o vínculo exato e sobra casar por nome.
  const colCodigo = ws.getColumn(6 + colunasDeDia.length);
  colCodigo.width = 38;
  colCodigo.hidden = true;

  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];

  // exceljs devolve o Buffer DELE (um alias de ArrayBuffer); o Node quer o
  // dele. Passa por unknown porque os dois tipos não se sobrepõem no papel.
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

function br(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
