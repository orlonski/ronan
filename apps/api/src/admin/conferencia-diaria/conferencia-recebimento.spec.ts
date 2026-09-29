import { describe, expect, it, vi } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConferenciaDiariaService } from "./conferencia-diaria.service";

const AGORA = new Date("2026-09-29T15:00:00Z");
const USER = { id: "u1" };

type Linha = {
  id: string;
  receberConferenciaDiaria: boolean;
  conferenciaDesligadaEm: Date | null;
  conferenciaDesligadaOrigem: string | null;
  conferenciaDesligadaPorId: string | null;
  conferenciaDesligadaMotivo: string | null;
  conferenciaDesligadaPor: { id: string; nome: string } | null;
};

const LIGADA: Linha = {
  id: "m1",
  receberConferenciaDiaria: true,
  conferenciaDesligadaEm: null,
  conferenciaDesligadaOrigem: null,
  conferenciaDesligadaPorId: null,
  conferenciaDesligadaMotivo: null,
  conferenciaDesligadaPor: null,
};
const PELO_MOTORISTA: Linha = {
  ...LIGADA,
  receberConferenciaDiaria: false,
  conferenciaDesligadaEm: new Date("2026-09-20T12:00:00Z"),
  conferenciaDesligadaOrigem: "MOTORISTA",
};
const PELO_PAINEL: Linha = {
  ...LIGADA,
  receberConferenciaDiaria: false,
  conferenciaDesligadaEm: new Date("2026-09-25T12:00:00Z"),
  conferenciaDesligadaOrigem: "PAINEL",
  conferenciaDesligadaPorId: "u9",
  conferenciaDesligadaPor: { id: "u9", nome: "Ana" },
};

function montar(atual: Linha | null) {
  const update = vi.fn(async (a: { data: Record<string, any> }) => {
    const d = a.data;
    const ligou = d.receberConferenciaDiaria === true;
    return {
      ...LIGADA,
      receberConferenciaDiaria: d.receberConferenciaDiaria,
      conferenciaDesligadaEm: ligou ? null : d.conferenciaDesligadaEm,
      conferenciaDesligadaOrigem: ligou ? null : d.conferenciaDesligadaOrigem,
      conferenciaDesligadaMotivo: ligou ? null : d.conferenciaDesligadaMotivo,
      conferenciaDesligadaPor: ligou ? null : { id: USER.id, nome: "Eu" },
    };
  });
  const log = vi.fn(async (_a: Record<string, any>) => {});
  const prisma = { motorista: { findUnique: vi.fn(async () => atual), update } };
  const svc = new ConferenciaDiariaService(prisma as never, { log } as never, {} as never, {} as never, {} as never);
  return { svc, update, log };
}

describe("definirRecebimento (interruptor do painel, só este vínculo)", () => {
  it("desligar: grava origem PAINEL, quem e quando, e audita com antes/depois", async () => {
    const t = montar(LIGADA);
    const r = await t.svc.definirRecebimento("m1", USER, { recebe: false, motivo: "  não usa o app  " }, AGORA);
    expect(t.update.mock.calls[0]![0].data).toMatchObject({
      receberConferenciaDiaria: false,
      conferenciaDesligadaEm: AGORA,
      conferenciaDesligadaOrigem: "PAINEL",
      conferenciaDesligadaPor: { connect: { id: "u1" } },
      conferenciaDesligadaMotivo: "não usa o app",
    });
    expect(r).toMatchObject({ receberConferenciaDiaria: false, conferenciaDesligadaOrigem: "PAINEL" });
    expect(t.log).toHaveBeenCalledOnce();
    expect(t.log.mock.calls[0]![0]).toMatchObject({
      usuarioId: "u1",
      acao: "CONFERENCIA_MOTORISTA_DESLIGADA",
      valorAntes: true,
      valorDepois: false,
      motivo: "não usa o app",
    });
  });

  it("desligar não exige motivo", async () => {
    const t = montar(LIGADA);
    await expect(t.svc.definirRecebimento("m1", USER, { recebe: false }, AGORA)).resolves.toBeTruthy();
  });

  it("religar quem o MOTORISTA desligou sem motivo é 400 com mensagem clara e nada é gravado", async () => {
    const t = montar(PELO_MOTORISTA);
    const p = t.svc.definirRecebimento("m1", USER, { recebe: true }, AGORA);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(/pediu pra parar.*motivo/i);
    expect(t.update).not.toHaveBeenCalled();
    expect(t.log).not.toHaveBeenCalled();
  });

  it("motivo curto demais (menos de 5 letras) também é 400", async () => {
    const t = montar(PELO_MOTORISTA);
    await expect(t.svc.definirRecebimento("m1", USER, { recebe: true, motivo: " ok " }, AGORA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("linha antiga (desligada sem origem) conta como do motorista", async () => {
    const t = montar({ ...PELO_MOTORISTA, conferenciaDesligadaOrigem: null, conferenciaDesligadaEm: null });
    await expect(t.svc.definirRecebimento("m1", USER, { recebe: true }, AGORA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("religar quem o motorista desligou COM motivo: limpa o registro e audita o motivo", async () => {
    const t = montar(PELO_MOTORISTA);
    const r = await t.svc.definirRecebimento("m1", USER, { recebe: true, motivo: "a pedido do motorista" }, AGORA);
    expect(t.update.mock.calls[0]![0].data).toMatchObject({
      receberConferenciaDiaria: true,
      conferenciaDesligadaEm: null,
      conferenciaDesligadaOrigem: null,
      conferenciaDesligadaMotivo: null,
      conferenciaDesligadaPor: { disconnect: true },
    });
    expect(r).toMatchObject({ receberConferenciaDiaria: true, conferenciaDesligadaOrigem: null, conferenciaDesligadaPor: null });
    expect(t.log.mock.calls[0]![0]).toMatchObject({
      acao: "CONFERENCIA_MOTORISTA_RELIGADA",
      valorAntes: false,
      valorDepois: true,
      motivo: "a pedido do motorista",
      metadata: { desligadaAntesPor: "MOTORISTA" },
    });
  });

  it("religar o que o PAINEL desligou não exige motivo", async () => {
    const t = montar(PELO_PAINEL);
    await t.svc.definirRecebimento("m1", USER, { recebe: true }, AGORA);
    expect(t.update).toHaveBeenCalledOnce();
    expect(t.log.mock.calls[0]![0].metadata).toMatchObject({ desligadaAntesPor: "PAINEL" });
  });

  it("idempotente: repetir o estado devolve 200 sem gravar nem duplicar a auditoria", async () => {
    const a = montar(LIGADA);
    const ra = await a.svc.definirRecebimento("m1", USER, { recebe: true }, AGORA);
    expect(ra.receberConferenciaDiaria).toBe(true);
    const b = montar(PELO_PAINEL);
    const rb = await b.svc.definirRecebimento("m1", USER, { recebe: false }, AGORA);
    expect(rb).toMatchObject({ conferenciaDesligadaOrigem: "PAINEL", conferenciaDesligadaPor: { nome: "Ana" } });
    for (const t of [a, b]) {
      expect(t.update).not.toHaveBeenCalled();
      expect(t.log).not.toHaveBeenCalled();
    }
  });

  it("motorista inexistente: 404", async () => {
    const t = montar(null);
    await expect(t.svc.definirRecebimento("x", USER, { recebe: false })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("semCanalDe: 'desligado pelo painel' é um motivo próprio, distinto de PAROU", () => {
  const base = { telefone: "42991088125", aceitaWhatsapp: true, whatsappInalcancavelEm: null };
  const svc = montar(LIGADA).svc as unknown as { semCanalDe(m: unknown): string | null };

  it("origem PAINEL -> DESLIGADA_PAINEL; motorista ou linha antiga -> PAROU; ligada -> null", () => {
    expect(svc.semCanalDe({ ...base, receberConferenciaDiaria: false, conferenciaDesligadaOrigem: "PAINEL" })).toBe("DESLIGADA_PAINEL");
    expect(svc.semCanalDe({ ...base, receberConferenciaDiaria: false, conferenciaDesligadaOrigem: "MOTORISTA" })).toBe("PAROU");
    expect(svc.semCanalDe({ ...base, receberConferenciaDiaria: false })).toBe("PAROU");
    expect(svc.semCanalDe({ ...base, receberConferenciaDiaria: true, conferenciaDesligadaOrigem: null })).toBeNull();
  });
});
