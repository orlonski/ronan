import { describe, expect, it, vi } from "vitest";
import { LembreteLancamentoService } from "./lembrete-lancamento.service";

// Segunda 28/09/2026, 10h em São Paulo.
const AGORA = new Date("2026-09-28T13:00:00Z");

function montar(
  opts: {
    motorista?: Record<string, unknown> | null;
    cfg?: Record<string, unknown> | null;
    modulos?: { chave: string; vigenteDe: null; vigenteAte: null }[];
    ultimaViagem?: Date | null;
    viagens?: Record<string, unknown>[];
    falhar?: boolean;
  } = {},
) {
  const findFirst = vi.fn(async () =>
    opts.cfg === null
      ? null
      : {
          ativo: true,
          lembreteNoApp: true,
          lembreteParaQuem: "SO_QUEM_SAIU",
          diasParaLembreteNoApp: 3,
          regra: "SEM_VIAGEM_NO_DIA_ANTERIOR",
          diasSemViagem: 2,
          diasConsiderados: [1, 2, 3, 4, 5],
          ignorarFeriados: true,
          incluirQueNuncaLancou: true,
          intervaloMinimoDias: 3,
          maxPerguntasPorSemana: 3,
          ...opts.cfg,
        },
  );
  const prisma = {
    motorista: {
      findUnique: vi.fn(async () => {
        if (opts.falhar) throw new Error("banco fora");
        return opts.motorista === null
          ? null
          : {
              id: "m1",
              contaId: "c1",
              ativo: true,
              status: "APROVADO",
              aceite: "ACEITO",
              criadoEm: new Date("2026-01-01T12:00:00Z"),
              receberConferenciaDiaria: false,
              ...opts.motorista,
            };
      }),
    },
    configuracaoConferenciaDiaria: { findFirst },
    conta: { findUnique: async () => ({ ehPlataforma: false, permissoesPermitidas: [], permissoesExtras: [] }) },
    moduloContratado: {
      findMany: vi.fn(async () => opts.modulos ?? [{ chave: "conferencia", vigenteDe: null, vigenteAte: null }]),
    },
    viagem: {
      findMany: vi.fn(async () => opts.viagens ?? []),
      aggregate: vi.fn(async () => ({ _max: { data: opts.ultimaViagem === undefined ? new Date("2026-09-18T00:00:00Z") : opts.ultimaViagem } })),
    },
    feriadoPonto: { findMany: vi.fn(async () => []) },
  };
  return { svc: new LembreteLancamentoService(prisma as never), prisma, findFirst };
}

describe("LembreteLancamentoService (gate do /m/me)", () => {
  it("caso feliz: quem parou, aprovado, vínculo vivo e atrasado recebe o lembrete", async () => {
    const { svc } = montar();
    const r = await svc.paraMotorista("m1", AGORA);
    expect(r).toMatchObject({ desde: expect.any(String), calculadoEm: "2026-09-28" });
    expect(r!.dias).toBeGreaterThanOrEqual(3);
  });

  it("empresa com o lembrete desligado: null (e nem calcula viagens)", async () => {
    const { svc, prisma } = montar({ cfg: { lembreteNoApp: false } });
    expect(await svc.paraMotorista("m1", AGORA)).toBeNull();
    expect(prisma.viagem.findMany).not.toHaveBeenCalled();
  });

  it("conferência inativa: null", async () => {
    expect(await montar({ cfg: { ativo: false } }).svc.paraMotorista("m1", AGORA)).toBeNull();
  });

  it("empresa sem configuração ainda: null", async () => {
    expect(await montar({ cfg: null }).svc.paraMotorista("m1", AGORA)).toBeNull();
  });

  it("módulo de conferência não contratado: null", async () => {
    expect(await montar({ modulos: [] }).svc.paraMotorista("m1", AGORA)).toBeNull();
  });

  it("SO_QUEM_SAIU: quem ainda recebe as perguntas não vê; TODOS_QUE_ATRASARAM vê", async () => {
    const ainda = { receberConferenciaDiaria: true };
    expect(await montar({ motorista: ainda }).svc.paraMotorista("m1", AGORA)).toBeNull();
    const r = await montar({ motorista: ainda, cfg: { lembreteParaQuem: "TODOS_QUE_ATRASARAM" } }).svc.paraMotorista("m1", AGORA);
    expect(r).not.toBeNull();
  });

  it("motorista não aprovado (pendente ou rejeitado): null — este endpoint não tem flag que valide", async () => {
    expect(await montar({ motorista: { status: "PENDENTE_APROVACAO" } }).svc.paraMotorista("m1", AGORA)).toBeNull();
    expect(await montar({ motorista: { status: "REJEITADO" } }).svc.paraMotorista("m1", AGORA)).toBeNull();
  });

  it("vínculo inativo ou convite não aceito: null", async () => {
    expect(await montar({ motorista: { ativo: false } }).svc.paraMotorista("m1", AGORA)).toBeNull();
    expect(await montar({ motorista: { aceite: "PENDENTE" } }).svc.paraMotorista("m1", AGORA)).toBeNull();
  });

  it("cadastro inexistente: null", async () => {
    expect(await montar({ motorista: null }).svc.paraMotorista("m1", AGORA)).toBeNull();
  });

  it("lançou viagem recente (dentro dos dias esperados): null", async () => {
    const { svc } = montar({ ultimaViagem: new Date("2026-09-25T00:00:00Z") });
    expect(await svc.paraMotorista("m1", AGORA)).toBeNull();
  });

  it("virada de dia às 21h30 de Brasília: 'hoje' é segunda, não terça (UTC)", async () => {
    const noite = new Date("2026-09-29T00:30:00Z");
    const r = await montar().svc.paraMotorista("m1", noite);
    expect(r?.calculadoEm).toBe("2026-09-28");
  });

  it("qualquer falha vira null: o lembrete nunca derruba o perfil", async () => {
    expect(await montar({ falhar: true }).svc.paraMotorista("m1", AGORA)).toBeNull();
  });
});
