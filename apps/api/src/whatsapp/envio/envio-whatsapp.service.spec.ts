import { describe, it, expect, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { EnvioWhatsappService } from "./envio-whatsapp.service";
import type { ProvedorWhatsapp } from "@ronan/shared-types";
import type { EnvioWhatsapp, ResultadoEnvio } from "./envio.types";
import type { EvolutionProvedor } from "./evolution.provedor";
import type { MetaProvedor } from "./meta.provedor";
import type { RoteamentoWhatsappService } from "./roteamento.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";

/** Um provedor de mentira, pra poder testar a fachada sem rede. */
function provedorFake(
  opts: {
    configurado?: boolean;
    resultado?: Partial<ResultadoEnvio>;
    nome?: ProvedorWhatsapp;
  } = {},
) {
  const nome = opts.nome ?? "evolution";
  const enviar = vi.fn(
    async (): Promise<ResultadoEnvio> => ({
      enviado: true,
      provedor: nome,
      idExterno: "ABC123",
      ...opts.resultado,
    }),
  );
  return { nome, configurado: () => opts.configurado ?? true, enviar };
}

/**
 * Roteamento de mentira: manda tudo pro Evolution, como o padrão de hoje. O
 * roteamento de verdade tem spec próprio (`roteamento.service.spec.ts`).
 */
function roteamentoFake(provedor: "evolution" | "meta" = "evolution") {
  return {
    resolver: vi.fn(async () => ({ provedor, motivo: "teste" })),
  };
}

/**
 * Prisma de mentira. `create` sempre estoura pra provar o ponto que mais
 * importa: registrar o envio NUNCA pode fazer o envio falhar.
 */
function prismaFake(opts: { falha?: boolean } = {}) {
  const create = vi.fn(async (args: unknown) => {
    if (opts.falha) throw new Error("banco fora do ar");
    return args;
  });
  return { whatsappMensagem: { create } };
}

function servico(
  fake: ReturnType<typeof provedorFake>,
  roteia: "evolution" | "meta" = "evolution",
  prisma = prismaFake(),
  meta = provedorFake({ nome: "meta" }),
) {
  return new EnvioWhatsappService(
    fake as unknown as EvolutionProvedor,
    meta as unknown as MetaProvedor,
    roteamentoFake(roteia) as unknown as RoteamentoWhatsappService,
    prisma as unknown as PrismaService,
  );
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

describe("rota apontada pra Meta", () => {
  it("sai pela Meta, e o Evolution nem é tocado", async () => {
    // Até a Fase 3 a fachada caía no Evolution com um warn, porque a Meta não
    // existia no código. Agora existe — e o silêncio dessa troca era o risco:
    // o painel diria "Meta" e a mensagem sairia pelo canal banido.
    const evolution = provedorFake();
    const meta = provedorFake({ nome: "meta" });
    const r = await servico(evolution, "meta", prismaFake(), meta).tentarEnviar(
      paraMotorista("RESUMO_MOTORISTA"),
    );
    expect(r.enviado).toBe(true);
    expect(r.provedor).toBe("meta");
    expect(meta.enviar).toHaveBeenCalledOnce();
    expect(evolution.enviar).not.toHaveBeenCalled();
  });

  it("Meta desconfigurada não escorrega pro Evolution", async () => {
    // Cair pro Evolution porque a Meta não respondeu é usar de propósito o
    // canal que o WhatsApp sinalizou. Prefere-se não enviar e registrar.
    const evolution = provedorFake();
    const meta = provedorFake({ nome: "meta", configurado: false });
    const r = await servico(evolution, "meta", prismaFake(), meta).tentarEnviar(
      paraMotorista("RESUMO_MOTORISTA"),
    );
    expect(r.enviado).toBe(false);
    expect(r.provedor).toBe("meta");
    expect(r.erro?.codigo).toBe("PROVEDOR_NAO_CONFIGURADO");
    expect(evolution.enviar).not.toHaveBeenCalled();
  });
});

describe("EnvioWhatsappService.disponivel", () => {
  it("diz o nome do provedor no motivo, pra o painel mostrar", async () => {
    await expect(
      servico(provedorFake({ configurado: false })).disponivel("RESUMO_GESTOR"),
    ).resolves.toEqual({
      ok: false,
      motivo: "WhatsApp (Evolution) não está configurado no servidor.",
    });
  });

  it("ok quando configurado", async () => {
    await expect(servico(provedorFake()).disponivel("RESUMO_GESTOR")).resolves.toEqual({ ok: true });
  });
});

describe("rastro do envio", () => {
  it("grava por onde saiu, qual era e quanto custou", async () => {
    const prisma = prismaFake();
    const s = servico(provedorFake(), "evolution", prisma);
    await comConta("conta-1", () => s.tentarEnviar(paraMotorista("OTP_CADASTRO")));

    expect(prisma.whatsappMensagem.create).toHaveBeenCalledOnce();
    const { data } = prisma.whatsappMensagem.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.direcao).toBe("SAIDA");
    expect(data.rota).toBe("OTP_CADASTRO");
    expect(data.provedor).toBe("evolution");
    expect(data.idExterno).toBe("ABC123");
    // No Evolution não se paga por mensagem — custo zero e sem categoria.
    expect(data.categoria).toBeNull();
    expect(data.custoEstimado).toBe(0);
  });

  it("grava também o envio que NÃO saiu — o histórico do agente precisa dele", async () => {
    const prisma = prismaFake();
    const s = servico(provedorFake({ configurado: false }), "evolution", prisma);
    await comConta("conta-1", () => s.tentarEnviar(paraMotorista("RESPOSTA_AGENTE")));
    expect(prisma.whatsappMensagem.create).toHaveBeenCalledOnce();
  });

  it("banco fora do ar NÃO derruba o envio", async () => {
    // A mensagem já foi entregue quando o registro roda. Um erro de INSERT não
    // pode virar 503 pro motorista que está esperando o código.
    const s = servico(provedorFake(), "evolution", prismaFake({ falha: true }));
    const r = await comConta("conta-1", () => s.enviarOuFalhar(paraMotorista("OTP_CADASTRO")));
    expect(r.enviado).toBe(true);
  });

  it("sem conta no contexto não tenta gravar — é o caminho do código de senha", async () => {
    // A tabela é escopada por conta; sem conta a linha morreria na FK. Perder o
    // registro é melhor que perder o envio.
    const prisma = prismaFake();
    const s = servico(provedorFake(), "evolution", prisma);
    const r = await comoSistema(() => s.tentarEnviar(paraMotorista("OTP_SENHA")));
    expect(r.enviado).toBe(true);
    expect(prisma.whatsappMensagem.create).not.toHaveBeenCalled();
  });
});
