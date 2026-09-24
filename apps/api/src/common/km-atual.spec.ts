import { describe, expect, it } from "vitest";
import { kmAtual, leiturasValidas, type LeituraOdometro } from "./km-atual";

const d = (dia: string) => new Date(`${dia}T00:00:00Z`);
const L = (dia: string, odometro: number, extra: Partial<LeituraOdometro> = {}): LeituraOdometro => ({
  data: d(dia),
  odometro,
  ...extra,
});
const semViagem = () => 0;

describe("leiturasValidas", () => {
  it("leituras normais ficam todas", () => {
    const r = leiturasValidas([L("2026-09-01", 150_000), L("2026-09-05", 151_200), L("2026-09-10", 152_900)]);
    expect(r.validas.map((x) => x.odometro)).toEqual([150_000, 151_200, 152_900]);
    expect(r.descartadas).toEqual([]);
  });

  it("dígito a mais no meio: sai o errado, não os certos que vêm depois", () => {
    const r = leiturasValidas([
      L("2026-09-01", 150_000),
      L("2026-09-05", 1_512_000),
      L("2026-09-10", 152_900),
      L("2026-09-15", 154_000),
    ]);
    expect(r.validas.map((x) => x.odometro)).toEqual([150_000, 152_900, 154_000]);
    expect(r.descartadas.map((x) => x.odometro)).toEqual([1_512_000]);
  });

  it("dígito a mais na PRIMEIRA leitura: a seguinte, menor, é que fica", () => {
    const r = leiturasValidas([L("2026-09-01", 1_500_000), L("2026-09-05", 151_200)]);
    expect(r.validas.map((x) => x.odometro)).toEqual([151_200]);
  });

  it("dígito a menos: a leitura baixa sai, a sequência continua", () => {
    const r = leiturasValidas([L("2026-09-01", 150_000), L("2026-09-05", 15_120), L("2026-09-10", 152_900)]);
    expect(r.validas.map((x) => x.odometro)).toEqual([150_000, 152_900]);
    expect(r.descartadas.map((x) => x.odometro)).toEqual([15_120]);
  });

  it("pulo impossível pra o intervalo é descartado", () => {
    // 2 dias, 40 mil km: ninguém roda isso.
    const r = leiturasValidas([L("2026-09-01", 150_000), L("2026-09-03", 190_000)]);
    expect(r.validas.map((x) => x.odometro)).toEqual([150_000]);
  });

  it("leitura conferida manda e derruba o que a contradiz", () => {
    const r = leiturasValidas([
      L("2026-09-01", 150_000),
      L("2026-09-05", 1_512_000),
      L("2026-09-06", 151_300, { confiavel: true }),
    ]);
    expect(r.validas.map((x) => x.odometro)).toEqual([150_000, 151_300]);
    expect(r.validas[1]!.confiavel).toBe(true);
  });
});

describe("kmAtual", () => {
  it("âncora mais o km das viagens depois dela", () => {
    const k = kmAtual([L("2026-09-01", 150_000), L("2026-09-10", 152_000)], (desde) => {
      expect(desde.toISOString().slice(0, 10)).toBe("2026-09-10");
      return 840.4;
    });
    expect(k).toMatchObject({ km: 152_840, kmViagensDepois: 840, conferido: false });
  });

  it("sem leitura nenhuma: km nulo (o plano por km não inventa)", () => {
    expect(kmAtual([], semViagem)).toMatchObject({ km: null, desde: null });
  });

  it("o odômetro envenenado não prende mais o km lá em cima", () => {
    const k = kmAtual(
      [L("2026-09-01", 150_000), L("2026-09-05", 1_512_000), L("2026-09-10", 152_900)],
      () => 300,
    );
    expect(k.km).toBe(153_200);
    expect(k.descartadas).toHaveLength(1);
  });

  it("o odômetro do conserto vira a âncora e a tela sabe de onde veio", () => {
    const k = kmAtual(
      [
        L("2026-09-01", 150_000),
        { data: new Date("2026-09-12T15:00:00Z"), odometro: 151_200, origem: "CONSERTO" as const },
      ],
      semViagem,
    );
    expect(k).toMatchObject({ km: 151_200, conferido: false, origem: "CONSERTO" });
  });
});
