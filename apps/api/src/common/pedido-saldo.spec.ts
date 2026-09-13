import { describe, expect, it } from "vitest";
import { calcularSaldoPedido, casarPlanejada, type PlanejadaParaCasar } from "./pedido-saldo";

const HOJE = new Date("2026-06-10T12:00:00Z");

function viagens(n: number, ton = 30) {
  return Array.from({ length: n }, () => ({ toneladas: ton }));
}

describe("calcularSaldoPedido — por viagens", () => {
  it("conta viagens e calcula o percentual", () => {
    const s = calcularSaldoPedido({
      quantidadeAlvo: 20,
      unidadeAlvo: "VIAGENS",
      viagens: viagens(8),
      hoje: HOJE,
    });
    expect(s.entregue).toBe("8");
    expect(s.restante).toBe("12");
    expect(s.percentual).toBe(40);
  });

  it("entregar mais que o pedido é CUMPRIDO, não saldo negativo", () => {
    // "faltam −2" é a frase que ninguém entende.
    const s = calcularSaldoPedido({
      quantidadeAlvo: 20,
      unidadeAlvo: "VIAGENS",
      viagens: viagens(22),
      hoje: HOJE,
    });
    expect(s.restante).toBe("0");
    expect(s.percentual).toBe(100);
    expect(s.situacao).toBe("CUMPRIDO");
  });

  it("calcula o ritmo necessário pro prazo", () => {
    // Faltam 12 viagens, prazo daqui a 3 dias (10, 11, 12) = 4 por dia.
    const s = calcularSaldoPedido({
      quantidadeAlvo: 20,
      unidadeAlvo: "VIAGENS",
      viagens: viagens(8),
      prazoEm: new Date("2026-06-12"),
      hoje: HOJE,
    });
    expect(s.diasRestantes).toBe(3);
    expect(s.ritmoNecessario).toBe("4.0");
  });

  it("prazo vencido sem cumprir é ESTOURADO", () => {
    const s = calcularSaldoPedido({
      quantidadeAlvo: 20,
      unidadeAlvo: "VIAGENS",
      viagens: viagens(8),
      prazoEm: new Date("2026-06-05"),
      hoje: HOJE,
    });
    expect(s.situacao).toBe("ESTOURADO");
  });

  it("sem prazo não inventa urgência", () => {
    const s = calcularSaldoPedido({
      quantidadeAlvo: 20,
      unidadeAlvo: "VIAGENS",
      viagens: viagens(8),
      hoje: HOJE,
    });
    expect(s.situacao).toBe("SEM_PRAZO");
    expect(s.ritmoNecessario).toBeNull();
  });

  it("pedido sem nada entregue ainda não quebra", () => {
    const s = calcularSaldoPedido({
      quantidadeAlvo: 20,
      unidadeAlvo: "VIAGENS",
      viagens: [],
      prazoEm: new Date("2026-06-20"),
      hoje: HOJE,
    });
    expect(s.entregue).toBe("0");
    expect(s.percentual).toBe(0);
    expect(s.viagens).toBe(0);
  });
});

describe("calcularSaldoPedido — por toneladas", () => {
  it("soma o peso das viagens", () => {
    const s = calcularSaldoPedido({
      quantidadeAlvo: 500,
      unidadeAlvo: "TONELADAS",
      viagens: [{ toneladas: 30 }, { toneladas: 27.5 }, { toneladas: 31.2 }],
      hoje: HOJE,
    });
    expect(s.entregue).toBe("88.700");
    expect(s.restante).toBe("411.300");
  });

  it("conta as viagens mesmo medindo por tonelada", () => {
    const s = calcularSaldoPedido({
      quantidadeAlvo: 500,
      unidadeAlvo: "TONELADAS",
      viagens: viagens(3),
      hoje: HOJE,
    });
    expect(s.viagens).toBe(3);
  });
});

describe("casarPlanejada", () => {
  function plan(over: Partial<PlanejadaParaCasar> = {}): PlanejadaParaCasar {
    return {
      id: "p1",
      motoristaId: "m1",
      dataPrevista: new Date("2026-06-10"),
      materialId: null,
      localCargaId: null,
      localDescargaId: null,
      ...over,
    };
  }
  const viagem = {
    motoristaId: "m1",
    data: new Date("2026-06-10"),
    materialId: "brita",
    localCargaId: "pedreira",
    localDescargaId: "obra-norte",
  };

  it("não casa viagem de outro motorista", () => {
    expect(casarPlanejada([plan({ motoristaId: "m2" })], viagem)).toBeNull();
  });

  it("não casa viagem de outro dia", () => {
    expect(casarPlanejada([plan({ dataPrevista: new Date("2026-06-11") })], viagem)).toBeNull();
  });

  it("com uma candidata só, casa direto", () => {
    expect(casarPlanejada([plan()], viagem)?.id).toBe("p1");
  });

  it("entre duas, vence a que combina o destino", () => {
    // O destino pesa mais que o material: é ele que diz qual pedido é.
    const c = [
      plan({ id: "generica" }),
      plan({ id: "certa", localDescargaId: "obra-norte" }),
    ];
    expect(casarPlanejada(c, viagem)?.id).toBe("certa");
  });

  it("soma afinidade de material e locais", () => {
    const c = [
      plan({ id: "so-material", materialId: "brita" }),
      plan({ id: "completa", materialId: "brita", localCargaId: "pedreira", localDescargaId: "obra-norte" }),
    ];
    expect(casarPlanejada(c, viagem)?.id).toBe("completa");
  });

  it("plano sem detalhe não é penalizado contra plano que diverge", () => {
    // Campo em branco no plano significa "o supervisor não detalhou", não
    // "é outro destino". Uma planejada que aponta pra obra ERRADA não pode
    // ganhar da que simplesmente não disse.
    const c = [
      plan({ id: "vaga", materialId: null, localDescargaId: null }),
      plan({ id: "outra-obra", materialId: "areia", localDescargaId: "obra-sul" }),
    ];
    expect(casarPlanejada(c, viagem)?.id).toBe("vaga");
  });

  it("lista vazia não casa nada", () => {
    expect(casarPlanejada([], viagem)).toBeNull();
  });
});
