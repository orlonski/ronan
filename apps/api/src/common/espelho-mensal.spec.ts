import { describe, expect, it } from "vitest";
import { competenciaDe, montarEspelho, type EntradaEspelho } from "./espelho-mensal";

const SEG_A_SAB = [1, 2, 3, 4, 5, 6];
const SEG_A_SEX = [1, 2, 3, 4, 5];

describe("competência", () => {
  it("o corte 20 apura de 21 do mês passado a 20 deste", () => {
    // É o período que o contratante está medindo quando manda o papel no dia
    // 20. Errar isso desloca o mês inteiro e a divergência vira ruído.
    expect(competenciaDe("2026-09", 20)).toEqual({
      rotulo: "2026-09",
      de: "2026-08-21",
      ate: "2026-09-20",
    });
  });

  it("corte 31 em mês de 30 dias cai no último dia, não vaza pro mês seguinte", () => {
    const c = competenciaDe("2026-09", 31);
    expect(c.ate).toBe("2026-09-30");
    expect(c.de).toBe("2026-09-01");
  });

  it("competências vizinhas se encostam sem buraco e sem sobreposição", () => {
    // O dia seguinte ao fim de um mês tem que ser o começo do próximo. Buraco
    // = dia que ninguém fatura; sobreposição = dia faturado duas vezes.
    for (const corte of [5, 20, 28, 30, 31]) {
      const set = competenciaDe("2026-09", corte);
      const out = competenciaDe("2026-10", corte);
      const diaSeguinte = new Date(Date.parse(`${set.ate}T00:00:00.000Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(out.de, `corte ${corte}`).toBe(diaSeguinte);
    }
  });

  it("vira o ano sem se perder", () => {
    expect(competenciaDe("2026-01", 20).de).toBe("2025-12-21");
  });

  it("o dia de corte vem de fora — não existe 20 chumbado", () => {
    expect(competenciaDe("2026-09", 5).ate).toBe("2026-09-05");
    expect(competenciaDe("2026-09", 5).de).toBe("2026-08-06");
  });
});

function entrada(over: Partial<EntradaEspelho> = {}): EntradaEspelho {
  return {
    competencia: competenciaDe("2026-09", 20),
    diasEsperadosSemana: SEG_A_SAB,
    inicio: "2026-01-01",
    fim: null,
    registrados: [],
    ...over,
  };
}

describe("espelho", () => {
  it("conta como esperado só o que o calendário do contrato prevê", () => {
    // 21/08 a 20/09, seg a sáb. Domingo não entra: é o combinado, não
    // julgamento sobre ninguém.
    const e = montarEspelho(entrada());
    expect(e.esperados).not.toContain("2026-08-23"); // domingo
    expect(e.esperados).toContain("2026-08-24"); // segunda
  });

  it("não cobra dia antes de a alocação começar", () => {
    const e = montarEspelho(entrada({ inicio: "2026-09-10" }));
    expect(e.esperados[0]).toBe("2026-09-10");
    expect(e.esperados).not.toContain("2026-09-09");
  });

  it("não cobra dia depois de ela terminar", () => {
    const e = montarEspelho(entrada({ inicio: "2026-01-01", fim: "2026-09-05" }));
    expect(e.esperados.at(-1)).toBe("2026-09-05");
  });

  it("dia esperado sem registro vira EM BRANCO, nunca falta", () => {
    // O sistema não sabe se o caminhão não foi ou se o motorista esqueceu de
    // tocar, e não finge que sabe. Quem resolve é gente.
    const e = montarEspelho(
      entrada({
        inicio: "2026-09-14",
        registrados: [{ data: "2026-09-14", origem: "APP" }],
      }),
    );
    expect(e.emBranco).toContain("2026-09-15");
    expect(e.emBranco).not.toContain("2026-09-14");
    expect(Object.keys(e)).not.toContain("faltas");
  });

  it("registro em dia não previsto aparece SEPARADO, nunca sumido nem somado", () => {
    // Escondido, o motorista trabalha de graça. Somado no total, a
    // transportadora cobra um dia que o contrato não previa e descobre na
    // recusa da medição. São dois erros diferentes e os dois custam caro.
    const sabado = "2026-09-19";
    const e = montarEspelho(
      entrada({
        diasEsperadosSemana: SEG_A_SEX,
        registrados: [{ data: sabado, origem: "APP" }],
      }),
    );
    expect(e.foraDoCalendario).toContain(sabado);
    expect(e.registrados).toContain(sabado);
    expect(e.diasNoContrato).toBe(0);
  });

  it("registro fora do período não entra na conta de outro mês", () => {
    const e = montarEspelho(entrada({ registrados: [{ data: "2026-07-15", origem: "APP" }] }));
    expect(e.registrados).toHaveLength(0);
  });

  it("separa o que veio do aparelho do motorista do que o painel lançou", () => {
    // A prova que vale numa discussão com o contratante é a primeira.
    const e = montarEspelho(
      entrada({
        inicio: "2026-09-14",
        registrados: [
          { data: "2026-09-14", origem: "APP" },
          { data: "2026-09-15", origem: "PAINEL" },
        ],
      }),
    );
    expect(e.diasNoContrato).toBe(2);
    expect(e.diasMarcadosPeloMotorista).toBe(1);
  });
});
