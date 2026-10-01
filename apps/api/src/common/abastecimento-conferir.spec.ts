import { describe, expect, it } from "vitest";
import {
  distanciaAoSegmentoKm,
  sinaisDoAbastecimento,
  type AbastecimentoParaConferir,
  type TrajetoDoDia,
} from "./abastecimento-conferir";

let seq = 0;
function ab(over: Partial<AbastecimentoParaConferir> = {}): AbastecimentoParaConferir {
  seq++;
  return {
    id: `a${seq}`,
    data: new Date(`2026-09-${String(seq).padStart(2, "0")}T12:00:00Z`),
    tipo: "DIESEL_S10",
    litros: 200,
    odometro: 100_000 + seq * 500,
    tanqueCheio: true,
    emComboio: false,
    lat: null,
    lng: null,
    precisao: null,
    criadoOfflineEm: null,
    ...over,
  };
}

/** Histórico de um caminhão que faz 2,5 km/l: 500 km por 200 L. */
function historicoNormal(): AbastecimentoParaConferir[] {
  seq = 0;
  return [ab(), ab(), ab(), ab()];
}

const base = {
  capacidadeTanqueLitros: null,
  kmPorLitroFrota: null,
  trajetosDoDia: [] as TrajetoDoDia[],
};

describe("TANQUE", () => {
  it("mais litros do que cabe é sinal", () => {
    const alvo = ab({ litros: 640 });
    const s = sinaisDoAbastecimento({ ...base, alvo, historico: [alvo], capacidadeTanqueLitros: 600 });
    expect(s.map((x) => x.tipo)).toEqual(["TANQUE"]);
    expect(s[0]!.texto).toContain("640 L num tanque de 600 L");
  });

  it("dentro da folga de 5% não é", () => {
    const alvo = ab({ litros: 625 });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [alvo], capacidadeTanqueLitros: 600 })).toEqual([]);
  });

  it("ARLA tem tanque próprio e não é comparado", () => {
    const alvo = ab({ litros: 700, tipo: "ARLA_32" });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [alvo], capacidadeTanqueLitros: 600 })).toEqual([]);
  });

  it("sem capacidade cadastrada não há o que comparar", () => {
    const alvo = ab({ litros: 2000 });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [alvo] }).filter((x) => x.tipo === "TANQUE")).toEqual([]);
  });
});

describe("CONSUMO", () => {
  it("muito mais diesel do que o caminhão rodou é sinal, pela régua do próprio caminhão", () => {
    const h = historicoNormal();
    // 500 km rodados e 480 L: no 2,5 km/l dele seriam 200 L.
    const alvo = ab({ litros: 480 });
    const s = sinaisDoAbastecimento({ ...base, alvo, historico: [...h, alvo] });
    expect(s.map((x) => x.tipo)).toEqual(["CONSUMO"]);
    expect(s[0]!.texto).toContain("Entraram 480 L pra 500 km");
    expect(s[0]!.texto).toContain("2,5 km/l deste caminhão");
    expect(s[0]!.texto).toContain("uns 200 L");
  });

  it("consumo normal não é sinal", () => {
    const h = historicoNormal();
    const alvo = ab({ litros: 230 });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [...h, alvo] })).toEqual([]);
  });

  it("parcial no meio entra na conta do trecho (não acusa o cheio que completou)", () => {
    const h = historicoNormal();
    const parcial = ab({ litros: 120, tanqueCheio: false });
    // 1.000 km desde o último cheio, 120 + 280 = 400 L: 2,5 km/l, normal.
    const alvo = ab({ litros: 280 });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [...h, parcial, alvo] })).toEqual([]);
  });

  it("caminhão sem histórico usa a régua da frota", () => {
    seq = 0;
    const primeiro = ab();
    const alvo = ab({ litros: 480 });
    const s = sinaisDoAbastecimento({ ...base, alvo, historico: [primeiro, alvo], kmPorLitroFrota: 2.5 });
    expect(s[0]!.texto).toContain("da frota");
  });

  it("sem régua nenhuma, não inventa", () => {
    seq = 0;
    const primeiro = ab();
    const alvo = ab({ litros: 480 });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [primeiro, alvo] })).toEqual([]);
  });

  it("diferença pequena em trecho curto é ruído", () => {
    seq = 0;
    const h = [ab(), ab(), ab(), ab()];
    // 100 km a 2,5 km/l = 40 L; 75 L é 1,9x mas só 35 L a mais.
    const alvo = ab({ litros: 75, odometro: h[3]!.odometro! + 100 });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [...h, alvo] })).toEqual([]);
  });
});

describe("LONGE", () => {
  // Curitiba → Ponta Grossa, ~100 km.
  const trajeto: TrajetoDoDia = { cargaLat: -25.43, cargaLng: -49.27, descargaLat: -25.09, descargaLng: -50.16 };
  const naHora = (d: Date) => new Date(d.getTime() + 10 * 60_000);

  it("lançado na hora, longe do trajeto do dia, é sinal", () => {
    seq = 0;
    const data = new Date("2026-09-10T12:00:00Z");
    // Joinville: uns 100 km ao sul do trajeto.
    const alvo = ab({ data, lat: -26.3, lng: -48.85, criadoOfflineEm: naHora(data) });
    const s = sinaisDoAbastecimento({ ...base, alvo, historico: [alvo], trajetosDoDia: [trajeto] });
    expect(s.map((x) => x.tipo)).toEqual(["LONGE"]);
  });

  it("posto no meio da estrada não é sinal", () => {
    seq = 0;
    const data = new Date("2026-09-10T12:00:00Z");
    // Palmeira, entre as duas pontas.
    const alvo = ab({ data, lat: -25.42, lng: -50.0, criadoOfflineEm: naHora(data) });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [alvo], trajetosDoDia: [trajeto] })).toEqual([]);
  });

  it("lançado no dia seguinte não prova nada (o GPS é de onde ele estava depois)", () => {
    seq = 0;
    const data = new Date("2026-09-10T12:00:00Z");
    const alvo = ab({ data, lat: -26.3, lng: -48.85, criadoOfflineEm: new Date("2026-09-11T08:00:00Z") });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [alvo], trajetosDoDia: [trajeto] })).toEqual([]);
  });

  it("GPS ruim ou dia sem viagem não acusa", () => {
    seq = 0;
    const data = new Date("2026-09-10T12:00:00Z");
    const ruim = ab({ data, lat: -26.3, lng: -48.85, precisao: 2000, criadoOfflineEm: naHora(data) });
    expect(sinaisDoAbastecimento({ ...base, alvo: ruim, historico: [ruim], trajetosDoDia: [trajeto] })).toEqual([]);
    const semViagem = ab({ data, lat: -26.3, lng: -48.85, criadoOfflineEm: naHora(data) });
    expect(sinaisDoAbastecimento({ ...base, alvo: semViagem, historico: [semViagem] })).toEqual([]);
  });
});

describe("distanciaAoSegmentoKm", () => {
  it("ponto sobre o segmento dá ~0, e fora dele dá a distância à ponta mais perto", () => {
    expect(distanciaAoSegmentoKm(-25.0, -49.5, -25.0, -49.0, -25.0, -50.0)).toBeLessThan(0.5);
    const d = distanciaAoSegmentoKm(-25.0, -48.0, -25.0, -49.0, -25.0, -50.0);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe("META", () => {
  it("trecho bem abaixo da meta do caminhão é sinal", () => {
    const h = historicoNormal();
    // 500 km com 230 L = 2,17 km/l; meta 2,8 → 77% (abaixo de 85%).
    const alvo = ab({ litros: 230 });
    const s = sinaisDoAbastecimento({ ...base, alvo, historico: [...h, alvo], metaKmL: 2.8 });
    expect(s.map((x) => x.tipo)).toEqual(["META"]);
    expect(s[0]!.texto).toContain("a meta do caminhão é 2,80");
  });

  it("perto da meta não é sinal", () => {
    const h = historicoNormal();
    const alvo = ab({ litros: 200 });
    expect(sinaisDoAbastecimento({ ...base, alvo, historico: [...h, alvo], metaKmL: 2.6 })).toEqual([]);
  });
});

describe("PRECO", () => {
  it("litro 15% acima do normal da frota é sinal", () => {
    const alvo = ab({ litros: 100, valorTotal: 720 });
    const s = sinaisDoAbastecimento({ ...base, alvo, historico: [alvo], precoReferencia: 6 });
    expect(s.map((x) => x.tipo)).toEqual(["PRECO"]);
    expect(s[0]!.texto).toBe("Litro a R$ 7,20, 20% acima do normal da frota (R$ 6,00).");
  });

  it("comboio (sem valor) e preço normal não são sinal", () => {
    const comboio = ab({ litros: 100, valorTotal: null });
    const normal = ab({ litros: 100, valorTotal: 640 });
    expect(sinaisDoAbastecimento({ ...base, alvo: comboio, historico: [comboio], precoReferencia: 6 })).toEqual([]);
    expect(sinaisDoAbastecimento({ ...base, alvo: normal, historico: [normal], precoReferencia: 6 })).toEqual([]);
  });
});

describe("INTERVALO", () => {
  it("abasteceu de novo poucas horas depois, quase sem rodar", () => {
    seq = 0;
    const antes = ab({ data: new Date("2026-09-10T10:00:00Z"), odometro: 100000 });
    const alvo = ab({ data: new Date("2026-09-10T12:30:00Z"), odometro: 100020, litros: 60, tanqueCheio: false });
    const s = sinaisDoAbastecimento({ ...base, alvo, historico: [antes, alvo] });
    expect(s.map((x) => x.tipo)).toEqual(["INTERVALO"]);
    expect(s[0]!.texto).toBe("Abasteceu de novo 3h depois do anterior, com 20 km rodados.");
  });

  it("ARLA no mesmo dia não conta (tanque próprio)", () => {
    seq = 0;
    const antes = ab({ data: new Date("2026-09-10T10:00:00Z"), odometro: 100000 });
    const arla = ab({ data: new Date("2026-09-10T10:20:00Z"), odometro: 100000, tipo: "ARLA_32", litros: 20 });
    expect(sinaisDoAbastecimento({ ...base, alvo: arla, historico: [antes, arla] })).toEqual([]);
  });
});
