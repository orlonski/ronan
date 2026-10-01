import { describe, expect, it } from "vitest";
import {
  conciliarCartao,
  lerExtrato,
  numeroBR,
  type AbastecimentoParaConciliar,
  type TransacaoParaConciliar,
} from "./cartao-combustivel";

describe("numeroBR", () => {
  it("lê o jeito brasileiro, o do sistema e o número que o Excel já entrega", () => {
    expect(numeroBR("R$ 1.234,56")).toBe(1234.56);
    expect(numeroBR("1234.56")).toBe(1234.56);
    expect(numeroBR("1.234")).toBe(1234);
    expect(numeroBR(310.5)).toBe(310.5);
    expect(numeroBR("(50,00)")).toBe(-50);
    expect(numeroBR("abc")).toBeNull();
  });
});

describe("lerExtrato", () => {
  // Formato típico: título, linha em branco, cabeçalho, linhas, total.
  const planilha = [
    ["Extrato de transações — Ticket Log", null, null, null, null, null, null],
    [null, null, null, null, null, null, null],
    ["Data/Hora", "Placa", "Condutor", "Estabelecimento", "Produto", "Quantidade", "Valor Total"],
    ["01/09/2026 14:32", "ABC-1D23", "João", "Posto Rota 277", "DIESEL S10", "300,000", "R$ 1.830,00"],
    ["02/09/2026", "xyz9876", null, "Posto BR", "ARLA 32", 20, 72.5],
    ["03/09/2026", "ABC1D23", null, "Posto BR", "DIESEL S10", "100", "-610,00"],
    ["31/02/2026", "ABC1D23", null, null, null, "10", "60"],
    ["TOTAL", null, null, null, null, null, "R$ 1.902,50"],
  ];

  it("acha o cabeçalho, lê as linhas e ignora estorno e total sem acusar erro", () => {
    const r = lerExtrato(planilha);
    expect(r.linhaCabecalho).toBe(2);
    expect(r.faltando).toEqual([]);
    expect(r.transacoes).toHaveLength(2);
    expect(r.transacoes[0]).toMatchObject({
      linha: 4,
      placa: "ABC-1D23",
      motorista: "João",
      posto: "Posto Rota 277",
      litros: 300,
      valor: 1830,
    });
    // 14h32 em Brasília = 17h32 UTC.
    expect(r.transacoes[0]!.data.toISOString()).toBe("2026-09-01T17:32:00.000Z");
    // Sem hora: meio-dia de Brasília.
    expect(r.transacoes[1]!.data.toISOString()).toBe("2026-09-02T15:00:00.000Z");
    expect(r.ignoradas).toBe(2);
    expect(r.erros).toEqual([{ linha: 7, mensagem: 'Data que não deu pra ler: "31/02/2026".' }]);
  });

  it("a mesma linha dá a mesma chave (subir de novo não duplica)", () => {
    const a = lerExtrato(planilha).transacoes[0]!.chave;
    const b = lerExtrato(planilha).transacoes[0]!.chave;
    expect(a).toBe(b);
  });

  it("sem coluna de valor, diz o que falta e não lê nada", () => {
    const r = lerExtrato([["Data", "Placa", "Litros"], ["01/09/2026", "ABC1D23", "100"]]);
    expect(r.faltando).toEqual(["valor"]);
    expect(r.transacoes).toEqual([]);
  });
});

describe("conciliarCartao", () => {
  const t = (over: Partial<TransacaoParaConciliar>): TransacaoParaConciliar => ({
    id: "t1",
    data: new Date("2026-09-01T17:00:00Z"),
    placa: "ABC1D23",
    veiculoId: "v1",
    litros: 300,
    valor: 1830,
    ...over,
  });
  const a = (over: Partial<AbastecimentoParaConciliar>): AbastecimentoParaConciliar => ({
    id: "a1",
    veiculoId: "v1",
    data: new Date("2026-09-01T22:00:00Z"),
    litros: 300,
    valorTotal: 1830,
    emComboio: false,
    ...over,
  });

  it("mesmo caminhão, mesmo dia, mesmos litros: confere", () => {
    const r = conciliarCartao([t({})], [a({})]);
    expect(r.itens[0]).toMatchObject({ situacao: "CONFERE", abastecimentoId: "a1" });
    expect(r.lancadosSemCartao).toEqual([]);
  });

  it("diferença pequena (bomba, centavos) ainda confere", () => {
    const r = conciliarCartao([t({})], [a({ litros: 301.5, valorTotal: 1831 })]);
    expect(r.itens[0]!.situacao).toBe("CONFERE");
  });

  it("litros e valor diferentes: diverge, com os números", () => {
    const r = conciliarCartao([t({})], [a({ litros: 250, valorTotal: 1525 })]);
    expect(r.itens[0]!.situacao).toBe("DIVERGE");
    expect(r.itens[0]!.texto).toBe(
      "Diferente do lançado: no cartão 300,0 L, lançado 250,0 L; no cartão R$ 1.830,00, lançado R$ 1.525,00.",
    );
  });

  it("passou no cartão e ninguém lançou", () => {
    const r = conciliarCartao([t({})], [a({ data: new Date("2026-09-05T15:00:00Z") })]);
    expect(r.itens[0]!.situacao).toBe("SO_NO_CARTAO");
    expect(r.lancadosSemCartao).toEqual(["a1"]);
  });

  it("dia vizinho ainda casa (lançou depois da meia-noite)", () => {
    const r = conciliarCartao([t({})], [a({ data: new Date("2026-09-02T03:30:00Z") })]);
    expect(r.itens[0]!.situacao).toBe("CONFERE");
  });

  it("dois no mesmo dia: cada passada casa com o lançamento mais parecido", () => {
    const r = conciliarCartao(
      [t({ id: "t1", litros: 300, valor: 1830 }), t({ id: "t2", litros: 80, valor: 488 })],
      [a({ id: "a1", litros: 80, valorTotal: 488 }), a({ id: "a2", litros: 300, valorTotal: 1830 })],
    );
    expect(r.itens.map((i) => [i.transacaoId, i.abastecimentoId, i.situacao])).toEqual([
      ["t1", "a2", "CONFERE"],
      ["t2", "a1", "CONFERE"],
    ]);
  });

  it("placa fora do cadastro e comboio não casam", () => {
    const r = conciliarCartao(
      [t({ id: "t1", veiculoId: null, placa: "ZZZ0000" }), t({ id: "t2" })],
      [a({ emComboio: true })],
    );
    expect(r.itens[0]!.situacao).toBe("PLACA_DESCONHECIDA");
    expect(r.itens[1]!.situacao).toBe("SO_NO_CARTAO");
    expect(r.lancadosSemCartao).toEqual([]);
  });
});
