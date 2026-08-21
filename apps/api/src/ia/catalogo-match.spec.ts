import { describe, it, expect } from "vitest";
import { matchPorNomeOuApelido, normalizar } from "./ia.service";

/**
 * Estas funções deixaram de ser rede de segurança e viraram o caminho
 * principal: o catálogo não vai mais com UUID no prompt, então quem liga o nome
 * lido ao cadastro é este match aqui no servidor. Antes disso não havia teste
 * nenhum sobre elas.
 */

const CLIENTES = [
  { id: "c1", nome: "São João", apelidos: ["SJ"] },
  { id: "c2", nome: "Britagem Central", apelidos: [] },
  { id: "c3", nome: "Construtora Alvorada", apelidos: ["Alvorada"] },
];

const MATERIAIS = [
  { id: "m1", nome: "CBUQ", apelidos: ["C.B.U.Q", "Concreto Betuminoso"] },
  { id: "m2", nome: "Brita", apelidos: [] },
  { id: "m3", nome: "Brita Graduada", apelidos: ["BGS"] },
];

describe("normalizar", () => {
  it("tira acento, pontuação e caixa", () => {
    expect(normalizar("C.B.U.Q FAIXA C")).toBe("cbuqfaixac");
    expect(normalizar("São José")).toBe("saojose");
    expect(normalizar("SAO JOSE")).toBe("saojose");
    expect(normalizar("ABC-1234")).toBe("abc1234");
  });
});

describe("matchPorNomeOuApelido", () => {
  it("casa exato depois de normalizar", () => {
    expect(matchPorNomeOuApelido("SÃO JOÃO", CLIENTES)).toBe("c1");
    expect(matchPorNomeOuApelido("são joão", CLIENTES)).toBe("c1");
  });

  it("casa por apelido", () => {
    expect(matchPorNomeOuApelido("SJ", CLIENTES)).toBe("c1");
    expect(matchPorNomeOuApelido("C.B.U.Q", MATERIAIS)).toBe("m1");
  });

  it("ignora sufixo de faixa/tipo — o caso que o prompt já documentava", () => {
    expect(matchPorNomeOuApelido("C.B.U.Q FAIXA C", MATERIAIS)).toBe("m1");
    expect(matchPorNomeOuApelido("CBUQ TIPO 2", MATERIAIS)).toBe("m1");
  });

  it("acha o nome curto do cadastro dentro da razão social por extenso", () => {
    // O caso que só o pass 3 resolve: o nome cadastrado está no MEIO do texto
    // lido, então prefix não pega. É como o cliente aparece no ticket de verdade.
    expect(matchPorNomeOuApelido("PEDREIRA SÃO JOÃO LTDA - ME", CLIENTES)).toBe("c1");
    expect(matchPorNomeOuApelido("CONSTRUTORA ALVORADA S/A", CLIENTES)).toBe("c3");
  });

  it("entre dois candidatos que servem, fica com o mais específico", () => {
    // "Brita" e "Brita Graduada" ambos aparecem em "BRITA GRADUADA SIMPLES".
    // Ficar com o curto jogaria a viagem no material errado — e material errado
    // muda o preço.
    expect(matchPorNomeOuApelido("BRITA GRADUADA SIMPLES", MATERIAIS)).toBe("m3");
  });

  it("não inventa correspondência pra nome que não existe", () => {
    expect(matchPorNomeOuApelido("Transportadora Beta", CLIENTES)).toBeUndefined();
    expect(matchPorNomeOuApelido("Areia Fina", MATERIAIS)).toBeUndefined();
  });

  it("texto curto demais não dispara substring solta", () => {
    // Sem a guarda de tamanho, "bri" casaria com "Britagem Central" e com
    // "Brita" — e escolher qualquer um dos dois seria chute.
    expect(matchPorNomeOuApelido("bri", MATERIAIS)).toBeUndefined();
    expect(matchPorNomeOuApelido("ab", CLIENTES)).toBeUndefined();
  });

  it("entrada vazia ou só pontuação não casa com nada", () => {
    expect(matchPorNomeOuApelido("", CLIENTES)).toBeUndefined();
    expect(matchPorNomeOuApelido("---", CLIENTES)).toBeUndefined();
  });

  it("placa normaliza hífen e espaço", () => {
    const placas = [
      { id: "v1", nome: "ABC1234" },
      { id: "v2", nome: "XYZ9876" },
    ];
    expect(matchPorNomeOuApelido("ABC-1234", placas)).toBe("v1");
    expect(matchPorNomeOuApelido("abc 1234", placas)).toBe("v1");
    expect(matchPorNomeOuApelido("QQQ0000", placas)).toBeUndefined();
  });
});
