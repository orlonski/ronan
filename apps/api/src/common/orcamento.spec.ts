import { describe, expect, it } from "vitest";
import type { TabelaPrecoRow } from "./viagem-preco";
import {
  deveVencer,
  itensParaPedidos,
  planoTabelaPreco,
  podeAprovar,
  podeEditar,
  podeExcluir,
  statusAposEditar,
  sugerirPrecoItem,
  totalOrcamento,
  valorItem,
  type LinhaTabelaExistente,
} from "./orcamento";

const HOJE = "2026-10-02";

describe("valorItem", () => {
  it("tonelada × preço por tonelada", () => {
    const r = valorItem({ quantidade: 300, unidade: "TONELADAS", base: "TONELADA", precoUnitario: "42.50" });
    expect(r.valor?.toFixed(2)).toBe("12750.00");
  });

  it("m³ com preço por tonelada converte pela densidade", () => {
    const r = valorItem({ quantidade: 100, unidade: "M3", base: "TONELADA", precoUnitario: 10, densidadeTonM3: "1.5" });
    expect(r.valor?.toFixed(2)).toBe("1500.00");
  });

  it("toneladas com preço por m³ divide pela densidade", () => {
    const r = valorItem({ quantidade: 150, unidade: "TONELADAS", base: "M3", precoUnitario: 20, densidadeTonM3: "1.5" });
    expect(r.valor?.toFixed(2)).toBe("2000.00");
  });

  it("sem densidade não converte — e não vira zero", () => {
    const r = valorItem({ quantidade: 100, unidade: "M3", base: "TONELADA", precoUnitario: 10, densidadeTonM3: null });
    expect(r).toEqual({ valor: null, motivo: "SEM_DENSIDADE" });
  });

  it("preço por km multiplica o km da rota por viagem", () => {
    const r = valorItem({ quantidade: 10, unidade: "VIAGENS", base: "KM", precoUnitario: "5.00", kmEstimado: "32.4" });
    expect(r.valor?.toFixed(2)).toBe("1620.00");
  });

  it("preço por km sem rota fica sem valor", () => {
    expect(valorItem({ quantidade: 10, unidade: "VIAGENS", base: "KM", precoUnitario: 5, kmEstimado: null })).toEqual({
      valor: null,
      motivo: "SEM_KM",
    });
  });

  it("toneladas com preço por viagem não tem conta possível", () => {
    expect(valorItem({ quantidade: 10, unidade: "TONELADAS", base: "VIAGEM", precoUnitario: 500 }).valor).toBeNull();
  });
});

describe("totalOrcamento", () => {
  it("soma o que dá e conta o que ficou de fora", () => {
    const r = totalOrcamento([
      { quantidade: 10, unidade: "VIAGENS", base: "VIAGEM", precoUnitario: "850.00" },
      { quantidade: "200.5", unidade: "TONELADAS", base: "TONELADA", precoUnitario: "38.90" },
      { quantidade: 5, unidade: "M3", base: "TONELADA", precoUnitario: 10 },
    ]);
    // 8500 + 7799.45
    expect(r).toEqual({ total: "16299.45", itensSemValor: 1 });
  });

  it("sem itens é zero", () => {
    expect(totalOrcamento([])).toEqual({ total: "0.00", itensSemValor: 0 });
  });
});

const linha = (o: Partial<TabelaPrecoRow>): TabelaPrecoRow => ({
  id: "t1",
  empresaId: "e1",
  materialId: null,
  tipoServicoId: null,
  kmFaixaDe: 0,
  kmFaixaAte: null,
  base: "TONELADA",
  precoUnitario: "40.00",
  repassaPedagio: false,
  vigenciaDe: new Date("2026-01-01T00:00:00Z"),
  vigenciaAte: null,
  ativo: true,
  ...o,
});

describe("sugerirPrecoItem", () => {
  const base = { empresaId: "e1", materialId: "m1", tipoServicoId: null, hoje: HOJE };

  it("prospect não tem sugestão", () => {
    const r = sugerirPrecoItem([linha({})], { ...base, empresaId: null, kmEstimado: 30 });
    expect(r.linha).toBeNull();
  });

  it("acha a faixa de km da rota, material específico vence o genérico", () => {
    const tabelas = [
      linha({ id: "geral" }),
      linha({ id: "curta", materialId: "m1", kmFaixaDe: 0, kmFaixaAte: 50, precoUnitario: "35.00" }),
      linha({ id: "longa", materialId: "m1", kmFaixaDe: 50, kmFaixaAte: null, precoUnitario: "55.00" }),
    ];
    expect(sugerirPrecoItem(tabelas, { ...base, kmEstimado: "72.3" }).linha?.id).toBe("longa");
    expect(sugerirPrecoItem(tabelas, { ...base, kmEstimado: 12 }).linha?.id).toBe("curta");
  });

  it("sem km só sugere linha de qualquer distância — nunca chuta a faixa curta", () => {
    const so = [linha({ id: "curta", materialId: "m1", kmFaixaAte: 50 })];
    const r = sugerirPrecoItem(so, { ...base, kmEstimado: null });
    expect(r.linha).toBeNull();
    expect(r.motivo).toMatch(/faixa de km/);
    expect(sugerirPrecoItem([...so, linha({ id: "geral" })], { ...base, kmEstimado: null }).linha?.id).toBe("geral");
  });

  it("ignora linha fora de vigência", () => {
    const r = sugerirPrecoItem([linha({ vigenciaAte: new Date("2026-09-30T00:00:00Z") })], { ...base, kmEstimado: 10 });
    expect(r.linha).toBeNull();
  });
});

describe("ciclo e vencimento", () => {
  it("vence o que passou da validade sem resposta; o dia da validade ainda vale", () => {
    expect(deveVencer("ENVIADO", "2026-10-01", HOJE)).toBe(true);
    expect(deveVencer("RASCUNHO", new Date("2026-10-01T00:00:00Z"), HOJE)).toBe(true);
    expect(deveVencer("ENVIADO", "2026-10-02", HOJE)).toBe(false);
    expect(deveVencer("APROVADO", "2026-01-01", HOJE)).toBe(false);
    expect(deveVencer("RECUSADO", "2026-01-01", HOJE)).toBe(false);
  });

  it("vencido prorrogado volta a rascunho; aprovado e recusado não se editam", () => {
    expect(statusAposEditar("VENCIDO", "2026-10-20", HOJE)).toBe("RASCUNHO");
    expect(statusAposEditar("VENCIDO", "2026-10-01", HOJE)).toBe("VENCIDO");
    expect(statusAposEditar("ENVIADO", "2026-10-20", HOJE)).toBe("ENVIADO");
    expect(podeEditar("APROVADO")).toBe(false);
    expect(podeEditar("RECUSADO")).toBe(false);
    expect(podeAprovar("VENCIDO")).toBe(false);
    expect(podeExcluir("ENVIADO")).toBe(false);
  });
});

describe("itensParaPedidos", () => {
  const itens = [
    {
      id: "i1",
      materialId: "m1",
      tipoServicoId: null,
      localCargaId: "l1",
      localDescargaId: "l2",
      descricao: "brita 1",
      quantidade: "300",
      unidade: "TONELADAS" as const,
    },
    {
      id: "i2",
      materialId: "m2",
      tipoServicoId: "s1",
      localCargaId: null,
      localDescargaId: "l2",
      descricao: null,
      quantidade: 12,
      unidade: "VIAGENS" as const,
    },
  ];

  it("um pedido por item, com a quantidade e a unidade da proposta", () => {
    const p = itensParaPedidos(
      { numero: 7, inicioPrevistoEm: "2026-10-05", prazoEm: "2026-10-30" },
      itens,
      { empresaId: "e1", clienteId: "c1", hoje: HOJE },
    );
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({
      itemId: "i1",
      empresaId: "e1",
      clienteId: "c1",
      materialId: "m1",
      localCargaId: "l1",
      localDescargaId: "l2",
      unidadeAlvo: "TONELADAS",
      inicioEm: "2026-10-05",
      prazoEm: "2026-10-30",
      observacao: "Do orçamento nº 7 — brita 1",
    });
    expect(p[0]!.quantidadeAlvo.toString()).toBe("300");
    expect(p[1]).toMatchObject({ tipoServicoId: "s1", unidadeAlvo: "VIAGENS", observacao: "Do orçamento nº 7" });
  });

  it("sem início previsto começa hoje; prazo antes do início é descartado", () => {
    const [p] = itensParaPedidos({ numero: 1, inicioPrevistoEm: null, prazoEm: "2026-09-30" }, [itens[0]!], {
      empresaId: "e1",
      clienteId: null,
      hoje: HOJE,
    });
    expect(p!.inicioEm).toBe(HOJE);
    expect(p!.prazoEm).toBeNull();
  });
});

describe("planoTabelaPreco", () => {
  const ex = (o: Partial<LinhaTabelaExistente>): LinhaTabelaExistente => ({
    id: "x",
    materialId: "m1",
    tipoServicoId: null,
    kmFaixaDe: 0,
    kmFaixaAte: null,
    base: "TONELADA",
    precoUnitario: "40.00",
    vigenciaDe: "2026-01-01",
    vigenciaAte: null,
    ativo: true,
    ...o,
  });
  const item = { materialId: "m1", tipoServicoId: null, kmEstimado: "30", base: "TONELADA" as const, precoUnitario: "45.00" };

  it("tabela vazia: linha nova de qualquer km a partir de hoje", () => {
    expect(planoTabelaPreco([], item, HOJE)).toEqual({
      acao: "CRIAR",
      fechar: [],
      criar: { kmFaixaDe: "0.00", kmFaixaAte: null, vigenciaDe: HOJE },
    });
  });

  it("linha vigente da mesma faixa: fecha ontem (sem mudar o preço) e cria a nova", () => {
    const r = planoTabelaPreco([ex({ id: "a", kmFaixaAte: 50 }), ex({ id: "b", kmFaixaDe: 50 })], item, HOJE);
    expect(r).toEqual({
      acao: "CRIAR",
      fechar: [{ id: "a", vigenciaAte: "2026-10-01" }],
      criar: { kmFaixaDe: "0.00", kmFaixaAte: "50.00", vigenciaDe: HOJE },
    });
  });

  it("sem linha que case, ocupa só o vão entre as faixas", () => {
    const r = planoTabelaPreco(
      [ex({ id: "a", kmFaixaAte: 20 }), ex({ id: "b", kmFaixaDe: 60 })],
      item,
      HOJE,
    );
    expect(r).toMatchObject({ acao: "CRIAR", fechar: [], criar: { kmFaixaDe: "20.00", kmFaixaAte: "60.00" } });
  });

  it("mesmo preço e base: nada a fazer", () => {
    expect(planoTabelaPreco([ex({ precoUnitario: "45" })], item, HOJE).acao).toBe("NADA");
  });

  it("reajuste já agendado pra hoje ou depois não é atropelado", () => {
    const r = planoTabelaPreco([ex({ vigenciaDe: "2026-11-01" })], item, HOJE);
    expect(r.acao).toBe("ERRO");
  });

  it("sem km e tabela por faixa: recusa em vez de chutar", () => {
    expect(planoTabelaPreco([ex({ kmFaixaAte: 50 })], { ...item, kmEstimado: null }, HOJE).acao).toBe("ERRO");
  });

  it("segundo item da mesma proposta e faixa: mesmo preço passa, preço diferente recusa", () => {
    const recem = ex({ id: "nova", kmFaixaAte: null, vigenciaDe: HOJE, precoUnitario: "45.00" });
    expect(planoTabelaPreco([recem], item, HOJE, { criadasAgora: ["nova"] }).acao).toBe("NADA");
    expect(
      planoTabelaPreco([recem], { ...item, precoUnitario: "50" }, HOJE, { criadasAgora: ["nova"] }).acao,
    ).toBe("ERRO");
  });

  it("linha de outro material ou já encerrada não entra na conta", () => {
    const r = planoTabelaPreco(
      [ex({ id: "outro", materialId: "m9" }), ex({ id: "velha", vigenciaAte: "2026-06-30" })],
      item,
      HOJE,
    );
    expect(r).toMatchObject({ acao: "CRIAR", fechar: [] });
  });
});
