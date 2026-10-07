import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { ipDaRequisicao } from "./ip";

const req = (xff: string | string[] | undefined, ip = "10.0.0.5") => ({ headers: { "x-forwarded-for": xff }, ip }) as unknown as Request;

describe("IP de origem atrás de um proxy", () => {
  it("cliente que manda X-Forwarded-For falso não escolhe o próprio IP", () => {
    // O cliente mandou "1.2.3.4"; o Traefik acrescentou o IP real no fim.
    expect(ipDaRequisicao(req("1.2.3.4, 200.192.97.59"))).toBe("200.192.97.59");
  });

  it("proxy que escreve por cima: o único item é o IP real", () => {
    expect(ipDaRequisicao(req("200.192.97.59"))).toBe("200.192.97.59");
  });

  it("cabeçalho repetido conta como uma lista só", () => {
    expect(ipDaRequisicao(req(["1.2.3.4", "200.192.97.59"]))).toBe("200.192.97.59");
  });

  it("sem proxy (local), usa o IP da conexão", () => {
    expect(ipDaRequisicao(req(undefined))).toBe("10.0.0.5");
  });
});
