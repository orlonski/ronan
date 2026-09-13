import { describe, expect, it } from "vitest";
import {
  avaliarViagem,
  limiteDeAtrasoMin,
  medianaMinutos,
  valorDaEstadia,
  type ViagemEmCurso,
} from "./torre";

const AGORA = new Date("2026-06-10T14:00:00Z");
const min = (n: number) => new Date(AGORA.getTime() - n * 60_000);

function viagem(over: Partial<ViagemEmCurso> = {}): ViagemEmCurso {
  return {
    id: "v1",
    motoristaId: "m1",
    motoristaNome: "Jorge",
    iniciadoEm: min(60),
    localCargaNome: "Pedreira Norte",
    localDescargaNome: "Obra Centro",
    ultimoEventoEm: min(10),
    ultimaPosicaoEm: min(5),
    ...over,
  };
}

describe("limiteDeAtrasoMin", () => {
  it("sem histórico não gera limite", () => {
    // Chutar um limite pra trajeto que o sistema nunca viu produz alarme falso
    // na primeira semana — e é assim que se ensina o supervisor a ignorar a tela.
    expect(limiteDeAtrasoMin(null, 0)).toBeNull();
  });

  it("menos de 3 viagens não é histórico", () => {
    expect(limiteDeAtrasoMin(90, 2)).toBeNull();
  });

  it("com histórico usa o dobro da mediana", () => {
    expect(limiteDeAtrasoMin(90, 10)).toBe(180);
  });

  it("tem piso de 60 minutos", () => {
    // Trajeto de 20 min que leva 45 não é notícia.
    expect(limiteDeAtrasoMin(20, 10)).toBe(60);
  });
});

describe("avaliarViagem — atraso", () => {
  it("não alerta dentro do limite", () => {
    const a = avaliarViagem(viagem(), { limiteAtrasoMin: 180, agora: AGORA, temTracking: true });
    expect(a.find((x) => x.tipo === "ATRASO")).toBeUndefined();
  });

  it("alerta quando passa do limite", () => {
    const a = avaliarViagem(viagem({ iniciadoEm: min(200) }), {
      limiteAtrasoMin: 180,
      agora: AGORA,
      temTracking: true,
    });
    const atraso = a.find((x) => x.tipo === "ATRASO");
    expect(atraso).toBeDefined();
    expect(atraso!.severidade).toBe("MEDIA");
    expect(atraso!.titulo).toContain("Jorge");
  });

  it("passar do dobro é severidade alta", () => {
    // Já não é trânsito, é problema.
    const a = avaliarViagem(viagem({ iniciadoEm: min(400) }), {
      limiteAtrasoMin: 180,
      agora: AGORA,
      temTracking: true,
    });
    expect(a.find((x) => x.tipo === "ATRASO")!.severidade).toBe("ALTA");
  });

  it("sem limite não alerta atraso nunca", () => {
    const a = avaliarViagem(viagem({ iniciadoEm: min(600) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    });
    expect(a.find((x) => x.tipo === "ATRASO")).toBeUndefined();
  });
});

describe("avaliarViagem — parada longa", () => {
  it("não alerta com evento recente", () => {
    const a = avaliarViagem(viagem(), { limiteAtrasoMin: null, agora: AGORA, temTracking: true });
    expect(a.find((x) => x.tipo === "PARADA_LONGA")).toBeUndefined();
  });

  it("alerta depois de 2h sem evento", () => {
    const a = avaliarViagem(viagem({ ultimoEventoEm: min(130) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    });
    const p = a.find((x) => x.tipo === "PARADA_LONGA");
    expect(p).toBeDefined();
    expect(p!.titulo).toContain("2h10");
  });

  it("viagem sem nenhum evento conta desde o início", () => {
    const a = avaliarViagem(viagem({ ultimoEventoEm: null, iniciadoEm: min(200) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    });
    const p = a.find((x) => x.tipo === "PARADA_LONGA");
    expect(p).toBeDefined();
    expect(p!.detalhe).toContain("nenhum evento");
  });
});

describe("avaliarViagem — sem sinal", () => {
  it("alerta depois de 3h sem posição", () => {
    const a = avaliarViagem(viagem({ ultimaPosicaoEm: min(200) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    });
    expect(a.find((x) => x.tipo === "SEM_SINAL")).toBeDefined();
  });

  it("NÃO alerta quando a conta não usa tracking", () => {
    // Seria um alerta permanente pra frota inteira — e alerta permanente é
    // decoração.
    const a = avaliarViagem(viagem({ ultimaPosicaoEm: min(600) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: false,
    });
    expect(a.find((x) => x.tipo === "SEM_SINAL")).toBeUndefined();
  });

  it("sem posição nenhuma não alerta sem sinal", () => {
    // Nunca mandou posição ≠ parou de mandar.
    const a = avaliarViagem(viagem({ ultimaPosicaoEm: null }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    });
    expect(a.find((x) => x.tipo === "SEM_SINAL")).toBeUndefined();
  });
});

describe("avaliarViagem — vários ao mesmo tempo", () => {
  it("atraso e parada longa são alertas separados", () => {
    // Juntar os dois numa linha só esconderia um deles.
    const a = avaliarViagem(viagem({ iniciadoEm: min(400), ultimoEventoEm: min(300) }), {
      limiteAtrasoMin: 180,
      agora: AGORA,
      temTracking: true,
    });
    expect(a.map((x) => x.tipo).sort()).toEqual(["ATRASO", "PARADA_LONGA"]);
  });
});

describe("medianaMinutos", () => {
  it("a mediana não é deslocada por um caso extremo", () => {
    // A média de [60,60,60,600] é 195; a mediana é 60. Uma viagem de 10h não
    // pode redefinir o normal do trajeto.
    expect(medianaMinutos([60, 60, 60, 600])).toBe(60);
  });

  it("com número par tira a média dos dois do meio", () => {
    expect(medianaMinutos([10, 20, 30, 40])).toBe(25);
  });

  it("lista vazia devolve null", () => {
    expect(medianaMinutos([])).toBeNull();
  });
});

describe("valorDaEstadia", () => {
  it("cobra por hora cheia iniciada", () => {
    // 61 minutos são 2 horas — é como se cobra estadia no Brasil.
    const r = valorDaEstadia({
      iniciouEm: new Date("2026-06-10T10:00:00Z"),
      terminouEm: new Date("2026-06-10T11:01:00Z"),
      valorHora: 80,
    });
    expect(r!.horas).toBe(2);
    expect(r!.valor).toBe("160.00");
  });

  it("desconta a franquia combinada", () => {
    const r = valorDaEstadia({
      iniciouEm: new Date("2026-06-10T10:00:00Z"),
      terminouEm: new Date("2026-06-10T14:00:00Z"),
      valorHora: 80,
      franquiaHoras: 2,
    });
    expect(r!.horas).toBe(4);
    expect(r!.horasCobradas).toBe(2);
    expect(r!.valor).toBe("160.00");
  });

  it("dentro da franquia não cobra nada", () => {
    const r = valorDaEstadia({
      iniciouEm: new Date("2026-06-10T10:00:00Z"),
      terminouEm: new Date("2026-06-10T11:00:00Z"),
      valorHora: 80,
      franquiaHoras: 2,
    });
    expect(r!.valor).toBe("0.00");
  });

  it("ocorrência ainda aberta conta até agora", () => {
    const r = valorDaEstadia({
      iniciouEm: min(150),
      terminouEm: null,
      valorHora: 100,
      agora: AGORA,
    });
    expect(r!.horas).toBe(3);
  });

  it("sem valor/hora não gera cobrança", () => {
    const r = valorDaEstadia({
      iniciouEm: min(150),
      terminouEm: null,
      valorHora: null,
    });
    expect(r).toBeNull();
  });
});
