import { describe, expect, it } from "vitest";
import {
  avaliarViagem,
  decidirAlerta,
  dentroDaJanelaDaTorre,
  limiteDeAtrasoMin,
  medianaMinutos,
  valorDaEstadia,
  LIMIARES_TORRE_PADRAO,
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
    expect(p!.detalhe).toContain("nenhuma etapa");
  });

  it("não põe o parceiro como sujeito de uma omissão", () => {
    // "sem registrar nada" é ficha de ocorrência de funcionário — e motorista
    // aqui é parceiro autônomo. Quem está sem novidade é a viagem.
    const a = avaliarViagem(viagem({ ultimoEventoEm: min(130) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    });
    const p = a.find((x) => x.tipo === "PARADA_LONGA")!;
    expect(p.titulo).not.toContain("sem registrar");
    expect(p.titulo).toContain("sem novidade");
  });
});

describe("avaliarViagem — teto de idade", () => {
  // O bug que encheu a caixa de entrada: uma viagem esquecida aberta ficava
  // ALTA pra sempre e notificava a cada varredura. Acima do teto ela deixa de
  // ser operação — ninguém descobre nada ligando pro motorista de três dias
  // atrás — e vira pendência de cadastro, que não incomoda ninguém.
  const esquecida = () =>
    avaliarViagem(viagem({ iniciadoEm: min(4000), ultimoEventoEm: null }), {
      limiteAtrasoMin: 180,
      agora: AGORA,
      temTracking: true,
    });

  it("passado o teto vira VIAGEM_ESQUECIDA, não parada longa", () => {
    const a = esquecida();
    expect(a.map((x) => x.tipo)).toEqual(["VIAGEM_ESQUECIDA"]);
  });

  it("viagem esquecida NUNCA é alta — é ela que enchia o sininho", () => {
    expect(esquecida()[0]!.severidade).toBe("MEDIA");
  });

  it("não acumula atraso nem sem sinal por cima", () => {
    // Quem esqueceu a viagem aberta não precisa saber que ela também está
    // "atrasada" há três dias: é consequência, não um segundo problema.
    const a = avaliarViagem(
      viagem({ iniciadoEm: min(4000), ultimoEventoEm: null, ultimaPosicaoEm: min(3000) }),
      {
        limiteAtrasoMin: 60,
        agora: AGORA,
        temTracking: true,
      },
    );
    expect(a).toHaveLength(1);
  });

  it("logo abaixo do teto ainda é parada longa", () => {
    const a = avaliarViagem(viagem({ ultimoEventoEm: min(719) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    });
    expect(a.find((x) => x.tipo === "PARADA_LONGA")).toBeDefined();
  });

  it("o teto é configurável por conta", () => {
    const a = avaliarViagem(viagem({ ultimoEventoEm: min(300) }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
      limiares: { ...LIMIARES_TORRE_PADRAO, viagemEsquecidaMin: 240 },
    });
    expect(a[0]!.tipo).toBe("VIAGEM_ESQUECIDA");
  });
});

describe("decidirAlerta — o mesmo problema avisa UMA vez", () => {
  const det = (severidade: "BAIXA" | "MEDIA" | "ALTA") =>
    ({
      tipo: "PARADA_LONGA",
      severidade,
      viagemId: "v1",
      motoristaId: "m1",
      titulo: "t",
      detalhe: "d",
      dados: {},
    }) as const;

  it("alerta novo e grave: cria e avisa", () => {
    expect(decidirAlerta(det("ALTA"), null)).toEqual({ acao: "criar", notificar: true });
  });

  it("alerta novo e leve: cria e fica quieto", () => {
    // Notificar tudo é como se ensina alguém a ignorar notificação.
    expect(decidirAlerta(det("MEDIA"), null)).toEqual({ acao: "criar", notificar: false });
  });

  it("MESMO alerta grave na varredura seguinte: atualiza e NÃO avisa de novo", () => {
    // ESTE é o bug que encheu a caixa de entrada. O cron rodava a cada 5 min,
    // o `create` cego passava sempre (o índice único não dedupe NULL no
    // Postgres) e cada passagem virava notificação: 288 por dia, por pessoa.
    expect(decidirAlerta(det("ALTA"), { severidade: "ALTA" })).toEqual({
      acao: "atualizar",
      notificar: false,
    });
  });

  it("problema que PIOROU volta a avisar", () => {
    // O outro lado da moeda: consertar só o índice faria o alerta que nasceu
    // MEDIA nunca mais virar ALTA, e o caso grave deixaria de avisar.
    expect(decidirAlerta(det("ALTA"), { severidade: "MEDIA" })).toEqual({
      acao: "atualizar",
      notificar: true,
    });
  });

  it("problema que melhorou não avisa", () => {
    expect(decidirAlerta(det("MEDIA"), { severidade: "ALTA" })).toEqual({
      acao: "atualizar",
      notificar: false,
    });
  });

  it("viagem esquecida nunca notifica, nem na primeira vez", () => {
    const esquecida = avaliarViagem(viagem({ iniciadoEm: min(4000), ultimoEventoEm: null }), {
      limiteAtrasoMin: null,
      agora: AGORA,
      temTracking: true,
    })[0]!;
    expect(decidirAlerta(esquecida, null).notificar).toBe(false);
  });
});

describe("dentroDaJanelaDaTorre", () => {
  const janela = (over = {}) => ({ ...LIMIARES_TORRE_PADRAO, ...over });
  // 14:00Z = 11:00 em Brasília.
  const meioDia = new Date("2026-06-10T14:00:00Z");
  // 05:00Z = 02:00 em Brasília, de uma quarta-feira.
  const madrugada = new Date("2026-06-10T05:00:00Z");

  it("no horário comercial passa", () => {
    expect(dentroDaJanelaDaTorre(meioDia, janela())).toBe(true);
  });

  it("de madrugada não notifica ninguém", () => {
    expect(dentroDaJanelaDaTorre(madrugada, janela())).toBe(false);
  });

  it("janela que vira a noite é intervalo aberto", () => {
    expect(dentroDaJanelaDaTorre(madrugada, janela({ horaInicio: 20, horaFim: 6 }))).toBe(true);
    expect(dentroDaJanelaDaTorre(meioDia, janela({ horaInicio: 20, horaFim: 6 }))).toBe(false);
  });

  it("domingo pode ser desligado", () => {
    // 14/06/2026 é um domingo.
    const domingo = new Date("2026-06-14T14:00:00Z");
    expect(dentroDaJanelaDaTorre(domingo, janela())).toBe(true);
    expect(dentroDaJanelaDaTorre(domingo, janela({ notificaDomingo: false }))).toBe(false);
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
