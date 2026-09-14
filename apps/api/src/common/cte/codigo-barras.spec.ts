import { describe, expect, it } from "vitest";
import { barrasCode128C, simbolosCode128C } from "./codigo-barras";

/**
 * Um código de barras errado imprime bonito. O defeito só aparece na barreira
 * fiscal, com o caminhão parado e ninguém por perto pra depurar — por isso a
 * conferência aqui é aritmética, contra valores calculados na mão, e não
 * "roda e vê se sai alguma coisa".
 */

describe("Code 128C", () => {
  it("a soma de verificação bate com a conta feita à mão", () => {
    // "1234" → início C (105), 12, 34.
    // Verificação = (105 + 12×1 + 34×2) % 103 = 185 % 103 = 82.
    expect(simbolosCode128C("1234")).toEqual([105, 12, 34, 82, 106]);
  });

  it("a posição pesa: os mesmos dígitos trocados de lugar dão outro código", () => {
    // É exatamente o que a verificação existe pra pegar. Sem o peso por
    // posição, "1234" e "3412" teriam a mesma soma e um leitor aceitaria os
    // dois como se fossem a mesma chave.
    expect(simbolosCode128C("1234").at(-2)).not.toBe(simbolosCode128C("3412").at(-2));
  });

  it("uma chave de 44 dígitos vira 22 símbolos de dados", () => {
    const chave = "43260963620308000150579990000000031263366246";
    const s = simbolosCode128C(chave);
    // início + 22 pares + verificação + parada
    expect(s).toHaveLength(25);
    expect(s[0]).toBe(105);
    expect(s.at(-1)).toBe(106);
    expect(s[1]).toBe(43); // o primeiro par é o código da UF
  });

  it("recusa o que não dá pra codificar em vez de imprimir errado", () => {
    // Quantidade ímpar não existe em 128C. Falhar aqui é melhor do que
    // completar com zero e emitir um documento com a chave trocada.
    expect(() => simbolosCode128C("123")).toThrow(/par/);
    expect(() => simbolosCode128C("12A4")).toThrow(/dígitos/);
  });

  it("o desenho fecha na largura que o padrão manda", () => {
    const chave = "43260963620308000150579990000000031263366246";
    const { barras, modulos } = barrasCode128C(chave);
    // 24 símbolos de 11 módulos + a parada, que tem 13.
    expect(modulos).toBe(24 * 11 + 13);
    // Toda barra cabe dentro do total, e nenhuma tem largura zero.
    expect(barras.every((b) => b.largura >= 1 && b.x + b.largura <= modulos)).toBe(true);
    // Começa em barra, colada na borda.
    expect(barras[0]!.x).toBe(0);
  });
});
