import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { caberNoLimite } from "./leitor-ticket.service";

/**
 * Foto de celular passa dos 5 MB que a Anthropic aceita — e a segunda leitura
 * falhava com 400 em todas elas. Ruído aleatório é o pior caso pra JPEG: não
 * comprime, então gera o arquivo grande de verdade.
 */
async function fotoGrande(): Promise<string> {
  const w = 4000;
  const h = 3000;
  const ruido = Buffer.alloc(w * h * 3);
  for (let i = 0; i < ruido.length; i++) ruido[i] = (i * 2654435761) >>> 24;
  const jpg = await sharp(ruido, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  return jpg.toString("base64");
}

describe("foto dentro do limite da Anthropic", () => {
  it("reduz a foto grande pra baixo dos 5 MB, em JPEG", async () => {
    const grande = await fotoGrande();
    expect(grande.length).toBeGreaterThan(4_800_000);
    const r = await caberNoLimite(grande, "image/png", "anthropic");
    expect(r.base64.length).toBeLessThan(4_800_000);
    expect(r.mime).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(r.base64, "base64")).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2000);
  }, 30_000);

  it("não mexe em foto pequena nem em outro provedor", async () => {
    expect(await caberNoLimite("abc", "image/png", "anthropic")).toEqual({ base64: "abc", mime: "image/png" });
    const grande = "x".repeat(5_000_000);
    expect((await caberNoLimite(grande, "image/jpeg", "minimax")).base64).toBe(grande);
  });
});
