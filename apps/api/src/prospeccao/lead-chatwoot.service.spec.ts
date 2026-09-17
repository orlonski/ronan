import { describe, it, expect, vi } from "vitest";
import { telefoneDiscavel } from "@ronan/shared-types";
import { LeadChatwootService } from "./lead-chatwoot.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ChatwootClientService } from "../chatwoot/chatwoot-client.service";

const LEAD = {
  id: "lead-1",
  empresa: "Transportes Teste Ltda",
  nome: "Maria",
  telefone: "43999912345",
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
  chatwootConversaId: null as number | null,
};

function montar(over: Partial<typeof LEAD> = {}, opts: { configurado?: boolean } = {}) {
  const update = vi.fn(async () => ({}));
  const findUnique = vi.fn(async () => ({ ...LEAD, ...over }));
  const findMany = vi.fn(async (_args: { where?: Record<string, unknown> }) => [
    { id: "lead-1", empresa: "Transportes Teste Ltda", nome: "Maria", telefone: "43999912345" },
  ]);
  const count = vi.fn(async () => 0);
  const garantirContato = vi.fn(async () => ({ contatoId: 77, sourceId: "+5543999912345" }));
  const criarConversa = vi.fn(async () => 999);
  const atualizarContato = vi.fn(
    async (
      _contaId: number,
      _contatoId: number,
      _dados: {
        additional_attributes?: Record<string, unknown>;
        custom_attributes?: Record<string, unknown>;
      },
    ) => true,
  );
  const s = new LeadChatwootService(
    { lead: { update, findUnique, findMany, count } } as unknown as PrismaService,
    {
      configurado: () => opts.configurado ?? true,
      contaPadrao: async () => 1,
      inboxPadrao: async () => 5,
      garantirContato,
      criarConversa,
      atualizarContato,
      linkDaConversa: (conta: number | null, conversa: number | null) =>
        conta && conversa ? `https://cw.teste/app/accounts/${conta}/conversations/${conversa}` : null,
    } as unknown as ChatwootClientService,
  );
  return { s, update, atualizarContato, garantirContato, criarConversa, findMany };
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
    const enviado = atualizarContato.mock.calls[0]?.[2];
    expect(enviado?.additional_attributes).not.toHaveProperty("company_name");
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


describe("subir os leads como contatos", () => {
  it("cria o contato com o telefone em E.164 e a empresa na frente", async () => {
    const { s, garantirContato, update } = montar();
    const r = await s.sincronizarContatos();
    expect(garantirContato).toHaveBeenCalledWith(1, 5, {
      nome: "Transportes Teste Ltda — Maria",
      telefoneE164: "+5543999912345",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { chatwootContaId: 1, chatwootContatoId: 77 },
    });
    expect(r.criados).toBe(1);
  });

  it("não busca quem pediu pra não ser contatado nem quem já está lá", async () => {
    // O filtro é a defesa: contato no Chatwoot é uma pessoa a um clique de
    // receber mensagem.
    const { s, findMany } = montar();
    await s.sincronizarContatos();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { telefone: { not: null }, optOut: false, chatwootContatoId: null },
    });
  });
});

describe("abrir a conversa a partir da ficha", () => {
  it("cria a conversa, guarda o id e devolve o endereço", async () => {
    const { s, criarConversa, update } = montar({
      chatwootConversaId: null as unknown as number,
    });
    const r = await s.abrirConversa("lead-1");
    expect(criarConversa).toHaveBeenCalledWith(1, 5, 77, "+5543999912345");
    expect(r.conversaId).toBe(999);
    expect(r.url).toContain("/conversations/999");
    expect(update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: { chatwootContaId: 1, chatwootContatoId: 77, chatwootConversaId: 999 },
    });
  });

  it("conversa que já existe não vira uma segunda", async () => {
    // Duas conversas com a mesma empresa partem o histórico em dois, e o
    // atendente responde na metade errada.
    const { s, criarConversa } = montar({ chatwootConversaId: 4242 });
    const r = await s.abrirConversa("lead-1");
    expect(criarConversa).not.toHaveBeenCalled();
    expect(r.conversaId).toBe(4242);
  });

  it("recusa abrir conversa com quem pediu pra não ser contatado", async () => {
    const { s, criarConversa } = montar({ optOut: true, chatwootConversaId: null as unknown as number });
    await expect(s.abrirConversa("lead-1")).rejects.toThrow(/não ser contatada/);
    expect(criarConversa).not.toHaveBeenCalled();
  });

  it("recusa quem não tem telefone de verdade", async () => {
    const { s } = montar({
      telefone: "123" as unknown as string,
      chatwootConversaId: null as unknown as number,
    });
    await expect(s.abrirConversa("lead-1")).rejects.toThrow(/telefone/);
  });
});

describe("o telefone em que dá pra falar (@ronan/shared-types)", () => {
  it("devolve o nono dígito do celular antigo", () => {
    // O cadastro da Receita é de antes de 2016. Recusar esses jogaria fora a
    // maior parte dos telefones da base.
    expect(telefoneDiscavel("4399912345")).toBe("43999912345");
    expect(telefoneDiscavel("4188887777")).toBe("41988887777");
  });

  it("deixa fixo e celular novo como estão", () => {
    expect(telefoneDiscavel("43999912345")).toBe("43999912345");
    expect(telefoneDiscavel("4233353078")).toBe("4233353078");
  });

  it("recusa o que não pode existir", () => {
    expect(telefoneDiscavel("00000000002")).toBeNull();
    expect(telefoneDiscavel("0433353078")).toBeNull();
    expect(telefoneDiscavel("43333530781")).toBeNull();
    expect(telefoneDiscavel("4399991")).toBeNull();
  });
});
