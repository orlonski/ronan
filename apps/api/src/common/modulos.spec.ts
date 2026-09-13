import { describe, expect, it } from "vitest";
import {
  MODULOS,
  MODULOS_PADRAO,
  moduloDaChave,
  moduloDoRecurso,
  recursosDuplicados,
  recursosOrfaos,
  RESOURCE_DEFS_PUBLICO,
  TODAS_AS_CHAVES,
} from "@ronan/shared-types";

/**
 * O contrato entre o catálogo de PERMISSÕES e o de MÓDULOS.
 *
 * Estes testes são a razão de o desenho funcionar daqui a vinte módulos. Sem
 * eles, a primeira tela nova criada por alguém com pressa fica fora de qualquer
 * módulo — e aí ela some pra todo mundo ou aparece pra todo mundo, conforme o
 * humor do guard, sem ninguém perceber até um cliente reclamar.
 */
describe("catálogo de módulos", () => {
  it("todo recurso do RBAC pertence a algum módulo", () => {
    // Se este teste quebrou: você criou um recurso novo em permissoes.ts. Diga
    // em qual módulo ele entra (modulos.ts) — ou seja, o que o cliente está
    // comprando quando compra essa tela.
    expect(recursosOrfaos()).toEqual([]);
  });

  it("nenhum recurso está em dois módulos", () => {
    // Recurso em dois contratos é preço ambíguo: cancelar um módulo deixaria a
    // tela viva pelo outro, e ninguém entenderia por quê.
    expect(recursosDuplicados()).toEqual([]);
  });

  it("todo módulo declara pelo menos um recurso", () => {
    for (const m of MODULOS) {
      expect(m.recursos.length, `módulo "${m.chave}" está vazio`).toBeGreaterThan(0);
    }
  });

  it("todo recurso declarado num módulo existe no RBAC", () => {
    const existentes = new Set(RESOURCE_DEFS_PUBLICO.map((r) => r.recurso));
    for (const m of MODULOS) {
      for (const r of m.recursos) {
        expect(existentes.has(r), `"${r}" (módulo ${m.chave}) não existe no catálogo`).toBe(true);
      }
    }
  });

  it("toda chave de permissão resolve pra um módulo", () => {
    for (const chave of TODAS_AS_CHAVES) {
      expect(moduloDaChave(chave), `chave "${chave}" sem módulo`).toBeDefined();
    }
  });

  it("os módulos padrão incluem o núcleo e excluem o que custa por uso", () => {
    // Conta nova não nasce gastando IA nem WhatsApp: isso é decisão da
    // plataforma, que é quem paga a conta.
    expect(MODULOS_PADRAO).toContain("operacao");
    expect(MODULOS_PADRAO).not.toContain("conferencia");
    expect(MODULOS_PADRAO).not.toContain("comunicacao");
    expect(MODULOS_PADRAO).not.toContain("plataforma");
  });

  it("o núcleo não pode ser desligado", () => {
    const nucleo = MODULOS.filter((m) => m.nucleo);
    expect(nucleo.length).toBeGreaterThan(0);
    // Desligar Operação seria vender um sistema de viagens que não registra
    // viagem. O guard trata núcleo como sempre presente.
    expect(nucleo.map((m) => m.chave)).toContain("operacao");
  });

  it("resolve recurso e chave pro mesmo módulo", () => {
    expect(moduloDoRecurso("viagens")).toBe("operacao");
    expect(moduloDaChave("viagens.editar")).toBe("operacao");
    expect(moduloDaChave("acertos.pagar")).toBe("financeiro");
    expect(moduloDaChave("pedidos.criar")).toBe("torre");
  });

  it("recurso desconhecido não inventa módulo", () => {
    expect(moduloDoRecurso("inexistente")).toBeUndefined();
  });
});
