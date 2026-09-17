import { describe, expect, it } from "vitest";
import { calcularConsumo, type AbastecimentoParaConsumo } from "./consumo";

let seq = 0;
function ab(
  dia: number,
  odometro: number | null,
  litros: number,
  tanqueCheio = true,
): AbastecimentoParaConsumo {
  return {
    id: `a${++seq}`,
    data: new Date(Date.UTC(2026, 5, dia, 12)),
    odometro,
    litros,
    tanqueCheio,
  };
}

/** Dois cheios no MESMO dia civil, como chega do lançamento pessoal. */
function abMesmoDia(
  odometro: number,
  litros: number,
  minutoDeEntrada: number,
): AbastecimentoParaConsumo {
  return {
    id: `m${++seq}`,
    // Dia civil, sem hora — é o que `@db.Date` devolve pro fluxo pessoal.
    data: new Date(Date.UTC(2026, 5, 10)),
    odometro,
    litros,
    tanqueCheio: true,
    criadoEm: new Date(Date.UTC(2026, 5, 10, 8, minutoDeEntrada)),
  };
}

describe("calcularConsumo", () => {
  describe("dois cheios no mesmo dia (fluxo pessoal, data sem hora)", () => {
    it("mede normalmente — antes somava zero litro e acusava o motorista", () => {
      const r = calcularConsumo([abMesmoDia(480_000, 200, 10), abMesmoDia(480_950, 190, 40)]);
      expect(r.kmTotal).toBe(950);
      expect(r.litrosTotal).toBe(190);
      expect(r.kmPorLitro).toBe(5);
      expect(r.motivo).toBeUndefined();
    });

    it("independe da ordem em que o banco devolveu as linhas", () => {
      const primeiro = abMesmoDia(480_000, 200, 10);
      const segundo = abMesmoDia(480_950, 190, 40);
      // O Postgres não promete ordem em empate de `data`: o mesmo par tem que
      // dar o mesmo km/l chegando de trás pra frente.
      expect(calcularConsumo([segundo, primeiro]).kmPorLitro).toBe(5);
    });

    it("odômetro que anda pra trás no mesmo dia CONTINUA sendo denunciado", () => {
      // O desempate é por `criadoEm`, não pelo odômetro: ordenar pelo odômetro
      // faria qualquer digitação errada virar um trecho plausível.
      const r = calcularConsumo([abMesmoDia(480_950, 200, 10), abMesmoDia(480_000, 190, 40)]);
      expect(r.kmPorLitro).toBeNull();
      expect(r.motivo).toBe("ODOMETRO_INCONSISTENTE");
    });
  });


  it("mede entre dois tanques cheios", () => {
    // 1200 km com 400 litros = 3 km/l.
    const r = calcularConsumo([ab(1, 100_000, 300), ab(5, 101_200, 400)]);
    expect(r.kmPorLitro).toBe(3);
    expect(r.kmTotal).toBe(1200);
    // Os litros do cheio de ABERTURA não entram: eles pagaram o trecho anterior.
    expect(r.litrosTotal).toBe(400);
  });

  it("conta os litros dos parciais do meio", () => {
    // Ignorar o parcial daria 900/300 = 3 km/l, otimista e errado.
    const r = calcularConsumo([
      ab(1, 100_000, 300),
      ab(3, 100_500, 100, false),
      ab(5, 100_900, 200),
    ]);
    expect(r.kmTotal).toBe(900);
    expect(r.litrosTotal).toBe(300);
    expect(r.kmPorLitro).toBe(3);
  });

  it("soma vários trechos com média ponderada pelo km", () => {
    // Trecho 1: 1000 km / 400 L. Trecho 2: 200 km / 100 L.
    // Média das médias daria (2,5 + 2,0) / 2 = 2,25 — errado.
    // Ponderada: 1200 / 500 = 2,4.
    const r = calcularConsumo([
      ab(1, 100_000, 350),
      ab(5, 101_000, 400),
      ab(8, 101_200, 100),
    ]);
    expect(r.trechos).toHaveLength(2);
    expect(r.kmPorLitro).toBe(2.4);
  });

  it("ordena sozinho quando vem fora de ordem", () => {
    const r = calcularConsumo([ab(5, 101_200, 400), ab(1, 100_000, 300)]);
    expect(r.kmPorLitro).toBe(3);
  });

  it("um cheio só não dá conta nenhuma", () => {
    const r = calcularConsumo([ab(1, 100_000, 300)]);
    expect(r.kmPorLitro).toBeNull();
    expect(r.motivo).toBe("SEM_DOIS_CHEIOS");
  });

  it("só parciais não dá conta nenhuma", () => {
    const r = calcularConsumo([ab(1, 100_000, 100, false), ab(5, 100_500, 100, false)]);
    expect(r.kmPorLitro).toBeNull();
    expect(r.motivo).toBe("SEM_DOIS_CHEIOS");
  });

  it("cheios sem odômetro dizem que falta o odômetro", () => {
    const r = calcularConsumo([ab(1, null, 300), ab(5, null, 400)]);
    expect(r.kmPorLitro).toBeNull();
    expect(r.motivo).toBe("SEM_ODOMETRO");
  });

  it("descarta odômetro que anda pra trás", () => {
    // Erro de digitação: 101200 virou 91200. Sem o descarte isso viraria km
    // negativo e envenenaria a média do veículo inteiro.
    const r = calcularConsumo([ab(1, 100_000, 300), ab(5, 91_200, 400)]);
    expect(r.kmPorLitro).toBeNull();
    expect(r.motivo).toBe("ODOMETRO_INCONSISTENTE");
  });

  it("descarta salto absurdo de odômetro", () => {
    const r = calcularConsumo([ab(1, 100_000, 300), ab(5, 130_000, 400)]);
    expect(r.motivo).toBe("ODOMETRO_INCONSISTENTE");
  });

  it("um trecho ruim não derruba os bons", () => {
    const r = calcularConsumo([
      ab(1, 100_000, 300),
      ab(5, 101_000, 400), // trecho bom: 1000 km / 400 L
      ab(8, 90_000, 200), // digitação errada: descartado
      ab(12, 90_500, 250), // volta a fazer sentido: 500 km / 250 L
    ]);
    expect(r.trechos).toHaveLength(2);
    expect(r.kmTotal).toBe(1500);
    expect(r.kmPorLitro).toBe(Number((1500 / 650).toFixed(2)));
  });
});
