import { describe, expect, it } from "vitest";
import {
  avaliarPlano,
  diasParaIndicar,
  situacaoPneu,
  type PlanoParaAvaliar,
} from "./manutencao";

const HOJE = new Date("2026-06-10T12:00:00Z");

function plano(over: Partial<PlanoParaAvaliar> = {}): PlanoParaAvaliar {
  return {
    id: "p1",
    descricao: "Troca de óleo",
    intervaloKm: 10000,
    intervaloDias: null,
    ultimoOdometro: 100000,
    ultimaEm: null,
    ...over,
  };
}

describe("avaliarPlano — por km", () => {
  it("em dia quando falta muito", () => {
    const r = avaliarPlano(plano(), { odometro: 103000, hoje: HOJE });
    expect(r.situacao).toBe("EM_DIA");
    expect(r.kmRestante).toBe(7000);
  });

  it("avisa quando está chegando", () => {
    // 10% de 10.000 = 1.000, mas o teto é 500. Faltando 400 km, avisa.
    const r = avaliarPlano(plano(), { odometro: 109600, hoje: HOJE });
    expect(r.situacao).toBe("PROXIMO");
    expect(r.motivo).toBe("KM");
  });

  it("não avisa cedo demais em intervalo grande", () => {
    // 10% de 40.000 seriam 4.000 km de antecedência — ruído que ninguém olha.
    // O teto de 500 mantém o aviso perto do evento.
    const r = avaliarPlano(plano({ intervaloKm: 40000 }), { odometro: 138000, hoje: HOJE });
    expect(r.situacao).toBe("EM_DIA");
  });

  it("vencido quando passou do km", () => {
    const r = avaliarPlano(plano(), { odometro: 111000, hoje: HOJE });
    expect(r.situacao).toBe("VENCIDO");
    expect(r.kmRestante).toBe(-1000);
  });
});

describe("avaliarPlano — por tempo", () => {
  const porTempo = plano({ intervaloKm: null, intervaloDias: 180, ultimoOdometro: null, ultimaEm: new Date("2026-01-10") });

  it("conta os dias desde a última", () => {
    const r = avaliarPlano(porTempo, { odometro: null, hoje: HOJE });
    expect(r.diasRestante).toBe(29);
    expect(r.situacao).toBe("EM_DIA");
  });

  it("vencido quando passou do prazo", () => {
    const r = avaliarPlano(
      { ...porTempo, ultimaEm: new Date("2025-06-10") },
      { odometro: null, hoje: HOJE },
    );
    expect(r.situacao).toBe("VENCIDO");
    expect(r.motivo).toBe("TEMPO");
  });
});

describe("avaliarPlano — o que vencer primeiro", () => {
  const misto = plano({ intervaloKm: 10000, intervaloDias: 180, ultimaEm: new Date("2026-01-10") });

  it("vence por km mesmo com tempo sobrando", () => {
    // Rodou muito: estourou o km antes do prazo.
    const r = avaliarPlano(misto, { odometro: 111000, hoje: HOJE });
    expect(r.situacao).toBe("VENCIDO");
    expect(r.motivo).toBe("KM");
  });

  it("vence por tempo mesmo com km sobrando", () => {
    // Roda pouco: o tempo passou antes do km chegar.
    const r = avaliarPlano(
      { ...misto, ultimaEm: new Date("2025-06-10") },
      { odometro: 101000, hoje: HOJE },
    );
    expect(r.situacao).toBe("VENCIDO");
    expect(r.motivo).toBe("TEMPO");
  });
});

describe("avaliarPlano — sem referência", () => {
  it("plano novo não nasce vencido", () => {
    // Marcar tudo como vencido no dia da adoção faria a tela nascer vermelha e
    // ser ignorada pra sempre.
    const r = avaliarPlano(
      plano({ ultimoOdometro: null, ultimaEm: null }),
      { odometro: 150000, hoje: HOJE },
    );
    expect(r.situacao).toBe("SEM_REFERENCIA");
  });

  it("sem odômetro do caminhão também não dá pra julgar", () => {
    const r = avaliarPlano(plano(), { odometro: null, hoje: HOJE });
    expect(r.situacao).toBe("SEM_REFERENCIA");
  });
});

describe("situacaoPneu", () => {
  it("sulco bom é OK", () => {
    expect(situacaoPneu(8)).toBe("OK");
  });

  it("avisa antes do limite legal", () => {
    // Em 3mm dá tempo de programar a troca; em 1,6mm já é tarde.
    expect(situacaoPneu(2.5)).toBe("ATENCAO");
  });

  it("no limite legal já é crítico", () => {
    // 1,6mm é multa e retenção do veículo, não recomendação.
    expect(situacaoPneu(1.6)).toBe("CRITICO");
    expect(situacaoPneu(1.2)).toBe("CRITICO");
  });

  it("sem medição não inventa situação", () => {
    expect(situacaoPneu(null)).toBe("SEM_MEDICAO");
  });
});

describe("diasParaIndicar", () => {
  it("conta os dias até o prazo", () => {
    expect(diasParaIndicar(new Date("2026-06-20"), HOJE)).toBe(10);
  });

  it("prazo vencido dá negativo", () => {
    // Perdeu: a multa vira do proprietário, com pontos no CNPJ.
    expect(diasParaIndicar(new Date("2026-06-01"), HOJE)).toBe(-9);
  });

  it("sem prazo devolve null", () => {
    expect(diasParaIndicar(null, HOJE)).toBeNull();
  });
});
