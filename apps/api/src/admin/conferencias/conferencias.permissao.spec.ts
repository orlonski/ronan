import { describe, it, expect } from "vitest";
import {
  CHAVES_PLATAFORMA,
  PERMISSOES_ADMIN_EMPRESA,
  TODAS_AS_CHAVES,
  CATALOGO_PERMISSOES,
} from "@ronan/shared-types";

/**
 * A Conferência de ticket é da PLATAFORMA, não da empresa que assina.
 *
 * Estava gateada por `viagens.ver` — permissão que todo admin de empresa tem —,
 * então a tela aparecia no menu de quem não deveria ver e não existia linha
 * própria na matriz de papéis pra tirar. A régua é a mesma do `config-ia`: cada
 * leitura é uma chamada paga na conta da plataforma, e a tela mostra o custo em
 * dólar dessa conta.
 */
describe("permissões da Conferência de ticket", () => {
  it("existe no catálogo, com linha própria na matriz", () => {
    const chaves = CATALOGO_PERMISSOES.map((p) => p.chave);
    expect(chaves).toContain("conferencia-ticket.ver");
    expect(chaves).toContain("conferencia-ticket.reprocessar");
  });

  it("é de plataforma — empresa cliente não recebe", () => {
    expect(CHAVES_PLATAFORMA).toContain("conferencia-ticket.ver");
    expect(CHAVES_PLATAFORMA).toContain("conferencia-ticket.reprocessar");
    expect(PERMISSOES_ADMIN_EMPRESA).not.toContain("conferencia-ticket.ver");
    expect(PERMISSOES_ADMIN_EMPRESA).not.toContain("conferencia-ticket.reprocessar");
  });

  it("o dono da plataforma recebe — ele leva TODAS_AS_CHAVES", () => {
    expect(TODAS_AS_CHAVES).toContain("conferencia-ticket.ver");
    expect(TODAS_AS_CHAVES).toContain("conferencia-ticket.reprocessar");
  });

  it("não voltou a depender de viagens.ver, que toda empresa tem", () => {
    // O erro original: gatear tela de plataforma por permissão de operação.
    expect(PERMISSOES_ADMIN_EMPRESA).toContain("viagens.ver");
  });
});
