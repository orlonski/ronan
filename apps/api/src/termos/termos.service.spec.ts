import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashDoCorpo, TermosService } from "./termos.service";

// `comoSistema` só troca o contexto da trava multi-tenant; nos testes ele é
// transparente e executa o callback direto.
vi.mock("../common/conta/conta-context", () => ({
  comoSistema: <T>(fn: () => T) => Promise.resolve(fn()),
}));

const CORPO = "x".repeat(300);
const SHA = hashDoCorpo(CORPO);

function fakePrisma() {
  return {
    termoVersao: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    aceiteTermo: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  };
}

type Fake = ReturnType<typeof fakePrisma>;

function servico(p: Fake) {
  return new TermosService(p as never);
}

const VERSAO_PUBLICADA = {
  id: "v1",
  tipo: "USO" as const,
  versao: "1.0",
  corpo: CORPO,
  sha256: SHA,
  vigenteDesde: new Date("2026-01-01"),
  publicadoEm: new Date("2026-01-01"),
  oQueMudou: null,
};

const ACEITE_BASE = {
  contaId: "c1",
  termoVersaoId: "v1",
  sha256: SHA,
  nome: "Diego",
  email: "d@x.com",
  origem: "PAINEL" as const,
};

describe("aceite de termos", () => {
  let p: Fake;
  beforeEach(() => {
    p = fakePrisma();
  });

  describe("a prova só vale se o texto for o mesmo", () => {
    it("recusa aceite cujo hash não bate com o texto publicado", async () => {
      p.termoVersao.findUnique.mockResolvedValue(VERSAO_PUBLICADA);

      // A aba estava aberta desde a versão anterior.
      await expect(
        servico(p).aceitar({ ...ACEITE_BASE, sha256: hashDoCorpo("texto antigo") }),
      ).rejects.toThrow(/mudou enquanto você lia/i);

      // E o mais importante: nada foi gravado.
      expect(p.aceiteTermo.create).not.toHaveBeenCalled();
    });

    it("aceita quando o hash confere", async () => {
      p.termoVersao.findUnique.mockResolvedValue(VERSAO_PUBLICADA);
      p.aceiteTermo.findFirst.mockResolvedValue(null);
      p.aceiteTermo.create.mockResolvedValue({ id: "a1" });

      await servico(p).aceitar(ACEITE_BASE);
      expect(p.aceiteTermo.create).toHaveBeenCalledOnce();
    });

    it("recusa versão que ainda não foi publicada", async () => {
      p.termoVersao.findUnique.mockResolvedValue({ ...VERSAO_PUBLICADA, publicadoEm: null });
      await expect(servico(p).aceitar(ACEITE_BASE)).rejects.toThrow(/não foi publicada/i);
    });
  });

  describe("a prova não vem do cliente", () => {
    it("grava IP, user agent e quem era a pessoa, congelados", async () => {
      p.termoVersao.findUnique.mockResolvedValue(VERSAO_PUBLICADA);
      p.aceiteTermo.findFirst.mockResolvedValue(null);
      p.aceiteTermo.create.mockResolvedValue({ id: "a1" });

      await servico(p).aceitar({
        ...ACEITE_BASE,
        userId: "u1",
        ip: "200.1.2.3",
        userAgent: "Mozilla/5.0",
        documento: "63620308000150",
      });

      expect(p.aceiteTermo.create.mock.calls[0][0].data).toMatchObject({
        nomeQuemAceitou: "Diego",
        emailQuemAceitou: "d@x.com",
        documento: "63620308000150",
        ip: "200.1.2.3",
        userAgent: "Mozilla/5.0",
        origem: "PAINEL",
      });
    });

    it("trunca user agent absurdo em vez de estourar a coluna", async () => {
      p.termoVersao.findUnique.mockResolvedValue(VERSAO_PUBLICADA);
      p.aceiteTermo.findFirst.mockResolvedValue(null);
      p.aceiteTermo.create.mockResolvedValue({ id: "a1" });

      await servico(p).aceitar({ ...ACEITE_BASE, userAgent: "A".repeat(5000) });

      expect(p.aceiteTermo.create.mock.calls[0][0].data.userAgent).toHaveLength(500);
    });
  });

  describe("clicar duas vezes não gera duas provas", () => {
    it("devolve o aceite existente sem criar outro", async () => {
      p.termoVersao.findUnique.mockResolvedValue(VERSAO_PUBLICADA);
      p.aceiteTermo.findFirst.mockResolvedValue({ id: "ja-existe" });

      const r = await servico(p).aceitar(ACEITE_BASE);

      expect(r).toEqual({ id: "ja-existe" });
      expect(p.aceiteTermo.create).not.toHaveBeenCalled();
    });
  });

  describe("quem precisa aceitar", () => {
    it("não incomoda quem já aceitou a versão vigente", async () => {
      p.termoVersao.findFirst.mockResolvedValue(VERSAO_PUBLICADA);
      p.aceiteTermo.findFirst.mockResolvedValue({ id: "a1" });

      expect((await servico(p).status("c1")).pendentes).toHaveLength(0);
    });

    it("não exige nada quando não há termo publicado", async () => {
      p.termoVersao.findFirst.mockResolvedValue(null);
      expect((await servico(p).status("c1")).pendentes).toHaveLength(0);
      // Sem isto, ligar a feature antes de publicar o texto trancaria todo
      // mundo fora do painel.
      expect(p.aceiteTermo.findFirst).not.toHaveBeenCalled();
    });

    it("distingue primeiro aceite de reaceite", async () => {
      p.termoVersao.findFirst.mockResolvedValue({ ...VERSAO_PUBLICADA, oQueMudou: "Mudou o teto." });
      // não aceitou a vigente, mas já aceitou uma anterior
      p.aceiteTermo.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "antigo" });

      const { pendentes } = await servico(p).status("c1");

      expect(pendentes[0]).toMatchObject({ primeiroAceite: false, oQueMudou: "Mudou o teto." });
    });

    it("marca como primeiro aceite quem nunca aceitou nada", async () => {
      p.termoVersao.findFirst.mockResolvedValue(VERSAO_PUBLICADA);
      p.aceiteTermo.findFirst.mockResolvedValue(null);

      const { pendentes } = await servico(p).status("c1");
      expect(pendentes[0]).toMatchObject({ primeiroAceite: true });
    });
  });

  describe("versão futura ainda não vale", () => {
    it("pede vigenteDesde <= agora, pra não quebrar o aviso de 30 dias", async () => {
      p.termoVersao.findFirst.mockResolvedValue(null);
      await servico(p).vigente("USO");

      const where = p.termoVersao.findFirst.mock.calls[0][0].where;
      expect(where.vigenteDesde.lte).toBeInstanceOf(Date);
      expect(where.publicadoEm).toEqual({ not: null });
    });
  });

  describe("texto publicado não se corrige", () => {
    it("recusa republicar a mesma versão e sugere a próxima", async () => {
      p.termoVersao.findUnique.mockResolvedValue(VERSAO_PUBLICADA);

      await expect(
        servico(p).publicar({
          tipo: "USO",
          versao: "1.0",
          corpo: CORPO,
          vigenteDesde: "2026-01-01",
        }),
      ).rejects.toThrow(/publique 1\.1/);
    });

    it("calcula o sha256 do corpo ao publicar", async () => {
      p.termoVersao.findUnique.mockResolvedValue(null);
      p.termoVersao.create.mockResolvedValue({ id: "v2" });

      await servico(p).publicar({
        tipo: "USO",
        versao: "1.1",
        corpo: CORPO,
        vigenteDesde: "2026-02-01",
      });

      expect(p.termoVersao.create.mock.calls[0][0].data.sha256).toBe(SHA);
    });
  });
});
