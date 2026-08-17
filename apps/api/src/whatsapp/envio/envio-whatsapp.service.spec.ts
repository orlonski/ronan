import { describe, it, expect, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { EnvioWhatsappService } from "./envio-whatsapp.service";
import type { EnvioWhatsapp, ResultadoEnvio } from "./envio.types";
import type { EvolutionProvedor } from "./evolution.provedor";

/** Um provedor de mentira, pra poder testar a fachada sem rede. */
function provedorFake(opts: { configurado?: boolean; resultado?: Partial<ResultadoEnvio> } = {}) {
  const enviar = vi.fn(
    async (): Promise<ResultadoEnvio> => ({
      enviado: true,
      provedor: "evolution",
      idExterno: "ABC123",
      ...opts.resultado,
    }),
  );
  return {
    nome: "evolution" as const,
    configurado: () => opts.configurado ?? true,
    enviar,
  };
}

function servico(fake: ReturnType<typeof provedorFake>) {
  return new EnvioWhatsappService(fake as unknown as EvolutionProvedor);
}

const paraMotorista = (rota: EnvioWhatsapp["rota"]): EnvioWhatsapp => ({
  destino: { tipo: "TELEFONE", numero: "5541999998888" },
  rota,
  texto: "oi",
});

describe("EnvioWhatsappService.enviarOuFalhar", () => {
  it("devolve o resultado quando o provedor aceita", async () => {
    const fake = provedorFake();
    const r = await servico(fake).enviarOuFalhar(paraMotorista("OTP_CADASTRO"));
    expect(r.enviado).toBe(true);
    expect(r.idExterno).toBe("ABC123");
    expect(fake.enviar).toHaveBeenCalledOnce();
  });

  it("rota crítica que falha fala em 'o código'", async () => {
    const fake = provedorFake({ resultado: { enviado: false, idExterno: null } });
    await expect(servico(fake).enviarOuFalhar(paraMotorista("OTP_CADASTRO"))).rejects.toSatisfy(
      (e: unknown) => {
        expect(e).toBeInstanceOf(ServiceUnavailableException);
        const resp = (e as ServiceUnavailableException).getResponse() as {
          code: string;
          message: string;
        };
        expect(resp.code).toBe("ENVIO_WHATSAPP_FALHOU");
        expect(resp.message).toContain("o código");
        return true;
      },
    );
  });

  it("rota não-crítica que falha fala em 'a mensagem', não em código", async () => {
    // Era o bug: mandar link de comprovante pro cliente e o erro dizer que não
    // deu pra enviar "o código", num fluxo que não tem código nenhum.
    const fake = provedorFake({ resultado: { enviado: false, idExterno: null } });
    await expect(servico(fake).enviarOuFalhar(paraMotorista("COMPARTILHAMENTO"))).rejects.toSatisfy(
      (e: unknown) => {
        const resp = (e as ServiceUnavailableException).getResponse() as { message: string };
        expect(resp.message).toContain("a mensagem");
        expect(resp.message).not.toContain("o código");
        return true;
      },
    );
  });
});

describe("EnvioWhatsappService.tentarEnviar", () => {
  it("nunca lança quando o provedor falha", async () => {
    const fake = provedorFake({
      resultado: { enviado: false, idExterno: null, erro: { codigo: "X", detalhe: "caiu" } },
    });
    const r = await servico(fake).tentarEnviar(paraMotorista("RESUMO_MOTORISTA"));
    expect(r.enviado).toBe(false);
    expect(r.erro?.detalhe).toBe("caiu");
  });

  it("não chega a chamar o provedor quando ele não está configurado", async () => {
    const fake = provedorFake({ configurado: false });
    const r = await servico(fake).tentarEnviar(paraMotorista("RESUMO_MOTORISTA"));
    expect(r.enviado).toBe(false);
    expect(r.erro?.codigo).toBe("PROVEDOR_NAO_CONFIGURADO");
    expect(fake.enviar).not.toHaveBeenCalled();
  });
});

describe("EnvioWhatsappService.disponivel", () => {
  it("diz o nome do provedor no motivo, pra o painel mostrar", async () => {
    expect(servico(provedorFake({ configurado: false })).disponivel("RESUMO_GESTOR")).toEqual({
      ok: false,
      motivo: "WhatsApp (Evolution) não está configurado no servidor.",
    });
  });

  it("ok quando configurado", () => {
    expect(servico(provedorFake()).disponivel("RESUMO_GESTOR")).toEqual({ ok: true });
  });
});
