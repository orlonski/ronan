import { describe, it, expect } from "vitest";
import {
  avaliarPreAprovacao,
  type LimiaresPreAprovacao,
  type SinaisPreAprovacao,
} from "./pre-aprovacao";

const LIMIARES: LimiaresPreAprovacao = {
  exigirKmNoPadrao: true,
  exigirPedagioCoerente: true,
  desvioPedagioPct: 40,
  amostraMinimaPedagio: 3,
};

const sinais = (over: Partial<SinaisPreAprovacao> = {}): SinaisPreAprovacao => ({
  km: { foraDoPadrao: false, aceitoPorHumano: false, desvioPct: 2, referencia: 120 },
  pedagio: { pracas: 2, valorInformado: 84, mediana: 80, amostra: 9 },
  ...over,
});

const avaliar = (s: SinaisPreAprovacao, l: Partial<LimiaresPreAprovacao> = {}) =>
  avaliarPreAprovacao(s, { ...LIMIARES, ...l });

describe("km do trajeto", () => {
  it("aprova quando o km está no padrão do par", () => {
    const r = avaliar(sinais());
    expect(r.aprova).toBe(true);
    expect(r.resumo.join(" ")).toMatch(/Km na média/);
  });

  it("não aprova km fora do padrão, e diz o quanto", () => {
    const r = avaliar(
      sinais({ km: { foraDoPadrao: true, aceitoPorHumano: false, desvioPct: 38, referencia: 120 } }),
    );
    expect(r.aprova).toBe(false);
    expect(r.motivo).toMatch(/fora do padrão/);
    expect(r.motivo).toMatch(/38%/);
    expect(r.motivo).toMatch(/acima/);
  });

  it("não aprova sem referência — 'não sei' não é 'está na média'", () => {
    // O carimbo vem null quando não houve com o que comparar (par novo, viagem
    // com trechos, detecção desligada). Aprovar aí seria afirmar o que não se
    // mediu; a viagem só segue na fila de quem confere.
    const r = avaliar(
      sinais({ km: { foraDoPadrao: null, aceitoPorHumano: false, desvioPct: null, referencia: null } }),
    );
    expect(r.aprova).toBe(false);
    expect(r.motivo).toMatch(/sem referência/);
  });

  it("km que um humano já aceitou não barra a aprovação", () => {
    // "Aceitar km" no painel é decisão de gente sobre aquele km — o robô não
    // reabre o assunto.
    const r = avaliar(
      sinais({ km: { foraDoPadrao: true, aceitoPorHumano: true, desvioPct: 60, referencia: 120 } }),
    );
    expect(r.aprova).toBe(true);
  });

  it("com a checagem desligada, km não é olhado", () => {
    const r = avaliar(
      sinais({ km: { foraDoPadrao: true, aceitoPorHumano: false, desvioPct: 90, referencia: 120 } }),
      { exigirKmNoPadrao: false },
    );
    expect(r.aprova).toBe(true);
  });
});

describe("pedágio da rota", () => {
  it("rota sem praça não exige valor nenhum", () => {
    const r = avaliar(
      sinais({ pedagio: { pracas: 0, valorInformado: null, mediana: null, amostra: 0 } }),
    );
    expect(r.aprova).toBe(true);
    expect(r.resumo.join(" ")).toMatch(/não passa por praça/);
  });

  it("passou por praça e não lançou valor: não aprova", () => {
    const r = avaliar(
      sinais({ pedagio: { pracas: 2, valorInformado: null, mediana: null, amostra: 0 } }),
    );
    expect(r.aprova).toBe(false);
    expect(r.motivo).toMatch(/2 praças/);
    expect(r.motivo).toMatch(/sem valor de pedágio/);
  });

  it("valor zerado conta como não lançado", () => {
    const r = avaliar(sinais({ pedagio: { pracas: 1, valorInformado: 0, mediana: 80, amostra: 9 } }));
    expect(r.aprova).toBe(false);
    expect(r.motivo).toMatch(/1 praça/);
  });

  it("não aprova valor que foge da média do trajeto", () => {
    const r = avaliar(sinais({ pedagio: { pracas: 2, valorInformado: 8, mediana: 80, amostra: 9 } }));
    expect(r.aprova).toBe(false);
    expect(r.motivo).toMatch(/foge da média/);
    expect(r.motivo).toMatch(/R\$ 8,00/);
    expect(r.motivo).toMatch(/9 viagens/);
  });

  it("valor muito acima da média também não passa sozinho", () => {
    const r = avaliar(sinais({ pedagio: { pracas: 2, valorInformado: 400, mediana: 80, amostra: 9 } }));
    expect(r.aprova).toBe(false);
  });

  it("a régua é folgada: reajuste e desconto de tag não barram", () => {
    const r = avaliar(sinais({ pedagio: { pracas: 2, valorInformado: 100, mediana: 80, amostra: 9 } }));
    expect(r.aprova).toBe(true);
  });

  it("sem amostra a mediana não bloqueia — só o valor lançado importa", () => {
    // Trajeto novo não tem histórico de pedágio. O que interessava (passou por
    // praça, tem valor) já foi verificado; inventar régua em cima de 1 viagem
    // seria pior que não ter régua.
    const r = avaliar(sinais({ pedagio: { pracas: 2, valorInformado: 300, mediana: 80, amostra: 2 } }));
    expect(r.aprova).toBe(true);
    expect(r.resumo.join(" ")).toMatch(/R\$ 300,00 lançado/);
  });

  it("não saber se a rota tem praça impede a aprovação", () => {
    // `null` é "não perguntei" (sem geometria, roteador fora), não "não passa".
    // Tratar como zero aprovaria justamente a viagem sobre a qual se sabe menos.
    const r = avaliar(
      sinais({ pedagio: { pracas: null, valorInformado: 84, mediana: 80, amostra: 9 } }),
    );
    expect(r.aprova).toBe(false);
    expect(r.motivo).toMatch(/não deu pra saber/);
  });

  it("com a checagem desligada, pedágio não é olhado", () => {
    const r = avaliar(
      sinais({ pedagio: { pracas: null, valorInformado: null, mediana: null, amostra: 0 } }),
      { exigirPedagioCoerente: false },
    );
    expect(r.aprova).toBe(true);
  });
});

describe("o resumo que vai pro chat", () => {
  it("conta o que foi verificado, não só que passou", () => {
    const r = avaliar(sinais());
    expect(r.resumo).toHaveLength(2);
    expect(r.resumo.join(" ")).toMatch(/120,0 km/);
    expect(r.resumo.join(" ")).toMatch(/R\$ 84,00/);
  });

  it("quem não aprova não deixa resumo pela metade virar elogio", () => {
    const r = avaliar(
      sinais({ pedagio: { pracas: 3, valorInformado: null, mediana: null, amostra: 0 } }),
    );
    expect(r.aprova).toBe(false);
    // O km entrou no resumo antes de o pedágio reprovar — mas como não aprova,
    // nada disso chega ao chat.
    expect(r.motivo).toBeTruthy();
  });
});
