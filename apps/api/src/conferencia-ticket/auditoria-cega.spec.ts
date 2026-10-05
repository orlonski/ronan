import { describe, it, expect } from "vitest";
import { AuditoriaCegaService, classificarAuditoria, CORTE_LEITURA_CEGA } from "./auditoria-cega.service";
import { comConta } from "../common/conta/conta-context";
import type { PrismaService } from "../prisma/prisma.service";

describe("classificarAuditoria", () => {
  const semVinculo = (campo: string) => ({ campo, declarado: "x", lido: "y", motivo: "sem vínculo" });

  it("confere é confere", () => {
    expect(classificarAuditoria({ veredito: "BATE", divergencias: [], incertezas: [] })).toBe("CONFERE");
  });

  it("peso divergente vence o resto, mesmo com a obra sem vínculo", () => {
    expect(
      classificarAuditoria({
        veredito: "DIVERGE",
        divergencias: [{ campo: "toneladas", declarado: "39,85 t", lido: "33,10 t", gravidade: "ALTA", detalhe: "" }],
        incertezas: [semVinculo("cliente") as never],
      }),
    ).toBe("PESO_OU_TICKET");
  });

  it("dúvida no número do ticket também é grave", () => {
    expect(
      classificarAuditoria({
        veredito: "INCERTO",
        divergencias: [],
        incertezas: [{ campo: "ticket", declarado: "46779", lido: "46719", motivo: "um caractere" }],
      }),
    ).toBe("PESO_OU_TICKET");
  });

  it("só obra/material sem vínculo: resolve vinculando, sem gastar leitura", () => {
    expect(
      classificarAuditoria({
        veredito: "INCERTO",
        divergencias: [],
        incertezas: [semVinculo("cliente"), semVinculo("material")] as never,
      }),
    ).toBe("SO_VINCULO");
  });

  it("placa ou data", () => {
    expect(
      classificarAuditoria({
        veredito: "DIVERGE",
        divergencias: [{ campo: "data", declarado: "2026-09-03", lido: "2026-08-03", gravidade: "ALTA", detalhe: "" }],
        incertezas: [],
      }),
    ).toBe("PLACA_OU_DATA");
  });

  it("leitura sem conclusão (ilegível)", () => {
    expect(classificarAuditoria({ veredito: "ILEGIVEL", divergencias: [], incertezas: [] })).toBe("SEM_CONCLUSAO");
  });
});

describe("AuditoriaCegaService", () => {
  const antes = new Date(CORTE_LEITURA_CEGA.getTime() - 86_400_000);
  const depois = new Date(CORTE_LEITURA_CEGA.getTime() + 60_000);

  function montar(lidas: { viagemId: string; veredito: string; finalizadoEm: Date }[], auditadas: string[] = []) {
    const criados: unknown[] = [];
    const prisma = {
      conta: { findUnique: async () => ({ iaConferenciaTicket: true }) },
      conferenciaTicket: {
        findMany: async (args: { where: { origem?: string } }) =>
          args.where.origem
            ? auditadas.map((viagemId) => ({ viagemId }))
            : [...lidas]
                .sort((a, b) => b.finalizadoEm.getTime() - a.finalizadoEm.getTime())
                .map((l) => ({ ...l, criadoEm: l.finalizadoEm, origem: "create" })),
        aggregate: async () => ({ _avg: { custoUsd: 0.006 }, _count: 10 }),
        create: async (a: unknown) => criados.push(a),
      },
      viagem: {
        findMany: async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in.map((id) => ({ id, conferidoPorIaEm: new Date(), _count: { matchesFechamento: 0 } })),
        findUnique: async () => ({
          status: "OK",
          ticket: "1",
          toneladas: null,
          data: null,
          veiculo: null,
          cliente: null,
          material: null,
          fotos: [{ id: "f", storageKey: "k.jpg" }],
        }),
      },
      veiculo: { findMany: async () => [] },
    } as unknown as PrismaService;
    return { svc: new AuditoriaCegaService(prisma), criados };
  }

  it("só entra o que a ÚLTIMA leitura disse que confere, antes do conserto, e ainda não auditado", async () => {
    const { svc } = montar(
      [
        { viagemId: "a", veredito: "BATE", finalizadoEm: antes },
        // Já relida às cegas depois do conserto ("ler de novo"): fora.
        { viagemId: "b", veredito: "BATE", finalizadoEm: antes },
        { viagemId: "b", veredito: "BATE", finalizadoEm: depois },
        // Não dizia que conferia: fora.
        { viagemId: "c", veredito: "INCERTO", finalizadoEm: antes },
        // Já auditada: fora.
        { viagemId: "d", veredito: "BATE", finalizadoEm: antes },
      ],
      ["d"],
    );
    const p = await svc.previa();
    expect(p.total).toBe(1);
    expect(p.custoEstimadoUsd).toBeCloseTo(0.006);
  });

  it("não roda se o total mudou desde a prévia — o OK foi pra outro número", async () => {
    const { svc, criados } = montar([{ viagemId: "a", veredito: "BATE", finalizadoEm: antes }]);
    const r = await comConta("conta-a", () => svc.executar(5));
    expect(r.enfileiradas).toBe(0);
    expect(r.motivo).toMatch(/mudou/);
    expect(criados).toHaveLength(0);
  });

  it("com o total certo, enfileira como auditoria", async () => {
    const { svc, criados } = montar([{ viagemId: "a", veredito: "BATE", finalizadoEm: antes }]);
    const r = await comConta("conta-a", () => svc.executar(1));
    expect(r.enfileiradas).toBe(1);
    expect(criados[0]).toMatchObject({ data: { origem: "auditoria-cega", viagemId: "a" } });
  });
});
