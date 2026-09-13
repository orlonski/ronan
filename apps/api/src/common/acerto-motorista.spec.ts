import { describe, expect, it } from "vitest";
import {
  calcularAcerto,
  ehDebito,
  pedagioDaViagem,
  remuneracaoDaViagem,
  resolverRemuneracao,
  totalizarAcerto,
  type RegraRemuneracao,
  type ViagemParaAcerto,
} from "./acerto-motorista";

function regra(over: Partial<RegraRemuneracao> = {}): RegraRemuneracao {
  return {
    tipo: "VALOR_POR_VIAGEM",
    percentualFrete: null,
    valorPorViagem: 100,
    valorPorTonelada: null,
    valorPorKm: null,
    valorDiaria: null,
    reembolsaPedagio: true,
    reembolsaAbastecimento: true,
    ...over,
  };
}

function viagem(over: Partial<ViagemParaAcerto> = {}): ViagemParaAcerto {
  return {
    id: "v1",
    data: new Date("2026-06-10"),
    ticket: "12345",
    km: 50,
    toneladas: 30,
    valorPedagioTotal: 0,
    ehDiaria: false,
    valorFrete: 600,
    clienteNome: "Obra Norte",
    pedagios: [],
    ...over,
  };
}

describe("resolverRemuneracao", () => {
  it("usa a modalidade quando o motorista não tem régua própria", () => {
    const r = resolverRemuneracao(null, {
      tipoRemuneracao: "VALOR_POR_VIAGEM",
      valorPorViagem: 80,
    });
    expect(r.tipo).toBe("VALOR_POR_VIAGEM");
    expect(Number(r.valorPorViagem)).toBe(80);
  });

  it("a régua do motorista vence a da modalidade", () => {
    const r = resolverRemuneracao(
      { tipoRemuneracao: "PERCENTUAL_FRETE", percentualFrete: 12 },
      { tipoRemuneracao: "VALOR_POR_VIAGEM", valorPorViagem: 80 },
    );
    expect(r.tipo).toBe("PERCENTUAL_FRETE");
    expect(Number(r.percentualFrete)).toBe(12);
    // Não herda metade da outra régua: o valorPorViagem da modalidade não vaza.
    expect(r.valorPorViagem).toBeNull();
  });

  it("a diária cai pra modalidade mesmo com régua própria no motorista", () => {
    // Diária é independente do tipo: agregado por percentual também faz diária.
    const r = resolverRemuneracao(
      { tipoRemuneracao: "PERCENTUAL_FRETE", percentualFrete: 12 },
      { tipoRemuneracao: "VALOR_POR_VIAGEM", valorDiaria: 450 },
    );
    expect(Number(r.valorDiaria)).toBe(450);
  });

  it("reembolso é política da empresa, vem só da modalidade", () => {
    const r = resolverRemuneracao(
      { tipoRemuneracao: "PERCENTUAL_FRETE", percentualFrete: 12 },
      { tipoRemuneracao: "VALOR_POR_VIAGEM", reembolsaPedagio: false },
    );
    expect(r.reembolsaPedagio).toBe(false);
    expect(r.reembolsaAbastecimento).toBe(true);
  });

  it("sem modalidade nenhuma, não paga nada mas reembolsa", () => {
    const r = resolverRemuneracao(null, null);
    expect(r.tipo).toBe("SEM_REMUNERACAO");
    expect(r.reembolsaPedagio).toBe(true);
  });
});

describe("pedagioDaViagem — a armadilha do pagamento em dobro", () => {
  it("usa o campo da viagem quando ele existe (app nativo)", () => {
    const r = pedagioDaViagem(viagem({ valorPedagioTotal: 40, pedagios: [] }));
    expect(Number(r.valor)).toBe(40);
  });

  it("soma os avulsos quando a viagem não tem o total (PWA)", () => {
    const r = pedagioDaViagem(
      viagem({ valorPedagioTotal: 0, pedagios: [{ id: "p1", valor: 25 }, { id: "p2", valor: 15 }] }),
    );
    expect(Number(r.valor)).toBe(40);
    expect(r.pedagioIds).toEqual(["p1", "p2"]);
  });

  it("NUNCA soma as duas fontes", () => {
    // As duas preenchidas é o cenário que pagaria 80 em vez de 40. Vale a da
    // viagem, e os avulsos são ignorados.
    const r = pedagioDaViagem(
      viagem({ valorPedagioTotal: 40, pedagios: [{ id: "p1", valor: 40 }] }),
    );
    expect(Number(r.valor)).toBe(40);
    expect(r.pedagioIds).toEqual([]);
  });
});

describe("remuneracaoDaViagem", () => {
  it("valor fixo por viagem", () => {
    const r = remuneracaoDaViagem(viagem(), regra({ valorPorViagem: 120 }));
    expect(Number((r as { valor: unknown }).valor)).toBe(120);
  });

  it("por tonelada multiplica o peso", () => {
    const r = remuneracaoDaViagem(
      viagem({ toneladas: 30 }),
      regra({ tipo: "VALOR_POR_TONELADA", valorPorTonelada: 8 }),
    );
    expect(Number((r as { valor: unknown }).valor)).toBe(240);
  });

  it("por km multiplica a distância", () => {
    const r = remuneracaoDaViagem(
      viagem({ km: 50 }),
      regra({ tipo: "VALOR_POR_KM", valorPorKm: 3.5 }),
    );
    expect(Number((r as { valor: unknown }).valor)).toBe(175);
  });

  it("percentual sai do valor faturado da viagem", () => {
    const r = remuneracaoDaViagem(
      viagem({ valorFrete: 600 }),
      regra({ tipo: "PERCENTUAL_FRETE", percentualFrete: 12 }),
    );
    expect(Number((r as { valor: unknown }).valor)).toBe(72);
  });

  it("percentual sem preço na viagem explica que falta a tabela", () => {
    // Gerar R$ 0,00 aqui seria pior: no extrato pareceria "essa viagem não
    // valeu nada" em vez de "falta cadastrar o preço".
    const r = remuneracaoDaViagem(
      viagem({ valorFrete: null }),
      regra({ tipo: "PERCENTUAL_FRETE", percentualFrete: 12 }),
    );
    expect((r as { motivo: string }).motivo).toContain("preço");
  });

  it("diária usa a régua de diária e ignora o tipo", () => {
    // Caminhão à disposição: 0t e 0km. Por tonelada daria zero num dia inteiro.
    const r = remuneracaoDaViagem(
      viagem({ ehDiaria: true, toneladas: 0, km: 0 }),
      regra({ tipo: "VALOR_POR_TONELADA", valorPorTonelada: 8, valorDiaria: 450 }),
    );
    expect(Number((r as { valor: unknown }).valor)).toBe(450);
  });

  it("diária sem valor configurado não vira zero, vira aviso", () => {
    const r = remuneracaoDaViagem(viagem({ ehDiaria: true }), regra({ valorDiaria: null }));
    expect((r as { motivo: string }).motivo).toContain("diária");
  });

  it("SEM_REMUNERACAO não gera linha de frete", () => {
    const r = remuneracaoDaViagem(viagem(), regra({ tipo: "SEM_REMUNERACAO" }));
    expect((r as { motivo: string }).motivo).toContain("não é pago");
  });
});

describe("calcularAcerto", () => {
  it("soma frete, pedágio e diesel do período", () => {
    const r = calcularAcerto({
      viagens: [viagem({ id: "v1", valorPedagioTotal: 40 }), viagem({ id: "v2" })],
      abastecimentos: [
        { id: "a1", data: new Date("2026-06-11"), valorTotal: 900, postoNome: "Shell", emComboio: false },
      ],
      pedagiosAvulsos: [],
      regra: regra({ valorPorViagem: 100 }),
    });
    // 100 + 100 (fretes) + 40 (pedágio) + 900 (diesel)
    expect(r.creditos).toBe("1140.00");
    expect(r.itens).toHaveLength(4);
  });

  it("comboio não vira reembolso — o diesel é da empresa", () => {
    const r = calcularAcerto({
      viagens: [],
      abastecimentos: [
        { id: "a1", data: new Date("2026-06-11"), valorTotal: 900, postoNome: null, emComboio: true },
      ],
      pedagiosAvulsos: [],
      regra: regra(),
    });
    expect(r.itens).toHaveLength(0);
    expect(r.creditos).toBe("0.00");
  });

  it("respeita a empresa que não reembolsa", () => {
    const r = calcularAcerto({
      viagens: [viagem({ valorPedagioTotal: 40 })],
      abastecimentos: [
        { id: "a1", data: new Date("2026-06-11"), valorTotal: 900, postoNome: null, emComboio: false },
      ],
      pedagiosAvulsos: [],
      regra: regra({ reembolsaPedagio: false, reembolsaAbastecimento: false }),
    });
    expect(r.itens).toHaveLength(1); // só o frete
    expect(r.creditos).toBe("100.00");
  });

  it("pedágio avulso (sem viagem) entra no extrato", () => {
    const r = calcularAcerto({
      viagens: [],
      abastecimentos: [],
      pedagiosAvulsos: [{ id: "p9", data: new Date("2026-06-12"), valor: 33.5, praca: "Régis" }],
      regra: regra(),
    });
    expect(r.creditos).toBe("33.50");
    expect(r.itens[0]!.descricao).toContain("Régis");
  });

  it("viagem sem régua vira aviso, não linha de zero", () => {
    const r = calcularAcerto({
      viagens: [viagem()],
      abastecimentos: [],
      pedagiosAvulsos: [],
      regra: regra({ tipo: "SEM_REMUNERACAO" }),
    });
    expect(r.itens).toHaveLength(0);
    expect(r.semRemuneracao).toHaveLength(1);
    expect(r.semRemuneracao[0]!.viagemId).toBe("v1");
  });

  it("viagem sem régua ainda reembolsa o que ele adiantou", () => {
    // Motorista CLT não é pago por viagem, mas o pedágio que ele pagou do bolso
    // continua sendo dele.
    const r = calcularAcerto({
      viagens: [viagem({ valorPedagioTotal: 40 })],
      abastecimentos: [],
      pedagiosAvulsos: [],
      regra: regra({ tipo: "SEM_REMUNERACAO" }),
    });
    expect(r.creditos).toBe("40.00");
    expect(r.itens[0]!.tipo).toBe("REEMBOLSO_PEDAGIO");
  });
});

describe("totalizarAcerto", () => {
  it("separa crédito de débito pelo sinal", () => {
    const t = totalizarAcerto([{ valor: 1000 }, { valor: 240 }, { valor: -300 }, { valor: -50 }]);
    expect(t.creditos).toBe("1240.00");
    expect(t.debitos).toBe("350.00");
    expect(t.liquido).toBe("890.00");
  });

  it("líquido pode ser negativo — ele adiantou mais do que rodou", () => {
    const t = totalizarAcerto([{ valor: 100 }, { valor: -500 }]);
    expect(t.liquido).toBe("-400.00");
  });

  it("extrato vazio é zero, não erro", () => {
    expect(totalizarAcerto([]).liquido).toBe("0.00");
  });
});

describe("ehDebito", () => {
  it("reconhece os tipos que descontam", () => {
    expect(ehDebito("ADIANTAMENTO")).toBe(true);
    expect(ehDebito("DESCONTO_AVARIA")).toBe(true);
    expect(ehDebito("FRETE")).toBe(false);
    expect(ehDebito("BONUS")).toBe(false);
  });
});
