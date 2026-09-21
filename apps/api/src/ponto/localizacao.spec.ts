import { describe, expect, it } from "vitest";
import { PontoService } from "./ponto.service";
import { PontoAdminService } from "./ponto-admin.service";

/**
 * A localização da batida: as duas pontas.
 *
 * A coleta já existia, com expurgo por prazo. Faltavam o interruptor de
 * verdade (quem para de coletar é o APARELHO) e o rastro de quem consulta.
 * Estes testes guardam as duas coisas, porque as duas falham em silêncio: o
 * app coletando a mais não dá erro em lugar nenhum, e a consulta sem
 * auditoria devolve a coordenada do mesmo jeito.
 */

function servicoMotorista(diasRetencaoLocalizacao: number) {
  const prisma = {
    configPonto: {
      findFirst: async () => ({
        razaoSocial: "X",
        cnpj: "1",
        identificacaoRep: "REP",
        avisoLgpdTexto: "aviso",
        diasRetencaoLocalizacao,
      }),
    },
    motivoCorrecaoPonto: { findMany: async () => [] },
  };
  return new PontoService(prisma as never, {} as never);
}

describe("o interruptor da coleta chega no aparelho", () => {
  it("retenção 0 manda capturaLocalizacao=false", async () => {
    const c = await servicoMotorista(0).catalogo();
    expect(c.capturaLocalizacao).toBe(false);
  });

  it("retenção 90 manda capturaLocalizacao=true", async () => {
    const c = await servicoMotorista(90).catalogo();
    expect(c.capturaLocalizacao).toBe(true);
  });

  it("não vaza o prazo de retenção pro app", async () => {
    // O app não precisa saber por quantos dias a empresa guarda; precisa
    // saber se coleta. Mandar o número faria uma tela de motorista exibir
    // política interna sem ninguém decidir isso.
    const c = await servicoMotorista(90).catalogo();
    expect(JSON.stringify(c)).not.toContain("diasRetencao");
  });
});

function servicoAdmin(localizacao: unknown) {
  const logs: { acao: string; entidadeId: string; metadata: unknown }[] = [];
  const prisma = {
    marcacao: {
      findFirst: async () => ({
        id: "m1",
        numeroRegistro: 42,
        marcadoEm: new Date("2026-09-21T10:12:00Z"),
        funcionario: { id: "f1", nome: "Fulano" },
        localizacao,
      }),
    },
  };
  const auditoria = {
    log: async (e: { acao: string; entidadeId: string; metadata: unknown }) => {
      logs.push(e);
    },
  };
  return { s: new PontoAdminService(prisma as never, auditoria as never), logs };
}

describe("consultar a coordenada deixa rastro", () => {
  it("registra PONTO_VIU_LOCALIZACAO quando havia coordenada", async () => {
    const { s, logs } = servicoAdmin({ latitude: "-25.4", longitude: "-49.2", precisao: 12 });
    const r = await s.localizacaoDaMarcacao("m1", "u1");
    expect(r.localizacao).toEqual({ latitude: -25.4, longitude: -49.2, precisao: 12 });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.acao).toBe("PONTO_VIU_LOCALIZACAO");
    expect(logs[0]!.metadata).toMatchObject({ funcionarioId: "f1", havia: true });
  });

  it("registra o rastro TAMBÉM quando não havia coordenada", async () => {
    // Abrir e não achar continua sendo uma consulta à localização de alguém.
    // Auditar só o achado deixaria a tentativa invisível.
    const { s, logs } = servicoAdmin(null);
    const r = await s.localizacaoDaMarcacao("m1", "u1");
    expect(r.localizacao).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({ havia: false });
  });

  it("auditoria que falha não derruba a consulta", async () => {
    const prisma = {
      marcacao: {
        findFirst: async () => ({
          id: "m1",
          numeroRegistro: 1,
          marcadoEm: new Date(),
          funcionario: { id: "f1", nome: "F" },
          localizacao: null,
        }),
      },
    };
    const s = new PontoAdminService(prisma as never, {
      log: async () => {
        throw new Error("banco fora");
      },
    } as never);
    await expect(s.localizacaoDaMarcacao("m1", "u1")).resolves.toBeTruthy();
  });
});
