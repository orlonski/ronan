import { describe, expect, it } from "vitest";
import {
  CODIGOS_DESTINATARIO_NAO_ALCANCAVEL,
  codigoDeErroParaGravar,
  codigoNumericoDeErro,
  falhaEhDeAlcance,
  numeroSilencioso,
} from "./whatsapp-alcance";

describe("allowlist de falha de alcance", () => {
  it("os códigos de destinatário não alcançável contam", () => {
    expect(falhaEhDeAlcance(131026)).toBe(true);
    expect(falhaEhDeAlcance("131049")).toBe(true);
    expect(falhaEhDeAlcance("META_131026")).toBe(true);
  });

  // Falha NOSSA nunca pode fazer o motorista parecer inalcançável.
  it.each([
    [132001, "template não existe"],
    [132000, "contagem de parâmetros"],
    [130429, "limite de envio"],
    [131056, "limite por par"],
    [131047, "janela de 24h"],
    [131042, "pagamento"],
    [190, "token vencido"],
    [131000, "erro genérico"],
  ])("%s (%s) NÃO conta", (codigo) => {
    expect(falhaEhDeAlcance(codigo)).toBe(false);
  });

  it("lixo, vazio e código de transporte não contam", () => {
    expect(falhaEhDeAlcance(null)).toBe(false);
    expect(falhaEhDeAlcance(undefined)).toBe(false);
    expect(falhaEhDeAlcance("META_INDISPONIVEL")).toBe(false);
    expect(falhaEhDeAlcance("PAYLOAD_INVALIDO")).toBe(false);
  });

  it("a lista é de PERMISSÃO: só os dois códigos conferidos", () => {
    expect([...CODIGOS_DESTINATARIO_NAO_ALCANCAVEL].sort()).toEqual([131026, 131049]);
  });

  it("o caminho síncrono e o webhook gravam o código no MESMO formato", () => {
    expect(codigoDeErroParaGravar("META_131026")).toBe("131026");
    expect(codigoDeErroParaGravar(131026)).toBe("131026");
    expect(codigoDeErroParaGravar("PROVEDOR_NAO_CONFIGURADO")).toBe("PROVEDOR_NAO_CONFIGURADO");
    expect(codigoDeErroParaGravar(null)).toBeNull();
    expect(codigoNumericoDeErro("abc")).toBeNull();
  });
});

describe("detector do silencioso", () => {
  const agora = new Date("2026-09-28T12:00:00Z");
  const h = (horasAtras: number) => new Date(agora.getTime() - horasAtras * 3_600_000);
  const msg = (horasAtras: number, statusEntrega: string | null, idExterno: string | null = "wamid.X") => ({
    criadoEm: h(horasAtras),
    statusEntrega,
    idExterno,
  });

  it("N mensagens aceitas pela Meta e nenhuma entregue: suspeito", () => {
    expect(numeroSilencioso([msg(10, "sent"), msg(30, "sent"), msg(50, null)], 3, agora)).toBe(true);
  });
  it("uma entregue no meio já basta pra não ser suspeito", () => {
    expect(numeroSilencioso([msg(10, "sent"), msg(30, "delivered"), msg(50, "sent")], 3, agora)).toBe(false);
    expect(numeroSilencioso([msg(10, "read"), msg(30, "sent"), msg(50, "sent")], 3, agora)).toBe(false);
  });
  it("menos de N mensagens: não conclui nada", () => {
    expect(numeroSilencioso([msg(10, "sent"), msg(30, "sent")], 3, agora)).toBe(false);
  });
  it("mensagem recente (ainda a caminho) não conta", () => {
    expect(numeroSilencioso([msg(1, "sent"), msg(30, "sent"), msg(50, "sent")], 3, agora)).toBe(false);
  });
  it("envio recusado na hora (sem wamid) é falha nossa, não sinal do aparelho", () => {
    expect(numeroSilencioso([msg(10, null, null), msg(30, "sent"), msg(50, "sent")], 3, agora)).toBe(false);
  });
  it("reverificar descarta o que veio antes", () => {
    const ms = [msg(10, "sent"), msg(30, "sent"), msg(50, "sent")];
    expect(numeroSilencioso(ms, 3, agora, { depoisDe: h(40) })).toBe(false);
    expect(numeroSilencioso(ms, 3, agora, { depoisDe: h(60) })).toBe(true);
  });
  it("N vem da config, não é chumbado", () => {
    const ms = [msg(10, "sent"), msg(30, "sent")];
    expect(numeroSilencioso(ms, 2, agora)).toBe(true);
    expect(numeroSilencioso(ms, 4, agora)).toBe(false);
  });
});
