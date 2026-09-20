import { describe, expect, it } from "vitest";
import { lerData, lerFuncionariosDaPlanilha, montarModeloFuncionarios } from "./funcionarios-planilha";

const aba = (linhas: (string | number | null)[][]) => [{ nome: "Funcionários", linhas }];
const CAB = ["Nome", "CPF", "Cargo", "Matrícula", "Admitido em", "Jornada"];

describe("lê a planilha de funcionários", () => {
  it("aceita o modelo preenchido", () => {
    const r = lerFuncionariosDaPlanilha(
      aba([["Quem bate ponto"], [], CAB, ["João da Silva", "123.456.789-09", "Motorista", "1042", "01/09/2026", "Comercial"]]),
    );
    expect(r.validas).toEqual([
      {
        linha: 4,
        nome: "João da Silva",
        cpf: "12345678909",
        cargo: "Motorista",
        matricula: "1042",
        admitidoEm: "2026-09-01",
        jornada: "Comercial",
      },
    ]);
  });

  it("linha ruim vai pra lista de invalidas COM o motivo, nunca pro lixo", () => {
    const r = lerFuncionariosDaPlanilha(aba([CAB, ["Zé", "123", "", "", "", ""]]));
    expect(r.validas).toEqual([]);
    expect(r.invalidas).toHaveLength(1);
    expect(r.invalidas[0]!.motivo).toMatch(/Nome incompleto/);
  });

  it("CPF inválido é apontado, não descartado", () => {
    const r = lerFuncionariosDaPlanilha(aba([CAB, ["Maria Souza", "123", "", "", "", ""]]));
    expect(r.invalidas[0]!.motivo).toMatch(/CPF/);
  });

  it("CPF repetido na planilha não cria dois cadastros", () => {
    const r = lerFuncionariosDaPlanilha(
      aba([CAB, ["Maria Souza", "11122233344"], ["Maria S. Souza", "111.222.333-44"]]),
    );
    expect(r.validas).toHaveLength(1);
    expect(r.invalidas[0]!.motivo).toMatch(/repetido/);
  });

  it("rodapé sem nome e sem CPF não vira alarme falso", () => {
    const r = lerFuncionariosDaPlanilha(
      aba([CAB, ["Maria Souza", "11122233344"], ["↑ a linha acima é exemplo"]]),
    );
    expect(r.invalidas).toEqual([]);
    expect(r.validas).toHaveLength(1);
  });

  it("a coluna pode estar com outro nome", () => {
    const r = lerFuncionariosDaPlanilha(
      aba([["Funcionario", "CPF", "Função", "Admissão"], ["Ana Lima", "11122233344", "Oficina", "05/03/2026"]]),
    );
    expect(r.validas[0]!.cargo).toBe("Oficina");
    expect(r.validas[0]!.admitidoEm).toBe("2026-03-05");
  });
});

describe("data", () => {
  it("aceita BR e ISO, recusa o resto", () => {
    expect(lerData("31/12/2026")).toBe("2026-12-31");
    expect(lerData("2026-12-31T00:00:00.000Z")).toBe("2026-12-31");
    expect(lerData("dezembro")).toBeUndefined();
    expect(lerData("")).toBeUndefined();
  });
});

describe("ida e volta", () => {
  it("o modelo que a gente manda é o que a gente lê", async () => {
    // Renomear uma coluna no gerador sem mexer no leitor quebra o importador
    // em produção sem quebrar teste nenhum — a não ser este.
    const { parseXlsx } = await import("../fechamentos/parsers/xlsx-parser");
    const buffer = await montarModeloFuncionarios(["Comercial 5x2"]);
    const { abas } = await parseXlsx(buffer, "modelo.xlsx");
    const r = lerFuncionariosDaPlanilha(abas);
    // A linha de exemplo do próprio modelo é lida como válida.
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.jornada).toBe("Comercial 5x2");
    expect(r.validas[0]!.admitidoEm).toBe("2026-09-01");
    expect(r.invalidas).toEqual([]);
    expect(r.validas[0]!.cargo).toBe("Motorista");
  });
});
