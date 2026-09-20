import { describe, expect, it } from "vitest";
import {
  calcularAcerto,
  ehDebito,
  pedagioDaViagem,
  remuneracaoDaViagem,
  resolverRemuneracao,
  totalizarAcerto,
  type DiariaObraParaAcerto,
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

/**
 * O mensal chegando no bolso do motorista. Sem isto, 22 dias na obra davam
 * extrato zerado e o dono pagava por fora, de cabeça — que é o trabalho que o
 * produto existe pra acabar.
 */
describe("diária de obra no acerto", () => {
  const diaObra = (over: Partial<DiariaObraParaAcerto> = {}): DiariaObraParaAcerto => ({
    registroId: "reg-1",
    data: new Date("2026-06-10"),
    obraNome: "Obra Norte",
    valorDiaria: null,
    ...over,
  });

  const base = {
    viagens: [],
    abastecimentos: [],
    pedagiosAvulsos: [],
  };

  it("cada dia registrado vira uma linha, pela régua", () => {
    const r = calcularAcerto({
      ...base,
      diariasObra: [diaObra(), diaObra({ registroId: "reg-2", data: new Date("2026-06-11") })],
      regra: regra({ tipo: "SEM_REMUNERACAO", valorDiaria: 250 }),
    });
    expect(r.itens).toHaveLength(2);
    expect(r.itens[0]!.tipo).toBe("DIARIA");
    expect(r.itens[0]!.registroPresencaId).toBe("reg-1");
    expect(r.creditos).toBe("500.00");
  });

  it("a diária DA ALOCAÇÃO vence a régua — duas obras, dois valores", () => {
    // Terceiro degrau da escada. Sem ele, o mesmo motorista em duas obras no
    // mesmo mês recebe as duas ao mesmo preço, e uma sai errada.
    const r = calcularAcerto({
      ...base,
      diariasObra: [
        diaObra({ valorDiaria: 300 }),
        diaObra({ registroId: "reg-2", data: new Date("2026-06-11") }),
      ],
      regra: regra({ valorDiaria: 250 }),
    });
    expect(r.creditos).toBe("550.00");
  });

  it("paga diária mesmo quando a régua é percentual do frete", () => {
    // A diária é independente do tipo: agregado pago por percentual também
    // fica à disposição de obra.
    const r = calcularAcerto({
      ...base,
      diariasObra: [diaObra()],
      regra: regra({ tipo: "PERCENTUAL_FRETE", percentualFrete: 80, valorDiaria: 250 }),
    });
    expect(r.creditos).toBe("250.00");
  });

  it("NÃO paga em dobro o dia que já tem diária de viagem", () => {
    // As duas medem o mesmo fato — o caminhão ficou o dia à disposição — por
    // caminhos diferentes. Somar é a mesma armadilha do pedágio em dobro.
    const r = calcularAcerto({
      ...base,
      viagens: [viagem({ ehDiaria: true, data: new Date("2026-06-10") })],
      diariasObra: [diaObra({ data: new Date("2026-06-10") })],
      regra: regra({ valorDiaria: 250 }),
    });
    const diarias = r.itens.filter((i) => i.tipo === "DIARIA");
    expect(diarias).toHaveLength(1);
    expect(diarias[0]!.viagemId).toBe("v1");
    expect(r.creditos).toBe("250.00");
  });

  it("mas paga o dia de obra que não tem viagem nenhuma", () => {
    const r = calcularAcerto({
      ...base,
      viagens: [viagem({ ehDiaria: true, data: new Date("2026-06-10") })],
      diariasObra: [diaObra({ data: new Date("2026-06-11") })],
      regra: regra({ valorDiaria: 250 }),
    });
    expect(r.itens.filter((i) => i.tipo === "DIARIA")).toHaveLength(2);
  });

  it("sem valor de diária em lugar nenhum, não inventa linha de zero", () => {
    // Zero no extrato parece "esse dia não valeu nada", que é pior que a
    // ausência — e mandaria o motorista discutir com o número errado.
    const r = calcularAcerto({
      ...base,
      diariasObra: [diaObra()],
      regra: regra({ valorDiaria: null }),
    });
    expect(r.itens).toHaveLength(0);
  });

  it("acerto sem mensal continua igual ao que era", () => {
    const r = calcularAcerto({ ...base, viagens: [viagem()], regra: regra() });
    expect(r.creditos).toBe("100.00");
  });
});

describe("a escada da diária", () => {
  it("o valor do MOTORISTA vale mesmo sem ele ter régua própria", () => {
    // Era o degrau que faltava: diária combinada com ele, mas sem
    // `tipoRemuneracao` próprio, caía pra da modalidade em silêncio.
    const r = resolverRemuneracao(
      { tipoRemuneracao: null, valorDiaria: 300 },
      { tipoRemuneracao: "VALOR_POR_VIAGEM", valorPorViagem: 100, valorDiaria: 250 },
    );
    expect(r.tipo).toBe("VALOR_POR_VIAGEM");
    expect(r.valorDiaria).toBe(300);
  });

  it("sem valor no motorista, cai pra modalidade", () => {
    const r = resolverRemuneracao(
      { tipoRemuneracao: null },
      { tipoRemuneracao: "VALOR_POR_VIAGEM", valorDiaria: 250 },
    );
    expect(r.valorDiaria).toBe(250);
  });

  it("régua própria do motorista continua tudo-ou-nada no resto", () => {
    const r = resolverRemuneracao(
      { tipoRemuneracao: "VALOR_POR_KM", valorPorKm: 3 },
      { tipoRemuneracao: "PERCENTUAL_FRETE", percentualFrete: 80, valorDiaria: 250 },
    );
    expect(r.tipo).toBe("VALOR_POR_KM");
    expect(r.percentualFrete).toBeNull();
    expect(r.valorDiaria).toBe(250);
  });
});
