import { describe, expect, it, vi } from "vitest";
import { comConta } from "../common/conta/conta-context";
import { ViagensMotoristaService } from "./viagens.service";

/**
 * O motorista corrige os dados que a conferência apontou — e só esses.
 *
 * O ponto do fluxo é a reanálise automática: corrigiu, a viagem volta sozinha
 * pra conferência. Manteve e explicou, quem decide é gente (reler a mesma foto
 * daria a mesma resposta).
 */

const VIAGEM = {
  id: "v1",
  motoristaId: "mot1",
  status: "DIVERGENTE",
  tipoDivergencia: "DADOS_DIVERGENTES",
  camposDivergentes: ["toneladas", "placa"],
  ticket: "3174",
  toneladas: 30,
  data: new Date("2026-09-20T00:00:00.000Z"),
  veiculoId: "vei1",
  veiculo: { placa: "ABC1D23" },
  clienteId: "cli1",
  cliente: { nome: "Obra A", empresaId: "emp1" },
  materialId: "mat1",
  material: { nome: "Brita" },
};

function montar(viagem: Record<string, unknown> = VIAGEM) {
  const update = vi.fn(async () => ({}));
  const enfileirar = vi.fn(async () => undefined);
  const recalcularSeguro = vi.fn(async () => undefined);
  const criarMensagem = vi.fn(async () => ({}));
  const prisma = {
    viagem: { findUnique: async () => viagem, update },
    veiculo: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "vei2" ? { placa: "XYZ9A87" } : null) },
    cliente: { findUnique: async () => null },
    material: { findUnique: async () => null },
    motorista: { findUnique: async () => ({ nome: "Joao" }) },
  };
  const nada = new Proxy({}, { get: () => async () => undefined }) as never;
  const service = new ViagensMotoristaService(
    prisma as never,
    nada, // uploads
    nada, // validacao
    nada, // auditoria
    nada, // eventos
    nada, // roteamento
    nada, // inbox
    nada, // kmReprocessamento
    nada, // avisos
    nada, // kmAtipico
    { enfileirar } as never,
    { recalcularSeguro } as never,
    nada, // programacao
    { criar: criarMensagem } as never,
    nada, // resgates
  );
  vi.spyOn(service, "detalhe").mockResolvedValue({} as never);
  return { service, update, enfileirar, recalcularSeguro, criarMensagem };
}

const emConta = <T>(fn: () => Promise<T>) => comConta("conta1", fn);

describe("corrigir dados divergentes", () => {
  it("corrige o peso, limpa a divergência e volta pra conferência automática", async () => {
    const m = montar();
    await emConta(() => m.service.corrigirDadosDivergentes("mot1", "v1", { toneladas: 35.5 }));

    const escrito = (m.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(escrito).toMatchObject({
      toneladas: 35.5,
      status: "AJUSTADA",
      tipoDivergencia: null,
      camposDivergentes: [],
      revisadoEm: null,
    });
    expect(m.enfileirar).toHaveBeenCalledWith("v1", "correcao-motorista");
    // Peso entra no preço.
    expect(m.recalcularSeguro).toHaveBeenCalledWith("v1");
    const msg = (m.criarMensagem.mock.calls[0] as unknown as [{ texto: string }])[0].texto;
    expect(msg).toContain("Toneladas de 30,00 t para 35,50 t");
  });

  it("troca a placa pelo veículo escolhido", async () => {
    const m = montar();
    await emConta(() => m.service.corrigirDadosDivergentes("mot1", "v1", { veiculoId: "vei2" }));
    const escrito = (m.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(escrito.veiculo).toEqual({ connect: { id: "vei2" } });
    // Placa não entra no preço.
    expect(m.recalcularSeguro).not.toHaveBeenCalled();
    expect(m.enfileirar).toHaveBeenCalled();
  });

  it("ignora campo que não foi apontado", async () => {
    const m = montar();
    await expect(
      emConta(() => m.service.corrigirDadosDivergentes("mot1", "v1", { ticket: "9999" })),
    ).rejects.toThrow(/explique/);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("manter o lançamento exige explicação e NÃO relê a foto", async () => {
    const m = montar();
    await emConta(() =>
      m.service.corrigirDadosDivergentes("mot1", "v1", { justificativa: "O ticket está certo, a foto que cortou" }),
    );
    const escrito = (m.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(escrito.status).toBe("AJUSTADA");
    // A decisão continua com quem marcou.
    expect(escrito).not.toHaveProperty("revisadoEm");
    expect(m.enfileirar).not.toHaveBeenCalled();
  });

  it("veículo que sumiu do cadastro é 400, nunca 500", async () => {
    const m = montar();
    await expect(
      emConta(() => m.service.corrigirDadosDivergentes("mot1", "v1", { veiculoId: "sumiu" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("viagem que não está aguardando correção de dados é 409", async () => {
    const m = montar({ ...VIAGEM, tipoDivergencia: "OUTRO" });
    await expect(
      emConta(() => m.service.corrigirDadosDivergentes("mot1", "v1", { toneladas: 35 })),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("viagem de outro motorista é 403", async () => {
    const m = montar();
    await expect(
      emConta(() => m.service.corrigirDadosDivergentes("outro", "v1", { toneladas: 35 })),
    ).rejects.toMatchObject({ status: 403 });
  });
});
