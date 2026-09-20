import { describe, expect, it } from "vitest";
import { lerMedicaoDaPlanilha, type AlvoMedicao } from "./medicao-planilha";

/**
 * A leitura da planilha do contratante. Cada teste aqui é um jeito de a
 * transportadora lançar a medição errada — e o pior deles, de longe, é a
 * linha que some sem ninguém ver.
 */

const DIAS = ["2026-08-21", "2026-08-22", "2026-08-23", "2026-09-20"];

const ALVOS: AlvoMedicao[] = [
  { alocacaoId: "a1", motorista: "João da Silva", cpf: "111.222.333-44", obra: "Obra Norte", placa: "ABC1D23" },
  { alocacaoId: "a2", motorista: "Maria Souza", cpf: "555.666.777-88", obra: "Obra Sul", placa: "XYZ4E56" },
];

function aba(linhas: (string | number | null)[][]) {
  return [{ nome: "Medição", linhas }];
}

const CABECALHO = ["Motorista", "CPF", "Obra", "Placa", "Total de dias", "21/08", "22/08", "23/08", "20/09", "Código"];

describe("lê o modelo preenchido", () => {
  it("pega o total de dias e casa pelo código", () => {
    const r = lerMedicaoDaPlanilha(
      aba([
        ["Medição — Contratante"],
        [],
        CABECALHO,
        ["João da Silva", "111.222.333-44", "Obra Norte", "ABC1D23", 18, "", "", "", "", "a1"],
      ]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas).toEqual([{ alocacaoId: "a1", totalDias: 18, casouPor: "codigo" }]);
  });

  it("a grade vence o total: é com o dia na mão que se contesta", () => {
    const r = lerMedicaoDaPlanilha(
      aba([
        CABECALHO,
        ["João da Silva", "", "", "", 99, "X", "x", "", "1", "a1"],
      ]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas[0]).toEqual({
      alocacaoId: "a1",
      dias: ["2026-08-21", "2026-08-22", "2026-09-20"],
      casouPor: "codigo",
    });
  });

  it("zero e traço não são marca de dia", () => {
    const r = lerMedicaoDaPlanilha(
      aba([CABECALHO, ["João", "", "", "", 1, "X", 0, "-", "", "a1"]]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas[0]!.dias).toEqual(["2026-08-21"]);
  });
});

describe("quando o contratante mexe na planilha", () => {
  it("casa pela placa quando apagaram o código", () => {
    const r = lerMedicaoDaPlanilha(
      aba([CABECALHO.slice(0, 9), ["Outro Nome", "", "", "abc-1d23", 12, "", "", "", ""]]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas[0]).toEqual({ alocacaoId: "a1", totalDias: 12, casouPor: "placa" });
  });

  it("casa pelo CPF mesmo com pontuação diferente", () => {
    const r = lerMedicaoDaPlanilha(
      aba([["Motorista", "CPF", "Total de dias"], ["", "11122233344", 9]]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas[0]).toEqual({ alocacaoId: "a1", totalDias: 9, casouPor: "cpf" });
  });

  it("casa pelo nome sem acento e sem caixa", () => {
    const r = lerMedicaoDaPlanilha(
      aba([["Motorista", "Total de dias"], ["  JOAO DA SILVA ", 7]]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas[0]).toEqual({ alocacaoId: "a1", totalDias: 7, casouPor: "nome" });
  });
});

describe("nada some em silêncio", () => {
  it("linha que não achou dono vai pra tela, não pro lixo", () => {
    // Descartar seria pior que digitar na mão: o número fecha e falta gente
    // na conta, e ninguém procura o que não sabe que existe.
    const r = lerMedicaoDaPlanilha(
      aba([CABECALHO, ["Fulano Terceirizado", "", "", "ZZZ9Z99", 15, "", "", "", "", ""]]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas).toEqual([]);
    expect(r.semDono).toEqual([
      { descricao: "Fulano Terceirizado · ZZZ9Z99", totalDias: 15 },
    ]);
  });

  it("quem está alocado e não veio na planilha é apontado", () => {
    // O erro mais caro do mês: ninguém vai pagar por ele, e não existe linha
    // pra comparar, então passa batido na conferência feita no olho.
    const r = lerMedicaoDaPlanilha(
      aba([CABECALHO, ["João da Silva", "", "", "", 18, "", "", "", "", "a1"]]),
      ALVOS,
      DIAS,
    );
    expect(r.semLinha).toEqual([{ alocacaoId: "a2", motorista: "Maria Souza", obra: "Obra Sul" }]);
  });

  it("rodapé sem número nenhum não vira alarme falso", () => {
    const r = lerMedicaoDaPlanilha(
      aba([CABECALHO, ["João da Silva", "", "", "", 18, "", "", "", "", "a1"], ["TOTAL"], ["Assinatura:"]]),
      ALVOS,
      DIAS,
    );
    expect(r.semDono).toEqual([]);
  });

  it("a mesma pessoa duas vezes não soma diária inventada", () => {
    const r = lerMedicaoDaPlanilha(
      aba([
        CABECALHO,
        ["João", "", "", "", 18, "", "", "", "", "a1"],
        ["João", "", "", "", 4, "", "", "", "", "a1"],
      ]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.totalDias).toBe(18);
  });
});

describe("dias fora do período", () => {
  it("coluna de dia que não é do período é ignorada", () => {
    // Competência com corte 20 atravessa dois meses; uma coluna "15/07" não
    // pertence a este período e contá-la inventaria diária.
    const r = lerMedicaoDaPlanilha(
      aba([["Motorista", "Total de dias", "21/08", "15/07", "Código"], ["João", "", "X", "X", "a1"]]),
      ALVOS,
      DIAS,
    );
    expect(r.linhas[0]!.dias).toEqual(["2026-08-21"]);
  });
});

describe("planilha que não dá pra ler", () => {
  it("sem cabeçalho reconhecível, não inventa linha nenhuma", () => {
    const r = lerMedicaoDaPlanilha(aba([["qualquer", "coisa"], [1, 2]]), ALVOS, DIAS);
    expect(r.linhas).toEqual([]);
    expect(r.semDono).toEqual([]);
    expect(r.semLinha).toHaveLength(2);
  });
});

/**
 * A prova de que as duas metades falam a mesma língua.
 *
 * O modelo e o leitor são arquivos diferentes, e é fácil um mudar sem o
 * outro: renomear "Total de dias", mover a coluna do código, trocar o formato
 * do cabeçalho de dia. Qualquer um desses quebra o importador em produção sem
 * quebrar teste nenhum — a não ser este.
 */
describe("ida e volta: o modelo que a gente manda é o que a gente lê", () => {
  it("gera, preenche e lê de volta sem perder ninguém", async () => {
    const { montarModeloMedicao } = await import("./medicao-modelo");
    const { parseXlsx } = await import("../fechamentos/parsers/xlsx-parser");

    const buffer = await montarModeloMedicao({
      contratante: "Nexo Logística",
      competencia: "2026-09",
      de: DIAS[0]!,
      ate: DIAS[DIAS.length - 1]!,
      dias: DIAS,
      alvos: ALVOS,
    });

    const { abas } = await parseXlsx(buffer, "modelo.xlsx");
    const ws = abas[0]!;
    const iCab = ws.linhas.findIndex((l) => l.some((c) => String(c ?? "") === "Total de dias"));
    expect(iCab).toBeGreaterThan(-1);

    // Preenche como o contratante preencheria: um por total, outro na grade.
    const iTotal = ws.linhas[iCab]!.findIndex((c) => String(c ?? "") === "Total de dias");
    ws.linhas[iCab + 1]![iTotal] = 18;
    const iDia = ws.linhas[iCab]!.findIndex((c) => String(c ?? "") === "22/08");
    ws.linhas[iCab + 2]![iDia] = "X";

    const r = lerMedicaoDaPlanilha(abas, ALVOS, DIAS);
    expect(r.semDono).toEqual([]);
    expect(r.semLinha).toEqual([]);
    expect(r.linhas).toEqual([
      { alocacaoId: "a1", totalDias: 18, casouPor: "codigo" },
      { alocacaoId: "a2", dias: ["2026-08-22"], casouPor: "codigo" },
    ]);
  });
});
