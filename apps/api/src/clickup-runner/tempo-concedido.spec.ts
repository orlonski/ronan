import { describe, it, expect } from "vitest";
import { ConfigService } from "@nestjs/config";
import { RunnerConfig } from "./runner.config";

/**
 * O relógio da demanda.
 *
 * Isto existe porque a primeira versão do carrossel prometia 40 minutos no
 * texto do briefing e era cortada aos 15 pelo worker: o número morava no prompt
 * e o relógio em outro lugar. O agente planejou pro número errado, produziu o
 * carrossel inteiro e não entregou nada.
 *
 * Agora há uma régua só, e ela tem teste — porque a falha desse tipo é calada:
 * nada quebra, ninguém vê, e o trabalho some no estouro.
 */
const config = (env: Record<string, string> = {}) =>
  new RunnerConfig({ get: (k: string) => env[k] } as unknown as ConfigService);

describe("RunnerConfig.tempoConcedido", () => {
  it("sem pedido, vale o padrão", () => {
    expect(config().tempoConcedido()).toBe(15 * 60_000);
  });

  it("concede o que a demanda pede, quando cabe", () => {
    expect(config().tempoConcedido(40 * 60_000)).toBe(40 * 60_000);
  });

  it("pedir não é mandar: nunca acima do teto", () => {
    expect(config().tempoConcedido(4 * 60 * 60_000)).toBe(45 * 60_000);
  });

  it("pedir menos que o padrão não encurta o relógio", () => {
    expect(config().tempoConcedido(60_000)).toBe(15 * 60_000);
  });

  it("pedido que não é número vira o padrão, não NaN", () => {
    expect(config().tempoConcedido(Number.NaN)).toBe(15 * 60_000);
    expect(config().tempoConcedido(undefined)).toBe(15 * 60_000);
  });

  it("o teto é configurável — e continua limitando", () => {
    const c = config({ CLICKUP_RUNNER_TIMEOUT_MAX_MS: String(20 * 60_000) });
    expect(c.tempoConcedido(40 * 60_000)).toBe(20 * 60_000);
  });

  it("teto menor que o padrão não deixa a demanda abaixo do padrão", () => {
    // Config incoerente (teto 5min, padrão 15min) não pode virar relógio de 5
    // minutos para quem pediu mais: o padrão é piso, sempre.
    const c = config({
      CLICKUP_RUNNER_TIMEOUT_MS: String(15 * 60_000),
      CLICKUP_RUNNER_TIMEOUT_MAX_MS: String(5 * 60_000),
    });
    expect(c.tempoConcedido(40 * 60_000)).toBe(15 * 60_000);
  });
});
