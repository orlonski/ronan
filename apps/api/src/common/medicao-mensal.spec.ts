import { describe, expect, it } from "vitest";
import { compararMedicao, resumirDivergencias } from "./medicao-mensal";

/**
 * A comparação é o que vai pra mesa no dia 20. Cada teste aqui é um jeito de
 * a transportadora chegar lá com o número errado — ou de perder dinheiro sem
 * perceber.
 */

describe("planilha em grade (dia a dia)", () => {
  it("aponta O DIA que eles não contaram — é o que se contesta", async () => {
    const [d] = compararMedicao(
      [{ chave: "joao", dias: ["2026-09-01", "2026-09-02", "2026-09-03"] }],
      [{ chave: "joao", dias: ["2026-09-01", "2026-09-03"] }],
    );
    expect(d!.modo).toBe("POR_DIA");
    expect(d!.soNosso).toEqual(["2026-09-02"]);
    expect(d!.diferenca).toBe(1);
    expect(d!.bate).toBe(false);
  });

  it("separa o dia que só eles têm, que é outro problema", async () => {
    // Não é dinheiro a menos, mas ou o motorista não marcou, ou estão pagando
    // um dia que não aconteceu — e isso volta como glosa depois.
    const [d] = compararMedicao(
      [{ chave: "joao", dias: ["2026-09-01"] }],
      [{ chave: "joao", dias: ["2026-09-01", "2026-09-05"] }],
    );
    expect(d!.soDeles).toEqual(["2026-09-05"]);
    expect(d!.soNosso).toEqual([]);
    expect(d!.diferenca).toBe(-1);
  });

  it("quando os dois lados fecham, marca que bate", async () => {
    const [d] = compararMedicao(
      [{ chave: "joao", dias: ["2026-09-01", "2026-09-02"] }],
      [{ chave: "joao", dias: ["2026-09-02", "2026-09-01"] }],
    );
    expect(d!.bate).toBe(true);
    expect(d!.concordam).toHaveLength(2);
  });

  it("dia repetido na planilha deles não infla a contagem", async () => {
    const [d] = compararMedicao(
      [{ chave: "joao", dias: ["2026-09-01"] }],
      [{ chave: "joao", dias: ["2026-09-01", "2026-09-01"] }],
    );
    expect(d!.totalDeles).toBe(1);
    expect(d!.bate).toBe(true);
  });
});

describe("planilha só com o total", () => {
  it("diz que o número não bate, mas NÃO inventa qual dia foi", async () => {
    // Inventar a data seria pior que não ter: a transportadora levaria pra
    // mesa um dia que ninguém consegue sustentar.
    const [d] = compararMedicao(
      [{ chave: "joao", dias: ["2026-09-01", "2026-09-02", "2026-09-03"] }],
      [{ chave: "joao", totalDias: 2 }],
    );
    expect(d!.modo).toBe("SO_TOTAL");
    expect(d!.diferenca).toBe(1);
    expect(d!.soNosso).toEqual([]);
    expect(d!.concordam).toEqual([]);
  });
});

describe("quem aparece só de um lado", () => {
  it("motorista alocado que sumiu da medição — ninguém vai pagar por ele", async () => {
    // É o erro mais caro e o mais fácil de não ver: não tem linha pra comparar,
    // então some da conferência feita no olho.
    const [d] = compararMedicao([{ chave: "joao", dias: ["2026-09-01"] }], []);
    expect(d!.semContraparte).toBe("NOSSO");
    expect(d!.diferenca).toBe(1);
  });

  it("alguém na medição sem alocação nossa", async () => {
    const [d] = compararMedicao([], [{ chave: "maria", dias: ["2026-09-01"] }]);
    expect(d!.semContraparte).toBe("DELES");
    expect(d!.totalNosso).toBe(0);
  });

  it("compara a UNIÃO das chaves, não a interseção", async () => {
    const r = compararMedicao(
      [{ chave: "joao", dias: [] }],
      [{ chave: "maria", dias: [] }],
    );
    expect(r.map((x) => x.chave)).toEqual(["joao", "maria"]);
  });
});

describe("resumo", () => {
  it("soma os dias a menos e a mais separadamente", async () => {
    // Somar os dois num número só esconderia o caso em que uma linha tem 3 a
    // menos e outra 3 a mais: o total daria zero e não haveria nada a fazer.
    const divs = compararMedicao(
      [
        { chave: "joao", dias: ["2026-09-01", "2026-09-02", "2026-09-03"] },
        { chave: "maria", dias: ["2026-09-01"] },
      ],
      [
        { chave: "joao", dias: [] },
        { chave: "maria", dias: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"] },
      ],
    );
    const r = resumirDivergencias(divs);
    expect(r.diasAMenos).toBe(3);
    expect(r.diasAMais).toBe(3);
    expect(r.batem).toBe(0);
  });

  it("não usa a palavra falta em lugar nenhum do resultado", async () => {
    // Uma subtração não sabe de quem é a culpa, e o vocabulário não pode
    // fingir que sabe.
    const divs = compararMedicao(
      [{ chave: "joao", dias: ["2026-09-01"] }],
      [{ chave: "joao", dias: [] }],
    );
    const texto = JSON.stringify({ divs, resumo: resumirDivergencias(divs) });
    expect(texto).not.toMatch(/falta|ausen|atraso|justificativa/i);
  });
});
