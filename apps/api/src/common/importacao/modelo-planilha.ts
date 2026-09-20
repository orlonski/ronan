import ExcelJS from "exceljs";
import type { EntidadeImportavel } from "./campos";

/**
 * A planilha MODELO de uma entidade importável.
 *
 * ⚠️ Existe porque "o importador aceita vários nomes de coluna" resolve o
 * arquivo que o cliente JÁ tem — e não resolve o caso mais comum, que é o
 * cliente não ter arquivo nenhum e não saber por onde começar. Listar os
 * nomes de coluna numa dica de tela é dizer o que fazer; mandar a planilha
 * pronta é fazer.
 *
 * O cabeçalho usa o rótulo humano, não a chave técnica: o importador casa por
 * sinônimo, e o rótulo é sempre um deles.
 */
export async function montarModeloImportacao(e: EntidadeImportavel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Movatruck";
  const ws = wb.addWorksheet(e.rotulo.slice(0, 30));

  ws.addRow([e.rotulo]);
  ws.addRow([e.descricao]);
  ws.addRow([
    `Obrigatórios: ${e.campos.filter((c) => c.obrigatorio).map((c) => c.rotulo).join(", ") || "nenhum"}.` +
      ` Coluna que você não usa, pode apagar. A ordem não importa.`,
  ]);
  ws.addRow([]);

  const cabecalho = ws.addRow(e.campos.map((c) => c.rotulo));
  cabecalho.font = { bold: true };
  cabecalho.alignment = { horizontal: "center", wrapText: true };
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getRow(3).font = { italic: true, size: 10 };

  // Uma linha de EXEMPLO, marcada como exemplo. Sem ela, quem abre um arquivo
  // só com cabeçalho não sabe o formato de data nem se o CPF vai com ponto.
  ws.addRow(e.campos.map((c) => exemploDoCampo(c.tipo, c.rotulo)));
  ws.addRow([]);
  ws.addRow(["↑ a linha acima é exemplo: apague antes de subir."]);

  e.campos.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(14, Math.min(34, c.rotulo.length + 6));
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];

  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
}

function exemploDoCampo(tipo: string, rotulo: string): string {
  switch (tipo) {
    case "cpf":
      return "123.456.789-09";
    case "cnpjOuCpf":
      return "12.345.678/0001-95";
    case "placa":
      return "ABC1D23";
    case "uf":
      return "PR";
    case "data":
      return "31/12/2026";
    case "numero":
      return "1234.56";
    case "inteiro":
      return "12";
    default:
      return rotulo.toLowerCase().includes("nome") ? "Exemplo Ltda" : "exemplo";
  }
}
