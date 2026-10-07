import { describe, expect, it } from "vitest";
import { assinar, assinaturaConfere, gerarSegredoAviso } from "./assinatura";
import { conferirEndereco, ipProibido, resolverDestino } from "./destino-seguro";
import { ESPERAS_MS } from "./avisos.service";

describe("assinatura dos avisos (Standard Webhooks)", () => {
  it("bate com o vetor de teste oficial do padrão", () => {
    // standard-webhooks/standard-webhooks, spec/standard-webhooks.md
    const segredo = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    expect(assinar(segredo, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}')).toBe(
      "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    );
  });
  it("o integrador confere; corpo mexido não passa", () => {
    const s = gerarSegredoAviso();
    const h = assinar(s, "evt_1", 1700000000, '{"a":1}');
    expect(assinaturaConfere(s, "evt_1", 1700000000, '{"a":1}', h)).toBe(true);
    expect(assinaturaConfere(s, "evt_1", 1700000000, '{"a":2}', h)).toBe(false);
  });
});

describe("destino do aviso (SSRF)", () => {
  it("só https, sem IP escrito, sem senha no endereço, sem os nossos domínios", () => {
    for (const ruim of [
      "http://erp.cliente.com.br/x",
      "https://127.0.0.1/x",
      "https://2130706433/x",
      "https://0x7f.1/x",
      "https://[::1]/x",
      "https://user:senha@erp.cliente.com.br/x",
      "https://api.schaba.com.br/cadastro",
      "https://ronan-api.2azr6q.easypanel.host/x",
      "https://minio/x",
      "https://app.movatruck.com.br/x",
    ]) {
      expect(() => conferirEndereco(ruim), ruim).toThrow();
    }
    expect(conferirEndereco("https://erp.cliente.com.br:8443/avisos?t=1").hostname).toBe("erp.cliente.com.br");
  });

  it("IPs internos, de nuvem e disfarçados são proibidos", () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.0.10", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "64:ff9b::a00:1"]) {
      expect(ipProibido(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "149.102.138.127", "2606:4700:4700::1111"]) expect(ipProibido(ip), ip).toBe(false);
  });

  it("nome que resolve pra QUALQUER IP interno é recusado (DNS que mente)", async () => {
    const resolver = async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ];
    await expect(resolverDestino("https://erp.cliente.com.br/x", resolver)).rejects.toThrow(/rede interna/);
    const ok = await resolverDestino("https://erp.cliente.com.br/x", async () => [{ address: "8.8.8.8", family: 4 }]);
    expect(ok.ip).toBe("8.8.8.8");
  });

  it("as tentativas somam uns 3 dias", () => {
    const h = ESPERAS_MS.reduce((a, b) => a + b, 0) / 3_600_000;
    expect(h).toBeGreaterThan(60);
    expect(h).toBeLessThan(80);
  });
});
