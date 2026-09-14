import { describe, expect, it } from "vitest";
import { AsaasProvedor, centavosParaReais, reaisParaCentavos } from "./asaas.provedor";
import type { AsaasConfig } from "./asaas.config";

/**
 * O provedor contra respostas no formato REAL do gateway.
 *
 * Estes testes existem por causa de um bug que só apareceu em produção: a
 * autorização de Pix Automático nasceu sem copia-e-cola porque o código lia o
 * payload de dentro de `immediateQrCode`, e o gateway responde ele na RAIZ. O
 * JSON abaixo é o formato documentado — é ele, e não a nossa expectativa, que
 * manda.
 */

function configFalsa(over: Partial<AsaasConfig> = {}): AsaasConfig {
  return {
    apiKey: "chave",
    ambiente: "sandbox",
    webhookToken: "x".repeat(24),
    chavePix: "598a0dac-0000-0000-0000-000000000000",
    timeoutMs: 5_000,
    emitirNfse: false,
    habilitado: true,
    webhookHabilitado: true,
    baseUrl: "https://api-sandbox.asaas.com/v3",
    descreverNoBoot: () => {},
    ...over,
  } as unknown as AsaasConfig;
}

/** Um `fetch` de mentira que responde sempre o mesmo JSON e guarda o que recebeu. */
function fetchFalso(corpo: unknown, status = 200) {
  const chamadas: { url: string; metodo?: string; body?: unknown }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    chamadas.push({
      url,
      metodo: init?.method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(corpo),
    } as Response;
  }) as unknown as typeof fetch;
  return { fake, chamadas };
}

function provedor(corpo: unknown, status = 200) {
  const { fake, chamadas } = fetchFalso(corpo, status);
  const p = new AsaasProvedor(configFalsa());
  p.buscar = fake;
  return { p, chamadas };
}

describe("autorização de Pix Automático", () => {
  /** O formato documentado: `payload` na raiz, `immediateQrCode` só com metadados. */
  const RESPOSTA_REAL = {
    id: "pixaut_000000001",
    status: "CREATED",
    contractId: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
    customerId: "cus_000000001",
    frequency: "MONTHLY",
    startDate: "2026-10-10",
    value: 5,
    payload: "00020101021226930014BR.GOV.BCB.PIX2571qr.asaas.com/5204000053039865802BR6009SAO PAULO62070503***63041D3D",
    encodedImage: "iVBORw0KGgoAAAANSUhEUg==",
    immediateQrCode: {
      conciliationIdentifier: "concil_001",
      expirationDate: "2026-09-17 09:56:00",
    },
    paymentCreationMode: "SUBSCRIPTION",
    retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
  };

  const pedido = {
    clienteId: "cus_000000001",
    forma: "PIX_AUTOMATICO" as const,
    ciclo: "MENSAL" as const,
    valorCentavos: 500,
    primeiroVencimento: "2026-10-10",
    descricao: "Movatruck — Transportes Aurora",
    referenciaExterna: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  };

  it("lê o copia-e-cola da RAIZ, não de dentro de immediateQrCode", async () => {
    // O bug: `immediateQrCode.payload` não existe na resposta, e a assinatura
    // nascia sem QR nenhum — "aguardando autorização" para sempre.
    const { p } = provedor(RESPOSTA_REAL);
    const r = await p.criarAssinatura(pedido);
    expect(r.qrCodePayload).toBe(RESPOSTA_REAL.payload);
  });

  it("pega o vencimento do QR de dentro de immediateQrCode", async () => {
    const { p } = provedor(RESPOSTA_REAL);
    const r = await p.criarAssinatura(pedido);
    expect(r.qrCodeExpiraEm?.getUTCFullYear()).toBe(2026);
  });

  it("nunca nasce ativa: quem ativa é o primeiro pagamento", async () => {
    const { p } = provedor(RESPOSTA_REAL);
    const r = await p.criarAssinatura(pedido);
    expect(r.ativaImediatamente).toBe(false);
  });

  it("manda a chave Pix e corta os campos que o gateway limita a 35", async () => {
    const { p, chamadas } = provedor(RESPOSTA_REAL);
    await p.criarAssinatura({ ...pedido, descricao: "M".repeat(60) });
    const corpo = chamadas[0]!.body as {
      immediateQrCode: { pixKey: string; originalValue: number };
      description: string;
      contractId: string;
    };
    expect(corpo.immediateQrCode.pixKey).toBe("598a0dac-0000-0000-0000-000000000000");
    // Centavos viram reais na borda, e só na borda.
    expect(corpo.immediateQrCode.originalValue).toBe(5);
    expect(corpo.description.length).toBe(35);
    expect(corpo.contractId.length).toBeLessThanOrEqual(35);
  });

  it("sem chave Pix configurada, recusa antes de chamar o gateway", async () => {
    const { fake, chamadas } = fetchFalso(RESPOSTA_REAL);
    const p = new AsaasProvedor(configFalsa({ chavePix: "" }));
    p.buscar = fake;
    await expect(p.criarAssinatura(pedido)).rejects.toThrow(/chave Pix/i);
    expect(chamadas).toHaveLength(0);
  });
});

describe("assinatura comum", () => {
  const pedido = {
    clienteId: "cus_000000001",
    ciclo: "MENSAL" as const,
    valorCentavos: 189000,
    primeiroVencimento: "2026-10-10",
    descricao: "Movatruck — Transportes Aurora",
    referenciaExterna: "ref-1",
  };

  it("Pix comum já nasce valendo — não há o que autorizar", async () => {
    const { p } = provedor({ id: "sub_1" });
    const r = await p.criarAssinatura({ ...pedido, forma: "PIX" });
    expect(r.ativaImediatamente).toBe(true);
  });

  it("cartão espera a primeira captura antes de valer", async () => {
    const { p } = provedor({ id: "sub_1" });
    const r = await p.criarAssinatura({ ...pedido, forma: "CARTAO" });
    expect(r.ativaImediatamente).toBe(false);
  });

  it("traduz a forma pro billingType do gateway", async () => {
    const { p, chamadas } = provedor({ id: "sub_1" });
    await p.criarAssinatura({ ...pedido, forma: "BOLETO" });
    expect((chamadas[0]!.body as { billingType: string }).billingType).toBe("BOLETO");
  });
});

describe("erros do gateway", () => {
  it("a mensagem que vai pra tela é a do gateway, escrita pra humano", async () => {
    const { p } = provedor({ errors: [{ description: "CPF/CNPJ inválido" }] }, 400);
    await expect(
      p.garantirCliente({
        nome: "X",
        documento: "1",
        email: "a@b.com",
        telefone: "5541999998888",
        referenciaExterna: "c1",
      }),
    ).rejects.toThrow("CPF/CNPJ inválido");
  });

  it("400 de validação não é transitório; 500 é", async () => {
    for (const [status, transitorio] of [
      [400, false],
      [429, true],
      [500, true],
    ] as const) {
      const { p } = provedor({ errors: [{ description: "erro" }] }, status);
      await p
        .buscarCobranca("pay_1")
        .then(() => expect.fail("deveria ter lançado"))
        .catch((e) => expect(e.transitorio).toBe(transitorio));
    }
  });

  it("404 ao buscar cobrança devolve null em vez de explodir", async () => {
    const { p } = provedor({ errors: [{ description: "nao encontrado" }] }, 404);
    await expect(p.buscarCobranca("pay_inexistente")).resolves.toBeNull();
  });
});

describe("centavos e reais", () => {
  it("R$ 189,90 não vira R$ 189,89 no caminho de volta", () => {
    // 189.9 * 100 dá 18989.999999999996 em ponto flutuante.
    expect(reaisParaCentavos(189.9)).toBe(18990);
    expect(centavosParaReais(189000)).toBe(1890);
  });
});
