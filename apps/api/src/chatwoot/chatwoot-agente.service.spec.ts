import { describe, it, expect, vi } from "vitest";
import { ChatwootAgenteService } from "./chatwoot-agente.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { SessaoService, SessaoResolvida } from "../whatsapp/sessao.service";
import type { AgenteService } from "../whatsapp/agente/agente.service";
import type { ChatwootClientService } from "./chatwoot-client.service";
import type { LeadChatwootService } from "../prospeccao/lead-chatwoot.service";
import type { ProspeccaoService } from "../prospeccao/prospeccao.service";
import type { ConviteService } from "../whatsapp/convite.service";
import type { SdrService, RespostaSdr } from "../sdr/sdr.service";
import type { ConfigService } from "@nestjs/config";
import type { AtendimentoHumanoService } from "../sdr/atendimento-humano.service";

const MOTORISTA: SessaoResolvida = {
  tipo: "MOTORISTA",
  sessaoId: "sessao-1",
  motoristaId: "motorista-1",
  nome: "Diego",
  contaId: "conta-1",
};

const DESCONHECIDO: SessaoResolvida = { tipo: "DESCONHECIDO", sessaoId: null, contaId: null };

function montar(
  opts: {
    identidade?: SessaoResolvida;
    status?: string;
    resposta?: string;
    agenteAtivo?: boolean;
    contaDoCodigo?: string | null;
    consumirErro?: string;
    /** O que o SDR devolve. `null` = não é comigo (desligado, opt-out, sem chave). */
    respostaSdr?: RespostaSdr | null;
    /** O telefone bate com um lead da base de prospecção? */
    ehLead?: boolean;
    /** O lead encontrado pediu pra não ser mais contatado. */
    leadOptOut?: boolean;
    /** O número está na supressão global, mesmo sem lead. */
    suprimido?: boolean;
    /** A criação do lead falha — `P2002` é a corrida de dois webhooks. */
    createErro?: string;
    /** O SDR explode (falha de IA, timeout). */
    sdrErro?: string;
    /** Id do inbox comercial, como vem do env. Default: "2". */
    inboxComercial?: string;
    /** A conversa JÁ foi etiquetada como precisa-humano numa mensagem anterior. */
    jaEtiquetada?: boolean;
    /** Uma pessoa já assumiu este lead. */
    pausado?: boolean;
    /** A última coisa que o robô disse a ele. */
    ultimaFalaNossa?: string | null;
    /** O número bate com um motorista cadastrado (sem WhatsApp vinculado). */
    motoristaCadastrado?: boolean;
    /** A mensagem de saída foi o robô que mandou. */
    foiORobo?: boolean;
    /** Lead ligado à conversa do Chatwoot (pros eventos de gente). */
    leadDaConversa?: { id: string; sdrPausadoEm: Date | null; primeiraRespostaHumanaEm: Date | null } | null;
  } = {},
) {
  const create = vi.fn(async (_args: { data: { direcao: string } }) => ({}));
  const findUnique = vi.fn(async () => ({ status: opts.status ?? "APROVADO" }));
  const configFind = vi.fn(async () => ({
    ativo: opts.agenteAtivo ?? true,
    mensagemInativo: null,
  }));
  const processar = vi.fn(async () => opts.resposta ?? "Sua última viagem foi conferida.");
  const responder = vi.fn(async (_conta: number, _conversa: number, _texto: string) => true);
  const anotar = vi.fn(async (_conta: number, _conversa: number, _texto: string) => true);
  const passarParaHumano = vi.fn(async (..._a: unknown[]) => {});
  // A conversa ainda não foi etiquetada: é o caso normal, a primeira mensagem.
  // O teste de não-repetição liga isto pra `true`.
  const temEtiqueta = vi.fn(async () => opts.jaEtiquetada ?? false);
  const foiORobo = vi.fn(() => opts.foiORobo ?? false);
  const marcarMensagemRecebida = vi.fn(async () => {});
  const contaDoCodigo = vi.fn(async () => opts.contaDoCodigo ?? null);
  const consumir = vi.fn(async () => {
    if (opts.consumirErro) throw new Error(opts.consumirErro);
    return { motorista: { nome: "Diego Davi" }, user: null };
  });
  const atender = vi.fn(async () => {
    if (opts.sdrErro) throw new Error(opts.sdrErro);
    return opts.respostaSdr ?? null;
  });
  const registrarEntrada = vi.fn(async () => ({}));
  const registrarSaida = vi.fn(async () => ({}));
  let jaCriou = false;
  const leadFindFirst = vi.fn(
    async (args: { where?: { origem?: string; chatwootConversaId?: number } }) => {
      if (args?.where?.chatwootConversaId !== undefined) return opts.leadDaConversa ?? null;
      // A segunda busca, a do tratamento de corrida, procura por origem.
      if (args?.where?.origem === "WHATSAPP_INBOUND") {
        return jaCriou ? { id: "lead-corrida" } : null;
      }
      return opts.ehLead
        ? {
            id: "lead-1",
            empresa: "Transportes Teste",
            status: "NOVO",
            optOut: opts.leadOptOut ?? false,
          }
        : null;
    },
  );
  const leadFindUnique = vi.fn(async () => ({ sdrPausadoEm: opts.pausado ? new Date() : null }));
  const leadUpdate = vi.fn(async (_a: { data: Record<string, unknown> }) => ({}));
  const leadCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => {
    if (opts.createErro) {
      jaCriou = true;
      throw Object.assign(new Error("unique"), { code: opts.createErro });
    }
    return { id: "lead-novo" };
  });
  const interacaoCreate = vi.fn(async () => ({}));
  const supressaoFindFirst = vi.fn(async () => (opts.suprimido ? { contato: "4299998888" } : null));
  const mensagemLeadFindFirst = vi.fn(async () =>
    opts.ultimaFalaNossa ? { conteudo: opts.ultimaFalaNossa } : null,
  );
  const vincular = vi.fn(async () => {});
  const registrarOptOut = vi.fn(async () => ({ contato: "4299998888", tipo: "TELEFONE", leadsMarcados: 1 }));
  const avisar = vi.fn(async () => {});

  const s = new ChatwootAgenteService(
    {
      whatsappMensagem: { create },
      motorista: { findUnique },
      configuracaoAgente: { findUnique: configFind },
      lead: {
        findFirst: leadFindFirst,
        findUnique: leadFindUnique,
        update: leadUpdate,
        create: leadCreate,
      },
      interacaoLead: { create: interacaoCreate },
      supressaoContato: { findFirst: supressaoFindFirst },
      mensagemLead: { findFirst: mensagemLeadFindFirst },
    } as unknown as PrismaService,
    {
      resolverPorTelefone: vi.fn(async () => opts.identidade ?? MOTORISTA),
      motoristaPorCadastro: vi.fn(async () =>
        opts.motoristaCadastrado ? { id: "m-9", nome: "Diego Motorista", conta: "Schaba" } : null,
      ),
      marcarMensagemRecebida,
    } as unknown as SessaoService,
    { processar } as unknown as AgenteService,
    { contaDoCodigo, consumir } as unknown as ConviteService,
    { responder, anotar, passarParaHumano, temEtiqueta, foiORobo } as unknown as ChatwootClientService,
    { atender, registrarEntrada, registrarSaida } as unknown as SdrService,
    { vincular } as unknown as LeadChatwootService,
    { registrarOptOut } as unknown as ProspeccaoService,
    {
      get: (k: string) =>
        k === "CHATWOOT_INBOX_COMERCIAL" ? (opts.inboxComercial ?? "2") : undefined,
    } as unknown as ConfigService,
    {
      mensagemDeRepasse: vi.fn(async (canal: string) =>
        canal === "comercial"
          ? "Certo! Fernando vai falar com você por aqui em instantes."
          : "Certo! Alguém da Movatruck vai falar com você por aqui em instantes.",
      ),
      nomesDaEquipe: vi.fn(async () => ["Fernando", "Diego"]),
      timeDoCanal: vi.fn(async (canal: string) => (canal === "comercial" ? 11 : 22)),
      avisar,
    } as unknown as AtendimentoHumanoService,
  );
  // Sem relógio no teste: a espera da rajada é coberta num teste próprio.
  s.esperaRajadaMs = 0;
  return {
    s,
    vincular,
    registrarOptOut,
    create,
    findUnique,
    processar,
    responder,
    anotar,
    passarParaHumano,
    temEtiqueta,
    consumir,
    atender,
    leadCreate,
    leadUpdate,
    interacaoCreate,
    registrarEntrada,
    registrarSaida,
    avisar,
  };
}

const evento = (over: Record<string, unknown> = {}) => ({
  event: "message_created",
  message_type: "incoming",
  content: "e a viagem de ontem?",
  conversation: { id: 7 },
  account: { id: 1 },
  sender: { phone_number: "+554299998888" },
  ...over,
});


const COMERCIAL = { inbox: { id: 2 } };
const OPERACAO = { inbox: { id: 1 } };

const RESPOSTA: RespostaSdr = {
  texto: "Pra 8 caminhões, sai por *R$ 1.890,00* por mês.",
  silencio: false,
  passarParaHumano: false,
  motivoHumano: null,
  ferramentas: ["consultar_preco"],
};

/** O repasse aconteceu nesta conversa (conta 1, conversa 7). */
const repassou = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.some((c) => c[0] === 1 && c[1] === 7);

describe("quem o agente atende (número de operação)", () => {
  it("motorista aprovado conversa com o agente", async () => {
    const { s, processar, responder } = montar();
    await s.processar(evento(OPERACAO));
    expect(processar).toHaveBeenCalledOnce();
    expect(responder).toHaveBeenCalledWith(1, 7, "Sua última viagem foi conferida.");
  });

  it("número desconhecido nunca chega no agente", async () => {
    // A fronteira é de segurança: com ferramentas do sistema na mão, o agente
    // responderia dado de viagem pra quem digitasse um número por sorte.
    const { s, processar, passarParaHumano } = montar({ identidade: DESCONHECIDO });
    await s.processar(evento(OPERACAO));
    expect(processar).not.toHaveBeenCalled();
    expect(repassou(passarParaHumano)).toBe(true);
  });

  it("motorista com cadastro em análise não conversa com o agente", async () => {
    const { s, processar, passarParaHumano } = montar({ status: "PENDENTE" });
    await s.processar(evento(OPERACAO));
    expect(processar).not.toHaveBeenCalled();
    expect(repassou(passarParaHumano)).toBe(true);
  });
});

describe("o SDR não entra no número de operação", () => {
  it("desconhecido na operação vai pra gente, não pro robô de vendas nem vira lead", async () => {
    // O caso real: motorista da Schaba perguntando de ticket com divergência
    // recebeu doze perguntas de venda, até dizer "Eu sou só motorista".
    const { s, atender, leadCreate, passarParaHumano, responder } = montar({
      identidade: DESCONHECIDO,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...OPERACAO, content: "Sobre a nota com divergência" }));
    expect(atender).not.toHaveBeenCalled();
    expect(leadCreate).not.toHaveBeenCalled();
    expect(responder.mock.calls[0]?.[2]).toContain("Alguém da Movatruck");
    // Time da operação, não o comercial.
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7, 22, []);
  });

  it("motorista cadastrado sem WhatsApp vinculado: nota pra equipe e etiqueta", async () => {
    const { s, anotar, passarParaHumano, atender } = montar({
      identidade: DESCONHECIDO,
      motoristaCadastrado: true,
    });
    await s.processar(evento({ ...OPERACAO, content: "Gostaria de atualizar o app" }));
    expect(atender).not.toHaveBeenCalled();
    expect(anotar.mock.calls[0]?.[2]).toContain("Diego Motorista");
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7, 22, ["motorista"]);
  });

  it("aviso automático de ausência não recebe resposta nenhuma", async () => {
    const { s, responder, passarParaHumano } = montar({ identidade: DESCONHECIDO });
    await s.processar(
      evento({
        ...OPERACAO,
        content: "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível.",
      }),
    );
    expect(responder).not.toHaveBeenCalled();
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("lead que já existia e responde pela operação vai pro comercial, com alerta", async () => {
    const { s, atender, passarParaHumano, avisar } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...OPERACAO, content: "recebi a mensagem de vocês, quanto é?" }));
    expect(atender).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7, 11, []);
    expect(avisar).toHaveBeenCalledOnce();
  });

  it("áudio na operação vai pra gente COM uma palavra de volta", async () => {
    const { s, processar, responder, passarParaHumano } = montar();
    await s.processar(evento({ ...OPERACAO, content: "" }));
    expect(processar).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalled();
    expect(repassou(passarParaHumano)).toBe(true);
  });
});

describe("o que o agente ignora", () => {
  it("ignora a mensagem que o próprio robô mandou", async () => {
    // Sem isto o robô responde à própria resposta, em loop.
    const { s, processar, responder, leadUpdate } = montar({ foiORobo: true });
    await s.processar(evento({ message_type: "outgoing" }));
    expect(processar).not.toHaveBeenCalled();
    expect(responder).not.toHaveBeenCalled();
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it("evento de conversa sem gesto de gente não mexe em nada", async () => {
    const { s, leadUpdate } = montar({
      leadDaConversa: { id: "lead-1", sdrPausadoEm: null, primeiraRespostaHumanaEm: null },
    });
    await s.processar({
      event: "conversation_updated",
      id: 7,
      changed_attributes: [{ first_reply_created_at: { previous_value: null, current_value: "x" } }],
    });
    expect(leadUpdate).not.toHaveBeenCalled();
  });
});

describe("quando o agente do motorista não dá conta", () => {
  it("resposta vazia vira fila humana", async () => {
    const { s, responder, passarParaHumano } = montar({ resposta: "   " });
    await s.processar(evento(OPERACAO));
    expect(responder).not.toHaveBeenCalled();
    expect(repassou(passarParaHumano)).toBe(true);
  });

  it("erro no meio do caminho não derruba o webhook", async () => {
    const { s } = montar();
    await expect(
      s.processar(evento({ conversation: undefined, account: undefined })),
    ).resolves.toBeUndefined();
  });

  it("grava entrada e saída pro agente ter memória no próximo turno", async () => {
    const { s, create } = montar();
    await s.processar(evento(OPERACAO));
    const direcoes = create.mock.calls.map((c) => c[0].data.direcao);
    expect(direcoes).toEqual(["ENTRADA", "SAIDA"]);
  });

  it("agente desligado no painel não responde pelo Chatwoot", async () => {
    const { s, processar, passarParaHumano } = montar({ agenteAtivo: false });
    await s.processar(evento(OPERACAO));
    expect(processar).not.toHaveBeenCalled();
    expect(repassou(passarParaHumano)).toBe(true);
  });
});

describe("vínculo por código de convite", () => {
  it("código válido vincula o telefone e não vira ticket", async () => {
    const { s, consumir, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      contaDoCodigo: "conta-1",
    });
    await s.processar(evento({ ...OPERACAO, content: "A1B2C3" }));
    expect(consumir).toHaveBeenCalledOnce();
    expect(responder.mock.calls[0]?.[2]).toContain("vinculado");
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("código expirado responde o motivo, sem abrir ticket", async () => {
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      contaDoCodigo: "conta-1",
      consumirErro: "Código expirou",
    });
    await s.processar(evento({ ...OPERACAO, content: "A1B2C3" }));
    expect(responder).toHaveBeenCalledWith(1, 7, "Código expirou");
    expect(passarParaHumano).not.toHaveBeenCalled();
  });
});

describe("o SDR atendendo prospect no comercial", () => {
  it("lead conhecido é atendido pelo SDR, sem virar ticket", async () => {
    const { s, responder, passarParaHumano, atender } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "quanto custa?" }));
    expect(atender).toHaveBeenCalledWith("lead-1", "quanto custa?");
    expect(responder).toHaveBeenCalledWith(1, 7, RESPOSTA.texto);
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("quem escreveu sem estar na base vira lead e é atendido na hora", async () => {
    const { s, atender, leadCreate, responder } = montar({
      identidade: DESCONHECIDO,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "quanto custa?" }));
    expect(leadCreate).toHaveBeenCalledOnce();
    expect(atender).toHaveBeenCalledWith("lead-novo", "quanto custa?");
    expect(responder).toHaveBeenCalledWith(1, 7, RESPOSTA.texto);
  });

  it("o lead nasce com o telefone no formato da casa, sem o DDI", async () => {
    const { s, leadCreate } = montar({ identidade: DESCONHECIDO, respostaSdr: RESPOSTA });
    await s.processar(evento({ ...COMERCIAL, content: "oi, vi o instagram de vocês" }));
    const dados = leadCreate.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(dados.telefone).toBe("4299998888");
    expect(dados.origem).toBe("WHATSAPP_INBOUND");
    expect(dados.status).toBe("EM_CONTATO");
  });

  it("o nome do perfil vira a pessoa, mas o número disfarçado de nome não", async () => {
    const comNome = montar({ identidade: DESCONHECIDO, respostaSdr: RESPOSTA });
    await comNome.s.processar(
      evento({ ...COMERCIAL, sender: { phone_number: "+554299998888", name: "Sérgio" } }),
    );
    expect((comNome.leadCreate.mock.calls[0]?.[0].data as { nome: unknown }).nome).toBe("Sérgio");

    const semNome = montar({ identidade: DESCONHECIDO, respostaSdr: RESPOSTA });
    await semNome.s.processar(
      evento({ ...COMERCIAL, sender: { phone_number: "+554299998888", name: "+55 42 99998888" } }),
    );
    expect((semNome.leadCreate.mock.calls[0]?.[0].data as { nome: unknown }).nome).toBeNull();
  });

  it("quem está em opt-out não é atendido nem vira lead novo", async () => {
    const { s, atender, leadCreate, interacaoCreate } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      leadOptOut: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "quanto custa?" }));
    expect(leadCreate).not.toHaveBeenCalled();
    expect(atender).not.toHaveBeenCalled();
    expect(interacaoCreate).toHaveBeenCalledOnce();
  });

  it("número na supressão global não vira lead, mesmo sem cadastro", async () => {
    const { s, atender, leadCreate } = montar({
      identidade: DESCONHECIDO,
      suprimido: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "quanto custa?" }));
    expect(leadCreate).not.toHaveBeenCalled();
    expect(atender).not.toHaveBeenCalled();
  });

  it("duas mensagens ao mesmo tempo não viram dois leads", async () => {
    const { s, atender } = montar({
      identidade: DESCONHECIDO,
      createErro: "P2002",
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "boa tarde" }));
    expect(atender).toHaveBeenCalledWith("lead-corrida", "boa tarde");
  });

  it("SDR desligado devolve a conversa pra gente, com nome e prazo", async () => {
    const { s, responder, passarParaHumano, avisar } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: null,
    });
    await s.processar(evento({ ...COMERCIAL, content: "quanto custa?" }));
    expect(responder.mock.calls[0]?.[2]).toContain("Fernando vai falar com você");
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7, 11, []);
    expect(avisar).toHaveBeenCalledOnce();
  });

  it("quando o SDR pede humano, ele responde, encaminha e avisa — sem repetir frase", async () => {
    const { s, responder, passarParaHumano, avisar } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: {
        texto: "Isso quem acerta é o Fernando — ele fala com você por aqui.",
        silencio: false,
        passarParaHumano: true,
        motivoHumano: "quer negociar preço",
        ferramentas: ["passar_para_humano"],
      },
    });
    await s.processar(evento({ ...COMERCIAL, content: "consegue fazer por 1200?" }));
    expect(responder).toHaveBeenCalledOnce();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7, 11, []);
    expect(avisar).toHaveBeenCalledWith("lead-1", "quer negociar preço", "consegue fazer por 1200?", 7);
  });

  it("SDR que explode cai na fila humana, sem derrubar o webhook", async () => {
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      sdrErro: "timeout do provider",
    });
    await s.processar(evento({ ...COMERCIAL, content: "quanto custa?" }));
    expect(responder).toHaveBeenCalledOnce();
    expect(repassou(passarParaHumano)).toBe(true);
  });

  it("silêncio decidido pelo SDR não envia nada e não vai pra fila", async () => {
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: { ...RESPOSTA, texto: "", silencio: true },
    });
    await s.processar(evento({ ...COMERCIAL, content: "hmm" }));
    expect(responder).not.toHaveBeenCalled();
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("motorista conhecido que escreve no comercial NÃO fala com o agente dele", async () => {
    const { s, processar } = montar();
    await s.processar(evento(COMERCIAL));
    expect(processar).not.toHaveBeenCalled();
  });

  it("não repete o aviso de fila humana na segunda mensagem seguida", async () => {
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      jaEtiquetada: true,
      respostaSdr: null,
    });
    await s.processar(evento(COMERCIAL));
    expect(responder).not.toHaveBeenCalled();
    expect(repassou(passarParaHumano)).toBe(true);
  });

  it("áudio no comercial vai pra uma pessoa, sem virar lead nem acordar o SDR", async () => {
    const { s, atender, responder, leadCreate, avisar } = montar({ identidade: DESCONHECIDO, ehLead: true });
    await s.processar(evento({ ...COMERCIAL, content: "" }));
    expect(atender).not.toHaveBeenCalled();
    expect(leadCreate).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledOnce();
  });
});

/**
 * O pedido do dono, com as palavras dele: "se pedir pra falar com humano ou o
 * Fernando (ou outra pessoa) marcar algo no Chatwoot, não ter mais interação
 * do agente".
 */
describe("gente na conversa, robô fora", () => {
  it("'quero falar com o Fernando' → uma frase, repasse, alerta — sem modelo", async () => {
    const { s, atender, responder, passarParaHumano, avisar } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "quero falar com o Fernando" }));
    expect(atender).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalledOnce();
    expect(responder.mock.calls[0]?.[2]).toContain("Fernando");
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7, 11, []);
    expect(avisar).toHaveBeenCalledOnce();
  });

  it("'QUEM VAI ME ATENDER' também é pedido de gente", async () => {
    const { s, atender, avisar } = montar({ identidade: DESCONHECIDO, ehLead: true, respostaSdr: RESPOSTA });
    await s.processar(evento({ ...COMERCIAL, content: "QUEM VAI ME ATENDER" }));
    expect(atender).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledOnce();
  });

  it("'Pode ser' depois de o robô oferecer uma pessoa é aceite", async () => {
    const { s, atender, avisar } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: RESPOSTA,
      ultimaFalaNossa: "Sou o atendimento automático. Quer que o Fernando te chame agora?",
    });
    await s.processar(evento({ ...COMERCIAL, content: "Pode ser" }));
    expect(atender).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledOnce();
  });

  it("com gente na conversa, mensagem nova do lead não acorda o robô", async () => {
    const { s, atender, responder, passarParaHumano, registrarEntrada } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      pausado: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "N sei dq é a empresa" }));
    expect(atender).not.toHaveBeenCalled();
    expect(responder).not.toHaveBeenCalled();
    expect(passarParaHumano).not.toHaveBeenCalled();
    // A fala fica na ficha.
    expect(registrarEntrada).toHaveBeenCalledWith("lead-1", "N sei dq é a empresa");
  });

  it("pessoa escrevendo pelo Chatwoot cala o robô e conta como primeira resposta", async () => {
    const { s, leadUpdate, registrarSaida } = montar({
      leadDaConversa: { id: "lead-1", sdrPausadoEm: null, primeiraRespostaHumanaEm: null },
    });
    await s.processar(
      evento({
        message_type: "outgoing",
        content: "Olá Diana, sou o Fernando",
        sender: { name: "Fernando", type: "user" },
      }),
    );
    const dados = leadUpdate.mock.calls[0]?.[0].data;
    expect(dados?.sdrPausadoEm).toBeInstanceOf(Date);
    expect(dados?.primeiraRespostaHumanaEm).toBeInstanceOf(Date);
    expect(registrarSaida).toHaveBeenCalledWith("lead-1", "[Fernando] Olá Diana, sou o Fernando");
  });

  it("nota privada cala o robô, mas não conta como resposta ao lead", async () => {
    const { s, leadUpdate } = montar({
      leadDaConversa: { id: "lead-1", sdrPausadoEm: null, primeiraRespostaHumanaEm: null },
    });
    await s.processar(
      evento({ message_type: "outgoing", private: true, content: "vou ligar pra ela", sender: { type: "user" } }),
    );
    const dados = leadUpdate.mock.calls[0]?.[0].data;
    expect(dados?.sdrPausadoEm).toBeInstanceOf(Date);
    expect(dados?.primeiraRespostaHumanaEm).toBeUndefined();
  });

  it("atribuir a conversa no Chatwoot cala o robô", async () => {
    const { s, leadUpdate } = montar({
      leadDaConversa: { id: "lead-1", sdrPausadoEm: null, primeiraRespostaHumanaEm: null },
    });
    await s.processar({
      event: "conversation_updated",
      id: 7,
      changed_attributes: [{ assignee_id: { previous_value: null, current_value: 3 } }],
    });
    expect(leadUpdate.mock.calls[0]?.[0].data.sdrPausadoEm).toBeInstanceOf(Date);
  });

  it("pôr etiqueta ou resolver também calam", async () => {
    const mudancas: Record<string, { previous_value: unknown; current_value: unknown }>[] = [
      { label_list: { previous_value: [], current_value: ["quente"] } },
      { status: { previous_value: "open", current_value: "resolved" } },
    ];
    for (const mudanca of mudancas) {
      const { s, leadUpdate } = montar({
        leadDaConversa: { id: "lead-1", sdrPausadoEm: null, primeiraRespostaHumanaEm: null },
      });
      await s.processar({ event: "conversation_updated", id: 7, changed_attributes: [mudanca] });
      expect(leadUpdate).toHaveBeenCalledOnce();
    }
  });
});

describe("ruído não se responde", () => {
  it("aviso de ausência no comercial: silêncio", async () => {
    const { s, atender, responder } = montar({ identidade: DESCONHECIDO, ehLead: true, respostaSdr: RESPOSTA });
    await s.processar(
      evento({ ...COMERCIAL, content: "S A carlesso Transportes Ltda agradece seu contato. Em breve retornaremos o contato... obrigado" }),
    );
    expect(atender).not.toHaveBeenCalled();
    expect(responder).not.toHaveBeenCalled();
  });

  it("👍 depois de uma fala nossa: silêncio", async () => {
    const { s, atender, responder } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: RESPOSTA,
      ultimaFalaNossa: "Beleza, até mais.",
    });
    await s.processar(evento({ ...COMERCIAL, content: "👍" }));
    expect(atender).not.toHaveBeenCalled();
    expect(responder).not.toHaveBeenCalled();
  });

  it("'oi' como primeira mensagem ainda é respondido", async () => {
    const { s, atender } = montar({ identidade: DESCONHECIDO, ehLead: true, respostaSdr: RESPOSTA });
    await s.processar(evento({ ...COMERCIAL, content: "Oi" }));
    expect(atender).toHaveBeenCalled();
  });
});

describe("rajada de mensagens", () => {
  it("três balões seguidos viram UMA resposta", async () => {
    const { s, atender, registrarEntrada } = montar({ identidade: DESCONHECIDO, ehLead: true, respostaSdr: RESPOSTA });
    s.esperaRajadaMs = 30;
    await Promise.all([
      s.processar(evento({ ...COMERCIAL, content: "oi" })),
      s.processar(evento({ ...COMERCIAL, content: "tudo bem?" })),
      s.processar(evento({ ...COMERCIAL, content: "quero saber o preço" })),
    ]);
    expect(atender).toHaveBeenCalledOnce();
    expect(atender).toHaveBeenCalledWith("lead-1", "quero saber o preço");
    expect(registrarEntrada).toHaveBeenCalledTimes(2);
  });
});

describe("o lead e a conversa ficam ligados", () => {
  it("guarda conta, contato e conversa do Chatwoot no lead", async () => {
    const { s, vincular } = montar({ identidade: DESCONHECIDO, ehLead: true });
    await s.processar(evento({ ...COMERCIAL, sender: { id: 55, phone_number: "+554299998888" } }));
    expect(vincular).toHaveBeenCalledWith("lead-1", { contaId: 1, contatoId: 55, conversaId: 7 });
  });

  it("vincula também quem pediu pra não ser contatado", async () => {
    const { s, vincular, atender } = montar({ identidade: DESCONHECIDO, ehLead: true, leadOptOut: true });
    await s.processar(evento({ ...COMERCIAL, sender: { id: 55, phone_number: "+554299998888" } }));
    expect(atender).not.toHaveBeenCalled();
    expect(vincular).toHaveBeenCalledWith("lead-1", expect.objectContaining({ contatoId: 55 }));
  });

  it("número na supressão não vira lead nem vínculo", async () => {
    const { s, vincular, leadCreate } = montar({ identidade: DESCONHECIDO, suprimido: true });
    await s.processar(evento({ ...COMERCIAL, sender: { id: 55, phone_number: "+554299998888" } }));
    expect(leadCreate).not.toHaveBeenCalled();
    expect(vincular).not.toHaveBeenCalled();
  });
});

describe("quando a pessoa pede pra parar", () => {
  it("SAIR tira da lista, confirma e não chama o SDR", async () => {
    const { s, registrarOptOut, atender, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
    });
    await s.processar(evento({ ...COMERCIAL, content: "SAIR" }));
    expect(registrarOptOut).toHaveBeenCalledWith(
      "4299998888",
      expect.stringContaining("pediu no WhatsApp"),
      "WHATSAPP",
    );
    expect(atender).not.toHaveBeenCalled();
    expect(passarParaHumano).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalledWith(1, 7, expect.stringContaining("tirei seu número"));
  });

  it("vale também no número de operação", async () => {
    const { s, registrarOptOut } = montar({ identidade: DESCONHECIDO, ehLead: true });
    await s.processar(evento({ ...OPERACAO, content: "não quero mais" }));
    expect(registrarOptOut).toHaveBeenCalled();
  });

  it("não confunde negociação com desistência", async () => {
    const { s, registrarOptOut, atender } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ ...COMERCIAL, content: "não quero pagar caro nisso" }));
    expect(registrarOptOut).not.toHaveBeenCalled();
    expect(atender).toHaveBeenCalled();
  });
});
