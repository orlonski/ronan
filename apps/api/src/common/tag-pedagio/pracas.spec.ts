import { describe, expect, it } from "vitest";
import {
  agruparNos,
  cadeiaConfere,
  candidatosDaPraca,
  candidatosNoMunicipio,
  decidirPraca,
  dentroDaMalha,
  kmDaChave,
  pelasVizinhas,
  pracaNaAntt,
  tarifaConfere,
  vizinhasNaRodovia,
  type Malha,
  type NoPedagio,
  type PracaConhecida,
  type PracaDoExtrato,
} from "./pracas";
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

describe("praça pelo km das vizinhas já casadas", () => {
  const conhecida = (km: number, extra: Partial<PracaConhecida> = {}): PracaConhecida => ({
    chave: `BR364|${km * 1000}`,
    rodovia: "BR364",
    kmMetros: km * 1000,
    lat: -15,
    lng: -55,
    nome: `km ${km}`,
    uf: "MT",
    ...extra,
  });
  const p = praca({ chave: "BR364|383100", kmMetros: 383100, cidade: "SANTO ANTONIO DE LEVERGER" });

  it("a chave do extrato vira rodovia e km", () => {
    expect(kmDaChave("BR364|383100")).toEqual({ rodovia: "BR364", kmMetros: 383100 });
    expect(kmDaChave("lixo")).toBeNull();
  });

  it("pega a vizinha mais perto de cada lado, na mesma rodovia e no mesmo estado", () => {
    const vs = vizinhasNaRodovia(p, [
      conhecida(316),
      conhecida(214),
      conhecida(479),
      conhecida(579),
      conhecida(400, { uf: "RO" }), // o km recomeça na divisa: outro lugar
      conhecida(380, { rodovia: "BR163", chave: "BR163|380000" }),
    ]);
    expect(vs.map((v) => v.kmMetros / 1000)).toEqual([316, 479]);
  });

  it("vizinha longe demais não serve de régua", () => {
    expect(vizinhasNaRodovia(p, [conhecida(30)])).toEqual([]);
  });

  it("casa a única praça do mapa cuja estrada até as vizinhas bate com o Δkm do extrato", () => {
    const g = (id: string, lat: number) => agruparNos([no(id, lat, -55.5, "BR-364")])[0]!;
    const certa = g("certa", -15.6);
    const errada = g("errada", -15.9);
    const vs = [conhecida(316, { lat: -16.0 }), conhecida(479, { lat: -14.9 })];
    const km: Record<string, number> = { "certa|BR364|316000": 67, "certa|BR364|479000": 95, "errada|BR364|316000": 30, "errada|BR364|479000": 130 };
    const r = pelasVizinhas(p, vs, [certa, errada], (gid, vk) => km[`${gid}|${vk}`] ?? null);
    expect(r.passaram.map((x) => x.id)).toEqual(["certa"]);
    // Duas candidatas perto da cidade: o km decide qual.
    const d = decidirPraca(p, [{ grupo: certa, distanciaKm: 10 }, { grupo: errada, distanciaKm: 12 }], [], null, r);
    expect(d).toMatchObject({ status: "CASOU", grupo: { id: "certa" } });
    expect(d.motivo).toMatch(/pelo km do extrato/);
  });

  it("o km aponta uma praça que não está perto da cidade: não casa, vai pra fila", () => {
    const g = (id: string) => agruparNos([no(id, -15.6, -55.5, "BR-364")])[0]!;
    const pelaRegua = g("longe");
    const d = decidirPraca(p, [{ grupo: g("perto"), distanciaKm: 5 }], [], null, { passaram: [pelaRegua], motivo: "x" });
    expect(d.status).toBe("A_CONFIRMAR");
  });

  it("duas praças passam na régua: não escolhe", () => {
    const g = (id: string) => agruparNos([no(id, -15.6, -55.5, "BR-364")])[0]!;
    const a = g("a");
    const b = g("b");
    const d = decidirPraca(p, [{ grupo: a, distanciaKm: 5 }, { grupo: b, distanciaKm: 6 }], [], null, { passaram: [a, b], motivo: "x" });
    expect(d.status).toBe("A_CONFIRMAR");
  });
});

describe("território do município", () => {
  // Quadrado de 1° com um buraco no meio (lng, lat).
  const malha: Malha = {
    type: "Polygon",
    coordinates: [
      [[-56, -15], [-55, -15], [-55, -14], [-56, -14], [-56, -15]],
      [[-55.6, -14.6], [-55.4, -14.6], [-55.4, -14.4], [-55.6, -14.4], [-55.6, -14.6]],
    ],
  };

  it("ponto dentro, fora e no buraco", () => {
    expect(dentroDaMalha(-14.2, -55.8, malha)).toBe(true);
    expect(dentroDaMalha(-13.5, -55.5, malha)).toBe(false);
    expect(dentroDaMalha(-14.5, -55.5, malha)).toBe(false);
  });

  it("acha praça da rodovia no território mesmo longe da sede", () => {
    const grupos = agruparNos([no("dentro", -14.9, -55.9, "BR-364"), no("fora", -13.5, -55.5, "BR-364"), no("outra", -14.2, -55.8, "BR-163")]);
    const c = candidatosNoMunicipio(praca({ rodovia: "BR364" }), grupos, malha, { lat: -14.1, lng: -55.1 });
    expect(c.map((x) => x.grupo.id)).toEqual(["dentro"]);
    expect(c[0]!.distanciaKm).toBeGreaterThan(40);
  });
});

describe("praça pela lista oficial da ANTT", () => {
  it("casa as praças da fatura real de MT por rodovia + estado + km", () => {
    expect(pracaNaAntt(praca({ chave: "BR163|586900", rodovia: "BR163", kmMetros: 586900, cidade: "NOVA MUTUM" }))).toMatchObject({
      municipio: "Nova Mutum",
      rodovia: "BR-163",
      km: 586.9,
    });
    expect(pracaNaAntt(praca({ chave: "BR364|383100", rodovia: "BR364", kmMetros: 383100 }))).toMatchObject({
      municipio: "Santo Antônio de Leverger",
    });
    expect(pracaNaAntt(praca({ chave: "BR364|316550", rodovia: "BR364", kmMetros: 316550 }))?.municipio).toBe("Campo Verde");
  });

  it("km longe, outro estado ou estrada estadual: não casa", () => {
    expect(pracaNaAntt(praca({ rodovia: "BR163", kmMetros: 590000 }))).toBeNull();
    // Mesma praça medida com meio km de diferença (Alvorada, TO) ainda casa.
    expect(pracaNaAntt(praca({ rodovia: "BR153", kmMetros: 745432, uf: "TO" }))?.municipio).toBe("Alvorada");
    expect(pracaNaAntt(praca({ rodovia: "BR163", kmMetros: 586900, uf: "RO" }))).toBeNull();
    expect(pracaNaAntt(praca({ rodovia: "MT246", kmMetros: 10000 }))).toBeNull();
  });

  it("rodovia só com número na ANTT (lotes do Paraná) casa como estadual ou BR", () => {
    expect(pracaNaAntt(praca({ rodovia: "PR444", kmMetros: 3300, uf: "PR" }))?.municipio).toBe("Arapongas");
    expect(pracaNaAntt(praca({ rodovia: "BR280", kmMetros: 234300, uf: "PR" }))?.municipio).toBe("Vitorino");
  });
});
