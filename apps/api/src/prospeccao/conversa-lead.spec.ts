import { describe, expect, it } from "vitest";
import { ultimaPalavra } from "./conversa-lead";

const T = (iso: string) => new Date(iso);

describe("quem deu a última palavra", () => {
  it("o SDR respondeu por último", () => {
    const r = ultimaPalavra(
      { direcao: "SAIDA", criadoEm: T("2026-09-17T12:00:00Z") },
      T("2026-09-17T11:00:00Z"),
    );
    expect(r.direcao).toBe("SAIDA");
  });

  it("ele escreveu depois da última resposta do SDR", () => {
    const r = ultimaPalavra(
      { direcao: "SAIDA", criadoEm: T("2026-09-17T12:00:00Z") },
      T("2026-09-17T15:00:00Z"),
    );
    expect(r).toEqual({ direcao: "ENTRADA", em: T("2026-09-17T15:00:00Z") });
  });

  it("escreveu e o SDR NUNCA atendeu — o caso que ficava invisível", () => {
    // Conversa que caiu na fila humana não grava MensagemLead nenhuma.
    const r = ultimaPalavra(null, T("2026-09-14T10:00:00Z"));
    expect(r).toEqual({ direcao: "ENTRADA", em: T("2026-09-14T10:00:00Z") });
  });

  it("sem nenhuma das duas fontes, não há conversa", () => {
    expect(ultimaPalavra(null, null)).toEqual({ direcao: null, em: null });
  });

  it("empate fica com o que o SDR registrou — ele tem a direção, o outro não", () => {
    const mesmo = T("2026-09-17T12:00:00Z");
    expect(ultimaPalavra({ direcao: "ENTRADA", criadoEm: mesmo }, mesmo).direcao).toBe("ENTRADA");
  });
});
