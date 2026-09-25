import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O OSRM leva o ponto pra estrada mais próxima QUE ELE CONHECE, sem limite de
// distância. Com o mapa só do Sul, um par em SP/MG voltava "Ok" com rota no
// norte do Paraná. A trava recusa quando o encaixe passa do teto.

const rotaOk = (distanciasEncaixe: number[]) => ({
  code: "Ok",
  routes: [{ distance: 130_000, duration: 6000, geometry: "abc" }],
  waypoints: distanciasEncaixe.map((distance) => ({ distance })),
});

describe("RoteamentoService — cobertura do mapa", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.OSRM_URL = "http://osrm";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function servico() {
    const { RoteamentoService } = await import("./roteamento.service");
    return new RoteamentoService({} as never);
  }
  const responder = (body: unknown) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => body });

  it("ponto encaixado perto da estrada: devolve a rota", async () => {
    responder(rotaOk([12, 850]));
    const r = await (await servico()).calcularEntreCoordenadas(
      { lat: -25.43, lng: -49.27 },
      { lat: -26.3, lng: -48.85 },
    );
    expect(r).toMatchObject({ km: "130.00", geometria: "abc" });
  });

  it("ponto fora do mapa (encaixe de centenas de km): recusa com fora da cobertura", async () => {
    responder(rotaOk([15, 240_000]));
    const r = await (await servico()).calcularEntreCoordenadas(
      { lat: -25.43, lng: -49.27 },
      { lat: -19.92, lng: -43.94 },
    );
    expect(r.km).toBeNull();
    expect("erro" in r && r.erro).toMatch(/fora da área do mapa/);
  });

  it("resposta sem waypoints: deixa passar como antes", async () => {
    responder({ code: "Ok", routes: [{ distance: 1000, duration: 60, geometry: "x" }] });
    const r = await (await servico()).calcularEntreCoordenadas(
      { lat: -25.43, lng: -49.27 },
      { lat: -25.44, lng: -49.28 },
    );
    expect(r.km).toBe("1.00");
  });
});
