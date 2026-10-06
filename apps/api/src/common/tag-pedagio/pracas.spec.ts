import { describe, expect, it } from "vitest";
import { agruparNos, cadeiaConfere, candidatosDaPraca, decidirPraca, tarifaConfere, type NoPedagio, type PracaDoExtrato } from "./pracas";
import { variantesDaPlaca, eixosDaCategoria, instanteDaPassagem, offsetDaUf, ufDaPassagem } from "./normalizacao";
import { pracasNaOrdemDaRota } from "./rota";

const no = (id: string, lat: number, lng: number, rodovia: string | null, extra: Partial<NoPedagio> = {}): NoPedagio => ({
  id,
  nome: id,
  lat,
  lng,
  rodovia,
  concessionaria: null,
  valorBase: null,
  ...extra,
});

const praca = (extra: Partial<PracaDoExtrato> = {}): PracaDoExtrato => ({
  operadora: "SEM_PARAR",
  chave: "BR364|579100",
  rodovia: "BR364",
  kmMetros: 579100,
  cidade: "NOBRES",
  concessionaria: "NOVA ROTA DO OESTE",
  uf: "MT",
  tarifaEixoCent: 670,
  ...extra,
});

describe("de-para de praça", () => {
  const nobres = { lat: -14.72, lng: -56.33 };

  it("cabines a menos de 2 km são a mesma praça; rodovia com várias refs casa", () => {
    const grupos = agruparNos([
      no("a", -14.70, -56.30, "BR-163;BR-364;MT-010"),
      no("b", -14.705, -56.301, "BR-364"),
      no("c", -15.5, -55.1, "BR-364"),
    ]);
    expect(grupos).toHaveLength(2);
    const c = candidatosDaPraca(praca(), grupos, nobres);
    expect(c).toHaveLength(1);
    expect(c[0]!.grupo.nos.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("casa sozinha só com UM candidato e uma confirmação; a cadeia que contradiz manda pra fila", () => {
    const grupos = agruparNos([no("a", -14.70, -56.30, "BR-364", { valorBase: 6.7 })]);
    const c = candidatosDaPraca(praca(), grupos, nobres);
    expect(tarifaConfere(praca(), c[0]!.grupo)).toBe(true);
    expect(decidirPraca(praca(), c, [], true).status).toBe("CASOU");
    expect(decidirPraca(praca(), c, [], null).status).toBe("A_CONFIRMAR");
    const ruim = [{ com: "BARRA", ok: cadeiaConfere(213, 0), dKmExtrato: 213, dKmEstrada: 0 }];
    expect(decidirPraca(praca(), c, ruim, true)).toMatchObject({ status: "A_CONFIRMAR" });
    expect(decidirPraca(praca(), [], [], true).status).toBe("SEM_CANDIDATO");
  });

  it("praça sem rodovia no mapa casa pela operadora", () => {
    const grupos = agruparNos([no("x", -12.3, -49.15, null, { concessionaria: "Ecovias do Araguaia" })]);
    const p = praca({ rodovia: "BR153", concessionaria: "ECOVIAS DO ARAGUAIA", cidade: "ALVORADA" });
    expect(candidatosDaPraca(p, grupos, { lat: -12.48, lng: -49.12 })).toHaveLength(1);
  });

  it("praças na ordem da rota e o rumo da estrada", () => {
    // Uma reta de sul pra norte: a praça do sul vem antes, rumo NORTE.
    const pontos: Array<[number, number]> = Array.from({ length: 50 }, (_, i) => [-16 + i * 0.05, -55]);
    const r = pracasNaOrdemDaRota(pontos, [
      { id: "norte", lat: -14.0, lng: -55 },
      { id: "sul", lat: -15.5, lng: -55.0005 },
      { id: "longe", lat: -15, lng: -54 },
    ]);
    expect(r.map((x) => x.id)).toEqual(["sul", "norte"]);
    expect(r.every((x) => x.rumo === "NORTE")).toBe(true);
  });
});

describe("normalização", () => {
  it("categoria 61 = 7 eixos; código desconhecido é 'não sei'", () => {
    expect(eixosDaCategoria(61)).toBe(7);
    expect(eixosDaCategoria(4)).toBe(4);
    expect(eixosDaCategoria(77)).toBeNull();
  });

  it("fuso pela UF da concessionária: MT −4, TO −3", () => {
    expect(offsetDaUf(ufDaPassagem("NOVA ROTA DO OESTE", "BR364"))).toBe(-240);
    expect(offsetDaUf(ufDaPassagem("ECOVIAS DO ARAGUAIA", "BR153"))).toBe(-180);
    expect(offsetDaUf(ufDaPassagem("DESCONHECIDA", "MT358"))).toBe(-240);
    expect(instanteDaPassagem("31/08/26", "19:00:00", -240).toISOString()).toBe("2026-08-31T23:00:00.000Z");
  });

  it("placa Mercosul ⇄ antiga", () => {
    expect(variantesDaPlaca("abc-1d23")).toEqual(["ABC1D23", "ABC1323"]);
    expect(variantesDaPlaca("ABC1323")).toEqual(["ABC1323", "ABC1D23"]);
  });
});
