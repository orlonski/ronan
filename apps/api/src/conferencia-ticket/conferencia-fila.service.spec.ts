import { describe, it, expect, vi } from "vitest";
import { Prisma, StatusViagem } from "@prisma/client";
import { ConferenciaFilaService, atrasoBackoffMs } from "./conferencia-fila.service";
import { comConta } from "../common/conta/conta-context";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConferenciaConfig } from "./conferencia.config";

const config = { timeoutMs: 120_000 } as ConferenciaConfig;

/** Viagem que pode ser conferida — base pra variar um atributo por vez. */
const VIAGEM_OK = {
  id: "v1",
  status: StatusViagem.ENVIADA,
  revisadoEm: null,
  ticket: "3174",
  toneladas: new Prisma.Decimal("35.14"),
  data: new Date("2026-08-22"),
  veiculo: { placa: "AQF7758" },
  cliente: { nome: "TRIPOLONI" },
  material: { nome: "PÓ DE PEDRA" },
  fotos: [{ id: "f1", storageKey: "cnt/tickets/x.jpg" }],
  _count: { matchesFechamento: 0 },
};

function montar(viagem: unknown, criarLanca?: unknown, liberada = true) {
  const create = vi.fn();
  if (criarLanca) create.mockRejectedValue(criarLanca);
  const prisma = {
    conta: { findUnique: vi.fn().mockResolvedValue({ iaConferenciaTicket: liberada }) },
    viagem: { findUnique: vi.fn().mockResolvedValue(viagem) },
    conferenciaTicket: { create },
  } as unknown as PrismaService;
  return { fila: new ConferenciaFilaService(prisma, config), create };
}

const enfileirar = (viagem: unknown, erro?: unknown, liberada = true) => {
  const { fila, create } = montar(viagem, erro, liberada);
  return comConta("conta-a", () => fila.enfileirar("v1", "create")).then(() => create);
};

describe("enfileirar", () => {
  it("viagem completa com foto entra na fila", async () => {
    const create = await enfileirar(VIAGEM_OK);
    expect(create).toHaveBeenCalledOnce();
    const dados = create.mock.calls[0][0].data;
    expect(dados.viagemAtiva).toBe("v1");
    expect(dados.ticketFotoId).toBe("f1");
    expect(dados.declarado).toMatchObject({ ticket: "3174", placa: "AQF7758" });
  });

  it("congela o que o motorista declarou, pra comparar contra isso depois", async () => {
    const create = await enfileirar(VIAGEM_OK);
    expect(create.mock.calls[0][0].data.declarado).toMatchObject({
      toneladas: 35.14,
      clienteNome: "TRIPOLONI",
      materialNome: "PÓ DE PEDRA",
      pesoConferivel: true,
    });
  });

  it("viagem sem foto não entra — não há o que conferir", async () => {
    const create = await enfileirar({ ...VIAGEM_OK, fotos: [] });
    expect(create).not.toHaveBeenCalled();
  });

  it("viagem ainda em andamento não entra", async () => {
    const create = await enfileirar({ ...VIAGEM_OK, status: StatusViagem.EM_ANDAMENTO });
    expect(create).not.toHaveBeenCalled();
  });

  it("humano já conferiu: robô não passa por cima", async () => {
    const create = await enfileirar({ ...VIAGEM_OK, revisadoEm: new Date() });
    expect(create).not.toHaveBeenCalled();
  });

  it("status que já é decisão humana também barra", async () => {
    expect(await enfileirar({ ...VIAGEM_OK, status: StatusViagem.DIVERGENTE })).not.toHaveBeenCalled();
    expect(await enfileirar({ ...VIAGEM_OK, status: StatusViagem.OK })).not.toHaveBeenCalled();
  });

  it("viagem já em fechamento não é mexida", async () => {
    const create = await enfileirar({ ...VIAGEM_OK, _count: { matchesFechamento: 1 } });
    expect(create).not.toHaveBeenCalled();
  });

  it("AGUARDANDO_PESO entra, mas com o peso marcado como não conferível", async () => {
    // Entra porque ticket, data e placa já dão pra conferir. O peso chega
    // depois, no completarPeso, e aí a viagem é reenfileirada.
    const create = await enfileirar({
      ...VIAGEM_OK,
      status: StatusViagem.AGUARDANDO_PESO,
      toneladas: null,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data.declarado.pesoConferivel).toBe(false);
  });

  it("corrida no índice único é silenciosa — já há conferência viva", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6",
    });
    // O que importa: não lança. `void enfileirar(...)` com promise rejeitada
    // derrubaria o processo do lançamento do motorista.
    await expect(enfileirar(VIAGEM_OK, p2002)).resolves.toBeDefined();
  });

  it("erro inesperado também não escapa — o lançamento não pode cair por isso", async () => {
    await expect(enfileirar(VIAGEM_OK, new Error("banco fora"))).resolves.toBeDefined();
  });

  it("viagem que não existe não quebra nada", async () => {
    const create = await enfileirar(null);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("atrasoBackoffMs", () => {
  it("cresce 30s → 60s → 120s", () => {
    expect(atrasoBackoffMs(1)).toBe(30_000);
    expect(atrasoBackoffMs(2)).toBe(60_000);
    expect(atrasoBackoffMs(3)).toBe(120_000);
  });

  it("tem teto de 15 min", () => {
    expect(atrasoBackoffMs(20)).toBe(900_000);
  });
});

describe("finalizar", () => {
  it("libera a viagem pra uma conferência futura", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = { conferenciaTicket: { update } } as unknown as PrismaService;
    const fila = new ConferenciaFilaService(prisma, config);

    await fila.finalizar(
      { id: "j1", iniciadoEm: new Date(Date.now() - 3000), criadoEm: new Date() } as never,
      { status: "CONCLUIDA" },
    );

    const dados = update.mock.calls[0][0].data;
    // Sem isto o índice único bloquearia toda conferência seguinte da viagem.
    expect(dados.viagemAtiva).toBeNull();
    expect(dados.duracaoMs).toBeGreaterThan(0);
  });
});

describe("trava da plataforma", () => {
  it("empresa não liberada não gera job — nem entra na tabela", async () => {
    // Barrado aqui, e não no worker: senão a fila encheria de trabalho que
    // nunca ia rodar, e o painel mostraria uma fila que não anda.
    const create = await enfileirar(VIAGEM_OK, undefined, false);
    expect(create).not.toHaveBeenCalled();
  });

  it("empresa liberada gera normalmente", async () => {
    const create = await enfileirar(VIAGEM_OK, undefined, true);
    expect(create).toHaveBeenCalledOnce();
  });
});
