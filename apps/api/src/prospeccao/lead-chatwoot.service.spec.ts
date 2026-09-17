import { describe, it, expect, vi } from "vitest";
import { LeadChatwootService } from "./lead-chatwoot.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ChatwootClientService } from "../chatwoot/chatwoot-client.service";

const LEAD = {
  empresa: "Transportes Teste Ltda",
  nomeFantasia: "Teste Log",
  cnpj: "12345678000190",
  rntrc: "12345678",
  municipio: "Ponta Grossa",
  uf: "PR",
  socio: "Maria Silva",
  porte: "ME",
  frotaQtd: 4,
  score: 88,
  status: "PROPOSTA",
  optOut: false,
  origem: "PROSPECCAO_ATIVA",
  chatwootContaId: 1,
  chatwootContatoId: 55,
};

function montar(over: Partial<typeof LEAD> = {}, opts: { configurado?: boolean } = {}) {
  const update = vi.fn(async () => ({}));
  const findUnique = vi.fn(async () => ({ ...LEAD, ...over }));
  const atualizarContato = vi.fn(async () => true);
  const s = new LeadChatwootService(
    { lead: { update, findUnique } } as unknown as PrismaService,
    {
      configurado: () => opts.configurado ?? true,
      atualizarContato,
      linkDaConversa: (conta: number | null, conversa: number | null) =>
        conta && conversa ? `https://cw.teste/app/accounts/${conta}/conversations/${conversa}` : null,
    } as unknown as ChatwootClientService,
  );
  return { s, update, atualizarContato };
}

describe("a ficha que o atendimento recebe", () => {
  it("manda empresa, cidade, CNPJ e situação no funil", async () => {
    const { s, atualizarContato } = montar();
    await s.sincronizar("lead-1");
    expect(atualizarContato).toHaveBeenCalledWith(1, 55, {
      additional_attributes: expect.objectContaining({
        company_name: "Transportes Teste Ltda",
        city: "Ponta Grossa/PR",
      }),
      custom_attributes: expect.objectContaining({
        cnpj: "12345678000190",
        situacao_funil: "Proposta enviada",
        nota_lead: 88,
      }),
    });
  });

  it("opt-out vira aviso na cara de quem vai responder", async () => {
    const { s, atualizarContato } = montar({ optOut: true });
    await s.sincronizar("lead-1");
    expect(atualizarContato.mock.calls[0]?.[2]).toMatchObject({
      custom_attributes: expect.objectContaining({ nao_contatar: "SIM" }),
    });
  });

  it("não manda o carimbo interno como nome da empresa", async () => {
    // "Contato pelo WhatsApp" é o placeholder de empresa que ninguém
    // descobriu ainda — o atendente leria isso achando que é o cliente.
    const { s, atualizarContato } = montar({ empresa: "Contato pelo WhatsApp" });
    await s.sincronizar("lead-1");
    const enviado = atualizarContato.mock.calls[0]?.[2] as {
      additional_attributes: Record<string, unknown>;
    };
    expect(enviado.additional_attributes).not.toHaveProperty("company_name");
  });

  it("lead que nunca escreveu no WhatsApp não vira chamada nenhuma", async () => {
    const { s, atualizarContato } = montar({ chatwootContatoId: null as unknown as number });
    await s.sincronizar("lead-1");
    expect(atualizarContato).not.toHaveBeenCalled();
  });

  it("sem Chatwoot configurado não tenta nada", async () => {
    const { s, atualizarContato } = montar({}, { configurado: false });
    await s.sincronizar("lead-1");
    expect(atualizarContato).not.toHaveBeenCalled();
  });
});

describe("o vínculo com a conversa", () => {
  it("grava os ids e já manda a ficha", async () => {
    const { s, update, atualizarContato } = montar();
    await s.vincular("lead-1", { contaId: 1, contatoId: 55, conversaId: 9 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { chatwootContaId: 1, chatwootConversaId: 9, chatwootContatoId: 55 },
    });
    expect(atualizarContato).toHaveBeenCalled();
  });

  it("payload sem contato não apaga o contato que já estava lá", async () => {
    const { s, update } = montar();
    await s.vincular("lead-1", { contaId: 1, contatoId: null, conversaId: 9 });
    expect(update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { chatwootContaId: 1, chatwootConversaId: 9 },
    });
  });

  it("falha do Chatwoot nunca sobe pra quem chamou", async () => {
    // Quem chama é o webhook, que precisa responder 200 — e o painel, que
    // precisa salvar. Enfeitar contato não pode derrubar nenhum dos dois.
    const s = new LeadChatwootService(
      {
        lead: {
          update: vi.fn(async () => {
            throw new Error("banco caiu");
          }),
          findUnique: vi.fn(async () => LEAD),
        },
      } as unknown as PrismaService,
      { configurado: () => true, atualizarContato: vi.fn() } as unknown as ChatwootClientService,
    );
    await expect(
      s.vincular("lead-1", { contaId: 1, contatoId: 55, conversaId: 9 }),
    ).resolves.toBeUndefined();
  });
});

describe("o link da conversa", () => {
  it("sai montado pra ficha do painel", () => {
    const { s } = montar();
    expect(s.linkDaConversa({ chatwootContaId: 1, chatwootConversaId: 9 })).toBe(
      "https://cw.teste/app/accounts/1/conversations/9",
    );
  });

  it("é nulo pra quem nunca conversou", () => {
    const { s } = montar();
    expect(s.linkDaConversa({ chatwootContaId: null, chatwootConversaId: null })).toBeNull();
  });
});
