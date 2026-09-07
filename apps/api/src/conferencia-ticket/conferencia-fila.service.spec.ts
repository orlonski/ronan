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
    // As placas da frota vão junto no declarado: é o que deixa o comparador
    // distinguir "ticket de outro caminhão" de "não reconheci a placa".
    veiculo: { findMany: vi.fn().mockResolvedValue([{ placa: "AQF7758" }, { placa: "XYZ1234" }]) },
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
      placasConhecidas: ["AQF7758", "XYZ1234"],
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

/**
 * Reavaliar existe pra corrigir o passado quando a regra fica mais esperta.
 * Se o veredito mudar mas a viagem continuar presa em "Em conferência", quem
 * clicou conclui — com razão — que não funcionou.
 */
describe("recompararViagem — de graça, e desfazendo o que o robô fez", () => {
  /** Leitura guardada: placa Mercosul impressa no formato antigo. */
  const LEITURA = {
    ticket: "3174",
    toneladas: 35.14,
    data: "2026-08-22",
    placa: "ATN-3614",
    clienteNome: "TRIPOLONI",
    materialNome: "PÓ DE PEDRA",
    confianca: 0.93,
    julgamento: {
      numeroDocumento: { confere: "sim", porque: "" },
      toneladas: { confere: "sim", porque: "" },
      placa: { confere: "nao", porque: "o ticket é do ATN-3614" },
    },
  };

  const VIAGEM_MERCOSUL = { ...VIAGEM_OK, veiculo: { placa: "ATN3B14" } };

  function montarRecompara(
    conferencia: Record<string, unknown> | null,
    viagem: unknown = VIAGEM_MERCOSUL,
  ) {
    const updateConferencia = vi.fn();
    const updateManyConferencia = vi.fn();
    const updateManyViagem = vi.fn().mockResolvedValue({ count: 1 });
    const criarMensagem = vi.fn();
    const prisma = {
      conferenciaTicket: {
        findFirst: vi.fn().mockResolvedValue(conferencia),
        update: updateConferencia,
        updateMany: updateManyConferencia,
      },
      viagem: { findUnique: vi.fn().mockResolvedValue(viagem), updateMany: updateManyViagem },
      veiculo: { findMany: vi.fn().mockResolvedValue([{ placa: "ATN3B14" }]) },
      viagemMensagem: { create: criarMensagem },
    } as unknown as PrismaService;
    return {
      fila: new ConferenciaFilaService(prisma, config),
      updateConferencia,
      updateManyConferencia,
      updateManyViagem,
      criarMensagem,
    };
  }

  it("placa Mercosul lida como antiga passa a bater e a viagem sai da revisão", async () => {
    const m = montarRecompara({
      id: "c1",
      viagemId: "v1",
      leitura: LEITURA,
      veredito: "INCERTO",
      acao: "FILA_REVISAO",
    });

    const r = await comConta("conta-a", () => m.fila.recompararViagem("v1"));

    expect(r).toMatchObject({ recomparada: true, veredito: "BATE", mudou: true, reverteu: true });
    expect(m.updateManyViagem).toHaveBeenCalledOnce();
    const chamada = m.updateManyViagem.mock.calls[0][0];
    // Só desfaz o que o próprio robô escreveu, e nunca por cima de gente.
    expect(chamada.where).toMatchObject({
      id: "v1",
      status: StatusViagem.EM_CONFERENCIA,
      revisadoEm: null,
    });
    expect(chamada.data.status).toBe(StatusViagem.ENVIADA);
    // Fica registrado no chat da viagem: quem abrir depois entende o que houve.
    expect(m.criarMensagem).toHaveBeenCalledOnce();
  });

  it("compara contra o lançamento de AGORA, não contra o snapshot", async () => {
    const m = montarRecompara({
      id: "c1",
      viagemId: "v1",
      leitura: LEITURA,
      veredito: "INCERTO",
      acao: "FILA_REVISAO",
    });

    await comConta("conta-a", () => m.fila.recompararViagem("v1"));

    // O `declarado` regravado é o da viagem atual — é o que o card mostra como
    // "Lançado", e mostrar o valor velho ali foi a confusão que originou isto.
    expect(m.updateConferencia.mock.calls[0][0].data.declarado).toMatchObject({
      placa: "ATN3B14",
      ticket: "3174",
    });
  });

  it("não mexe na viagem quando o veredito continua pedindo humano", async () => {
    const m = montarRecompara(
      {
        id: "c1",
        viagemId: "v1",
        leitura: { ...LEITURA, placa: "XYZ1234" },
        veredito: "INCERTO",
        acao: "FILA_REVISAO",
      },
      VIAGEM_MERCOSUL,
    );

    const r = await comConta("conta-a", () => m.fila.recompararViagem("v1"));

    expect(r).toMatchObject({ veredito: "INCERTO", mudou: false, reverteu: false });
    expect(m.updateManyViagem).not.toHaveBeenCalled();
  });

  it("viagem nunca lida não vira erro — vira recado", async () => {
    const m = montarRecompara(null);
    const r = await comConta("conta-a", () => m.fila.recompararViagem("v1"));
    expect(r.recomparada).toBe(false);
    expect(r.motivo).toContain("ainda não foi lida");
  });
});

/**
 * Agrupar sem deixar abrir é meio caminho: a tela dizia "placa: 23x" e a única
 * saída era rolar a lista procurando quais eram.
 */
describe("listar — o filtro que abre os grupos do diagnóstico", () => {
  function montarLista() {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { conferenciaTicket: { findMany } } as unknown as PrismaService;
    return { fila: new ConferenciaFilaService(prisma, config), findMany };
  }

  const whereDe = async (filtro: Parameters<ConferenciaFilaService["listar"]>[0]) => {
    const { fila, findMany } = montarLista();
    await comConta("conta-a", () => fila.listar(filtro));
    return findMany.mock.calls[0][0].where;
  };

  it("sem filtro não recorta nada", async () => {
    expect(await whereDe({})).toEqual({});
  });

  it("campo com tipo procura só naquele lado", async () => {
    expect(await whereDe({ campo: "placa", tipo: "incerteza" })).toEqual({
      incertezas: { array_contains: [{ campo: "placa" }] },
    });
    expect(await whereDe({ campo: "toneladas", tipo: "divergencia" })).toEqual({
      divergencias: { array_contains: [{ campo: "toneladas" }] },
    });
  });

  it("campo sem tipo vale nos dois lados", async () => {
    // Quem clica em "placa" quer as conferências que falam de placa, não uma
    // metade delas.
    expect(await whereDe({ campo: "placa" })).toEqual({
      OR: [
        { divergencias: { array_contains: [{ campo: "placa" }] } },
        { incertezas: { array_contains: [{ campo: "placa" }] } },
      ],
    });
  });

  it("veredito e campo se somam", async () => {
    expect(await whereDe({ veredito: "INCERTO", campo: "placa", tipo: "incerteza" })).toEqual({
      veredito: "INCERTO",
      incertezas: { array_contains: [{ campo: "placa" }] },
    });
  });

  it("limite tem teto e piso", async () => {
    const { fila, findMany } = montarLista();
    await comConta("conta-a", () => fila.listar({ limite: 9_999 }));
    expect(findMany.mock.calls[0][0].take).toBe(200);
    await comConta("conta-a", () => fila.listar({ limite: 0 }));
    expect(findMany.mock.calls[1][0].take).toBe(1);
  });
});
