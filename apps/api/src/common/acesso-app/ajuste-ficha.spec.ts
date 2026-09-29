import { describe, expect, it } from "vitest";
import { decidirAjuste } from "./ajuste-ficha";

describe("decidirAjuste", () => {
  it("já está como pedido: nada", () => {
    expect(decidirAjuste({ baseTem: true, concedido: true }, true)).toBe("NADA");
    expect(decidirAjuste({ baseTem: false, concedido: false }, false)).toBe("NADA");
  });
  it("grupo não dá e pedem ligar: exceção CONCEDER", () => {
    expect(decidirAjuste({ baseTem: false, concedido: false }, true)).toBe("CONCEDER");
  });
  it("grupo dá e pedem desligar: exceção NEGAR", () => {
    expect(decidirAjuste({ baseTem: true, concedido: true }, false)).toBe("NEGAR");
  });
  it("tinha exceção NEGAR e pedem ligar de volta: desfaz, não empilha", () => {
    expect(decidirAjuste({ baseTem: true, concedido: false }, true)).toBe("DESFAZER");
  });
  it("tinha exceção CONCEDER e pedem desligar: desfaz", () => {
    expect(decidirAjuste({ baseTem: false, concedido: true }, false)).toBe("DESFAZER");
  });
});
