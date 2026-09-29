import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { contaAtual } from "../../common/conta/conta-context";
import { ConferenciaAlcanceService, telefonesParaBusca } from "./conferencia-alcance.service";
import { SugestoesGestorService } from "./sugestoes-gestor.service";

const AGORA = new Date("2026-09-28T09:30:00Z");
const h = (horasAtras: number) => new Date(AGORA.getTime() - horasAtras * 3_600_000);

function montar(
  opts: {
    motoristas?: Record<string, unknown>[];
    mensagens?: Record<string, unknown>[];
    cfg?: Record<string, unknown> | null;
    alvos?: Record<string, unknown>[];
  } = {},
) {
  const contas: (string | undefined)[] = [];
  const update = vi.fn(async (_a: { where: { id: string }; data: Record<string, unknown> }) => {
    contas.push(contaAtual()?.contaId ?? undefined);
    return {};
  });
  const updateMany = vi.fn(async (_a: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({ count: 1 }));
  const findManyMotorista = vi.fn(async (a: { where: Record<string, unknown> }) =>
    "telefone" in a.where && (a.where.telefone as { in?: string[] })?.in ? (opts.alvos ?? []) : (opts.motoristas ?? []),
  );
  const findManyMsg = vi.fn(async (_a: { where: { criadoEm: { gte: Date } } }) => opts.mensagens ?? []);
  const prisma = {
    moduloContratado: { findMany: vi.fn(async () => [{ chave: "conferencia", vigenteDe: null, vigenteAte: null }]) },
    configuracaoConferenciaDiaria: {
      findFirst: vi.fn(async () =>
        opts.cfg === null ? null : { ativo: true, mensagensParaSuspeitar: 3, diasParaSuspeitar: 7, ...opts.cfg },
      ),
    },
    motorista: { findMany: findManyMotorista, update, updateMany, findUnique: vi.fn(async () => ({ id: "m1", whatsappInalcancavelEm: AGORA, whatsappFalhasSeguidas: 3 })) },
    whatsappMensagem: { findMany: findManyMsg },
  };
  const encerrar = vi.fn(async () => 1);
  const abrir = vi.fn(async () => ({ id: "s", criada: true }));
  const notificar = vi.fn(async () => {});
  const log = vi.fn(async () => {});
  const svc = new ConferenciaAlcanceService(
    prisma as never,
    { encerrar, abrir, notificar } as never,
    { log } as never,
  );
  return { svc, prisma, update, updateMany, encerrar, abrir, notificar, log, contas, findManyMsg };
}

const mot = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  nome: "João",
  telefone: "42991088125",
  whatsappFalhasSeguidas: 0,
  whatsappSemEntregaDesde: null,
  whatsappUltimaEntregaEm: null,
  whatsappReverificadoEm: null,
  ...over,
});
const silenciosas = [
  { statusEntrega: "sent", idExterno: "w1", criadoEm: h(10) },
  { statusEntrega: "sent", idExterno: "w2", criadoEm: h(30) },
  { statusEntrega: null, idExterno: "w3", criadoEm: h(50) },
];

describe("contador de falhas (webhook)", () => {
  it("código da allowlist incrementa o contador do número (e carimba desde quando)", async () => {
    const t = montar();
    expect(await t.svc.aoFalhar("5542991088125", 131026)).toBe(true);
    expect(t.updateMany.mock.calls[0]![0].data).toEqual({ whatsappFalhasSeguidas: { increment: 1 } });
    expect(t.updateMany.mock.calls[1]![0].where).toMatchObject({ whatsappSemEntregaDesde: null });
  });

  it.each([132001, 130429, 131047, 131042, 190, null])("falha NOSSA (%s) não conta", async (codigo) => {
    const t = montar();
    expect(await t.svc.aoFalhar("5542991088125", codigo)).toBe(false);
    expect(t.updateMany).not.toHaveBeenCalled();
  });

  it("procura o número nas grafias com e sem o nono dígito", async () => {
    const t = montar();
    await t.svc.aoFalhar("554291088125", 131026);
    const onde = t.updateMany.mock.calls[0]![0].where.telefone as { in: string[] };
    expect(onde.in).toEqual(expect.arrayContaining(["554291088125", "5542991088125", "4291088125", "42991088125"]));
    expect(telefonesParaBusca("42991088125")).toContain("5542991088125");
  });
});

describe("volta a OK sozinho", () => {
  it("entrega confirmada zera contador, limpa a suspeita e fecha a sugestão — na conta do motorista", async () => {
    const t = montar({ alvos: [{ id: "m1", contaId: "c7", whatsappInalcancavelEm: AGORA, whatsappFalhasSeguidas: 4 }] });
    await t.svc.aoEntregar("5542991088125");
    const u = t.update.mock.calls[0]![0];
    expect(u.data).toMatchObject({
      whatsappFalhasSeguidas: 0,
      whatsappSemEntregaDesde: null,
      whatsappInalcancavelEm: null,
      whatsappUltimaEntregaEm: expect.any(Date),
    });
    expect(t.contas).toEqual(["c7"]);
    expect(t.encerrar).toHaveBeenCalledWith({ motoristaId: "m1", tipo: "WHATSAPP_INALCANCAVEL" }, "RESOLVIDA_SOZINHA", expect.any(String));
  });

  it("resposta do motorista também limpa (mas não carimba entrega)", async () => {
    const t = montar({ alvos: [{ id: "m1", contaId: "c7", whatsappInalcancavelEm: AGORA, whatsappFalhasSeguidas: 0 }] });
    await t.svc.aoResponder("5542991088125");
    expect((t.update.mock.calls[0]![0].data as Record<string, unknown>).whatsappUltimaEntregaEm).toBeUndefined();
    expect(t.encerrar).toHaveBeenCalled();
  });

  it("resposta de quem está tudo bem não escreve nada", async () => {
    const t = montar({ alvos: [{ id: "m1", contaId: "c7", whatsappInalcancavelEm: null, whatsappFalhasSeguidas: 0 }] });
    await t.svc.aoResponder("5542991088125");
    expect(t.update).not.toHaveBeenCalled();
  });
});

describe("cron do silencioso", () => {
  it("N mensagens da Meta seguidas sem entrega: vira SUSPEITO, UMA sugestão, UMA notificação", async () => {
    const t = montar({ motoristas: [mot(), mot({ id: "m2", nome: "Pedro" })], mensagens: silenciosas });
    const novos = await t.svc.varrerConta("c1", AGORA);
    expect(novos).toEqual(["m1", "m2"]);
    expect(t.update.mock.calls[0]![0].data).toMatchObject({ whatsappInalcancavelEm: AGORA });
    expect(t.abrir).toHaveBeenCalledTimes(2);
    expect(t.abrir).toHaveBeenCalledWith(expect.objectContaining({ tipo: "WHATSAPP_INALCANCAVEL", motoristaId: "m1" }));
    // agrupado: uma por varredura, não uma por motorista
    expect(t.notificar).toHaveBeenCalledOnce();
  });

  it("N e a janela vêm da config, não do código", async () => {
    const t = montar({ motoristas: [mot()], mensagens: silenciosas, cfg: { mensagensParaSuspeitar: 4, diasParaSuspeitar: 3 } });
    expect(await t.svc.varrerConta("c1", AGORA)).toEqual([]); // só 3 mensagens, config pede 4
    const q = t.findManyMsg.mock.calls[0]![0];
    expect(q.where.criadoEm.gte.getTime()).toBe(AGORA.getTime() - 3 * 86_400_000);
  });

  it("uma mensagem entregue no meio: não é suspeito", async () => {
    const t = montar({
      motoristas: [mot()],
      mensagens: [silenciosas[0], { statusEntrega: "delivered", idExterno: "w9", criadoEm: h(20) }, silenciosas[2]],
    });
    expect(await t.svc.varrerConta("c1", AGORA)).toEqual([]);
    expect(t.abrir).not.toHaveBeenCalled();
  });

  it("contador de falhas de alcance >= N também suspeita, sem olhar as mensagens", async () => {
    const t = montar({ motoristas: [mot({ whatsappFalhasSeguidas: 3 })] });
    expect(await t.svc.varrerConta("c1", AGORA)).toEqual(["m1"]);
    expect(t.findManyMsg).not.toHaveBeenCalled();
  });

  it("depois do 'reverificar', o que veio antes não conta", async () => {
    const t = montar({ motoristas: [mot({ whatsappReverificadoEm: h(5) })], mensagens: silenciosas });
    expect(await t.svc.varrerConta("c1", AGORA)).toEqual([]);
  });

  it("conferência desligada na empresa: não varre", async () => {
    const t = montar({ motoristas: [mot()], mensagens: silenciosas, cfg: { ativo: false } });
    expect(await t.svc.varrerConta("c1", AGORA)).toEqual([]);
  });

  it("NUNCA escreve em ativo, status, bloqueadoAte ou aceitaWhatsapp", async () => {
    const t = montar({ motoristas: [mot()], mensagens: silenciosas });
    await t.svc.varrerConta("c1", AGORA);
    for (const c of [...t.update.mock.calls, ...t.updateMany.mock.calls]) {
      const campos = Object.keys((c[0] as { data: Record<string, unknown> }).data);
      for (const proibido of ["ativo", "status", "bloqueadoAte", "aceitaWhatsapp"]) {
        expect(campos).not.toContain(proibido);
      }
    }
  });
});

describe("reverificar", () => {
  it("limpa a suspeita, os contadores e ignora mensagens antigas; fecha a sugestão; audita", async () => {
    const t = montar();
    await t.svc.reverificar("m1", "u1");
    expect(t.update.mock.calls[0]![0].data).toMatchObject({
      whatsappInalcancavelEm: null,
      whatsappFalhasSeguidas: 0,
      whatsappSemEntregaDesde: null,
      whatsappReverificadoEm: expect.any(Date),
    });
    expect(t.encerrar).toHaveBeenCalledWith({ motoristaId: "m1", tipo: "WHATSAPP_INALCANCAVEL" }, "RECUSADA", expect.any(String));
    expect(t.log).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: "u1", entidadeId: "m1" }));
  });
});

describe("SugestoesGestorService", () => {
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });

  it("uma sugestão aberta por motorista e tipo: repetir devolve a existente (e não cria outra)", async () => {
    const create = vi.fn().mockRejectedValueOnce(p2002());
    const findFirst = vi.fn(async (_a: unknown) => ({ id: "existente" }));
    const s = new SugestoesGestorService({ sugestaoGestor: { create, findFirst } } as never, {} as never);
    const r = await s.abrir({ tipo: "INATIVAR_VINCULO", motoristaId: "m1", resumo: "x", evidencia: {} });
    expect(r).toEqual({ id: "existente", criada: false });
    expect(findFirst).toHaveBeenCalledWith({ where: { chaveViva: "m1:INATIVAR_VINCULO" }, select: { id: true } });
  });

  it("a chave viva é motorista:tipo", async () => {
    const create = vi.fn(async (_a: { data: { chaveViva: string } }) => ({ id: "novo" }));
    const s = new SugestoesGestorService({ sugestaoGestor: { create } } as never, {} as never);
    const r = await s.abrir({ tipo: "MOTORISTA_PAROU_WHATSAPP", motoristaId: "m1", resumo: "x", evidencia: {} });
    expect(r).toEqual({ id: "novo", criada: true });
    expect(create.mock.calls[0]![0].data.chaveViva).toBe("m1:MOTORISTA_PAROU_WHATSAPP");
  });

  it("erro que não é de duplicidade sobe", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("banco"));
    const s = new SugestoesGestorService({ sugestaoGestor: { create } } as never, {} as never);
    await expect(s.abrir({ tipo: "RESPOSTA_AMBIGUA", motoristaId: "m1", resumo: "x", evidencia: {} })).rejects.toThrow("banco");
  });

  it("notificar usa o sino com a permissão da tela e nunca lança", async () => {
    const disparar = vi.fn().mockRejectedValueOnce(new Error("x"));
    const s = new SugestoesGestorService({} as never, { disparar } as never);
    await expect(s.notificar("t", "c", { motoristaId: "m1" })).resolves.toBeUndefined();
    expect(disparar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "conferencia-diaria", permissao: "conferencia-diaria.ver" }));
  });

  it("volta a lançar: INATIVAR_VINCULO e LANCAR_VIAGEM_FALTANTE viram RESOLVIDA_SOZINHA", async () => {
    const findMany = vi.fn(async () => [{ id: "s1", motoristaId: "m1", criadaEm: h(48) }, { id: "s2", motoristaId: "m2", criadaEm: h(48) }]);
    const findFirst = vi.fn(async (a: { where: { motoristaId: string } }) => (a.where.motoristaId === "m1" ? { id: "v" } : null));
    const updateMany = vi.fn(async (_a: { where: { id: string; status: string }; data: { status: string; chaveViva: null } }) => ({ count: 1 }));
    const s = new SugestoesGestorService(
      { sugestaoGestor: { findMany, updateMany }, viagem: { findFirst } } as never,
      {} as never,
    );
    const r = await s.manter(AGORA);
    expect(r.resolvidas).toBe(1);
    const c = updateMany.mock.calls[0]![0];
    expect(c.where).toMatchObject({ id: "s1", status: "ABERTA" });
    expect(c.data).toMatchObject({ status: "RESOLVIDA_SOZINHA", chaveViva: null });
  });
});
