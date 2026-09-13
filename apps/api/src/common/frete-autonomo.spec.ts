import { describe, expect, it } from "vitest";
import {
  chaveTrecho,
  compararComHistorico,
  custoPorKmDele,
  pedagioDaRota,
  resultadoDoFrete,
} from "./frete-autonomo";

describe("custoPorKmDele", () => {
  it("divide o que saiu pelo que rodou", () => {
    const r = custoPorKmDele({ gastosNaoCombustivel: 4500, kmRodado: 9000, dias: 90 });
    expect(r.valor).toBe(0.5);
  });

  it("sem km rodado devolve null, não infinito", () => {
    // Dividir por zero mostraria "R$ ∞/km" na tela de quem acabou de baixar.
    const r = custoPorKmDele({ gastosNaoCombustivel: 800, kmRodado: 0, dias: 90 });
    expect(r.valor).toBeNull();
  });
});

describe("pedagioDaRota", () => {
  const pracas = [
    { nome: "Purunã", valorBase: 12.5 },
    { nome: "Norte", valorBase: 10 },
  ];

  it("multiplica a tarifa do eixo simples pelos eixos", () => {
    const r = pedagioDaRota(pracas, 6);
    expect(r.total).toBe(135);
    expect(r.semTarifa).toBe(0);
  });

  it("sem saber os eixos não chuta total", () => {
    const r = pedagioDaRota(pracas, null);
    expect(r.total).toBeNull();
    expect(r.motivo).toBe("SEM_EIXOS");
  });

  it("praça sem preço NÃO conta como zero — vira aviso de que o total é piso", () => {
    // Somar zero por uma praça desconhecida daria um total menor que o real, e
    // o frete pareceria melhor do que é.
    const r = pedagioDaRota([...pracas, { nome: "Sem preço", valorBase: null }], 6);
    expect(r.total).toBe(135);
    expect(r.comTarifa).toBe(2);
    expect(r.semTarifa).toBe(1);
  });

  it("todas as praças sem preço não viram zero", () => {
    const r = pedagioDaRota([{ nome: "X", valorBase: null }], 6);
    expect(r.total).toBeNull();
    expect(r.motivo).toBe("SEM_TARIFA");
  });

  it("rota sem praça nenhuma é zero de verdade", () => {
    const r = pedagioDaRota([], 6);
    expect(r.total).toBeNull();
    expect(r.semTarifa).toBe(0);
    expect(r.comTarifa).toBe(0);
  });
});

describe("resultadoDoFrete", () => {
  it("sobra = frete menos diesel, pedágio e o custo de rodar o trecho", () => {
    const r = resultadoDoFrete({
      valorFrete: 3000,
      km: 600,
      diesel: 900,
      pedagio: 180,
      custoPorKm: 0.5,
    });
    expect(r.custoDoTrecho).toBe(300);
    expect(r.sobra).toBe(1620);
    expect(r.sobraPorKm).toBe(2.7);
    expect(r.incompleto).toBe(false);
  });

  it("o frete maior nem sempre é o melhor — é pra isso que serve a sobra por km", () => {
    const longo = resultadoDoFrete({
      valorFrete: 4000,
      km: 1800,
      diesel: 2600,
      pedagio: 400,
      custoPorKm: 0.5,
    });
    const curto = resultadoDoFrete({
      valorFrete: 2500,
      km: 500,
      diesel: 720,
      pedagio: 120,
      custoPorKm: 0.5,
    });
    expect(longo.sobra).toBe(100);
    expect(curto.sobra).toBe(1410);
    expect(curto.sobra!).toBeGreaterThan(longo.sobra!);
  });

  it("custo que faltou entra como zero, mas levanta a bandeira", () => {
    // Devolver tela em branco porque falta uma praça deixaria sem conta justo
    // quem está começando. A sobra vale — desde que a tela diga que é otimista.
    const r = resultadoDoFrete({
      valorFrete: 3000,
      km: 600,
      diesel: 900,
      pedagio: null,
      custoPorKm: 0.5,
    });
    expect(r.sobra).toBe(1800);
    expect(r.incompleto).toBe(true);
  });
});

describe("chaveTrecho", () => {
  it("iguala o mesmo trecho escrito de jeitos diferentes", () => {
    expect(chaveTrecho("Ponta Grossa/PR", "Curitiba - PR")).toBe(
      chaveTrecho("ponta grossa pr", "  CURITIBA   PR "),
    );
  });

  it("com ou sem a UF é o mesmo lugar", () => {
    // Ele escreve o mesmo município de três jeitos ao longo do ano; tratar
    // isso como três trechos faria o histórico nunca encontrar nada.
    expect(chaveTrecho("Ponta Grossa", "Curitiba")).toBe(
      chaveTrecho("Ponta Grossa - PR", "Curitiba/PR"),
    );
  });

  it("acento não separa o trecho", () => {
    expect(chaveTrecho("Jaguariaíva", "São Paulo")).toBe(
      chaveTrecho("jaguariaiva", "sao paulo"),
    );
  });

  it("a sigla sozinha continua sendo o que ele escreveu", () => {
    // Apagar "SP" deixaria string vazia, e vazio casa com qualquer outro vazio.
    expect(chaveTrecho("SP", "RJ")).toBe("sp>rj");
  });
});

describe("compararComHistorico", () => {
  const anteriores = [
    { origem: "Ponta Grossa", destino: "Curitiba", data: new Date("2026-05-01"), km: 120, valorRecebido: 900 },
    { origem: "ponta grossa/PR", destino: "curitiba", data: new Date("2026-06-10"), km: 120, valorRecebido: 1100 },
    { origem: "Castro", destino: "Curitiba", data: new Date("2026-06-12"), km: 150, valorRecebido: 1400 },
  ];

  it("acha os fretes do mesmo trecho e devolve a mediana", () => {
    const r = compararComHistorico("Ponta Grossa - PR", "Curitiba", anteriores);
    expect(r.vezes).toBe(2);
    expect(r.medianaValor).toBe(1000);
    expect(r.medianaPorKm).toBe(8.33);
    expect(r.ultimaVez).toEqual(new Date("2026-06-10"));
  });

  it("trecho novo devolve zero vezes, não um número qualquer", () => {
    // Inventar referência seria colocar um preço na boca dele numa negociação.
    const r = compararComHistorico("Jaguariaíva", "Santos", anteriores);
    expect(r.vezes).toBe(0);
    expect(r.medianaValor).toBeNull();
  });

  it("frete sem valor lançado não entra na mediana", () => {
    const r = compararComHistorico("Ponta Grossa", "Curitiba", [
      ...anteriores,
      { origem: "Ponta Grossa", destino: "Curitiba", data: new Date("2026-07-01"), km: 120, valorRecebido: null },
    ]);
    expect(r.vezes).toBe(2);
  });
});
