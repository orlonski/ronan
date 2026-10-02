import { describe, expect, it } from "vitest";
import { assinarLink, lerLinkAssinado } from "./link-assinado";

const S = "segredo-de-teste";
const daqui = (d: number) => new Date(Date.now() + d * 86_400_000);

describe("link assinado", () => {
  it("abre o documento certo enquanto vale", () => {
    const t = assinarLink({ tipo: "acerto", id: "a1", contaId: "c1", expiraEm: daqui(30) }, S);
    expect(lerLinkAssinado(t, "acerto", S)).toEqual({ id: "a1", contaId: "c1" });
  });

  it("expirado, de outro tipo, outro segredo ou adulterado não abre", () => {
    const t = assinarLink({ tipo: "acerto", id: "a1", contaId: "c1", expiraEm: daqui(-1) }, S);
    expect(lerLinkAssinado(t, "acerto", S)).toBeNull();
    const ok = assinarLink({ tipo: "acerto", id: "a1", contaId: "c1", expiraEm: daqui(1) }, S);
    expect(lerLinkAssinado(ok, "fatura", S)).toBeNull();
    expect(lerLinkAssinado(ok, "acerto", "outro")).toBeNull();
    const [corpo, sig] = ok.split(".");
    const outroCorpo = Buffer.from(JSON.stringify({ t: "acerto", i: "a2", c: "c1", e: 9999999999 })).toString("base64url");
    expect(lerLinkAssinado(`${outroCorpo}.${sig}`, "acerto", S)).toBeNull();
    expect(lerLinkAssinado(`${corpo}`, "acerto", S)).toBeNull();
    expect(lerLinkAssinado("lixo", "acerto", S)).toBeNull();
  });
});
