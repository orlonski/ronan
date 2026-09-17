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
    /** Id do inbox comercial, como vem do env. */
    inboxComercial?: string;
    /** A conversa JÁ foi etiquetada como precisa-humano numa mensagem anterior. */
    jaEtiquetada?: boolean;
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
  const passarParaHumano = vi.fn(async () => {});
  // A conversa ainda não foi etiquetada: é o caso normal, a primeira mensagem.
  // O teste de não-repetição liga isto pra `true`.
  const temEtiqueta = vi.fn(async () => opts.jaEtiquetada ?? false);
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
  let jaCriou = false;
  const leadFindFirst = vi.fn(async (args: { where?: { origem?: string } }) => {
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
  });
  const leadCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => {
    if (opts.createErro) {
      jaCriou = true;
      throw Object.assign(new Error("unique"), { code: opts.createErro });
    }
    return { id: "lead-novo" };
  });
  const interacaoCreate = vi.fn(async () => ({}));
  const supressaoFindFirst = vi.fn(async () => (opts.suprimido ? { contato: "4299998888" } : null));
  const vincular = vi.fn(async () => {});
  const registrarOptOut = vi.fn(async () => ({ contato: "4299998888", tipo: "TELEFONE", leadsMarcados: 1 }));

  const s = new ChatwootAgenteService(
    {
      whatsappMensagem: { create },
      motorista: { findUnique },
      configuracaoAgente: { findUnique: configFind },
      lead: { findFirst: leadFindFirst, update: vi.fn(async () => ({})), create: leadCreate },
      interacaoLead: { create: interacaoCreate },
      supressaoContato: { findFirst: supressaoFindFirst },
    } as unknown as PrismaService,
    {
      resolverPorTelefone: vi.fn(async () => opts.identidade ?? MOTORISTA),
      marcarMensagemRecebida,
    } as unknown as SessaoService,
    { processar } as unknown as AgenteService,
    { contaDoCodigo, consumir } as unknown as ConviteService,
    { responder, passarParaHumano, temEtiqueta } as unknown as ChatwootClientService,
    { atender } as unknown as SdrService,
    { vincular } as unknown as LeadChatwootService,
    { registrarOptOut } as unknown as ProspeccaoService,
    {
      get: (k: string) =>
        k === "CHATWOOT_INBOX_COMERCIAL" ? (opts.inboxComercial ?? undefined) : undefined,
    } as unknown as ConfigService,
  );
  return {
    s,
    vincular,
    registrarOptOut,
    create,
    findUnique,
    processar,
    responder,
    passarParaHumano,
    temEtiqueta,
    consumir,
    atender,
    leadCreate,
    interacaoCreate,
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

describe("quem o agente atende", () => {
  it("motorista aprovado conversa com o agente", async () => {
    const { s, processar, responder } = montar();
    await s.processar(evento());
    expect(processar).toHaveBeenCalledOnce();
    expect(responder).toHaveBeenCalledWith(1, 7, "Sua última viagem foi conferida.");
  });

  it("número desconhecido nunca chega no agente", async () => {
    // A fronteira é de segurança: com ferramentas do sistema na mão, o agente
    // responderia dado de viagem pra quem digitasse um número por sorte.
    const { s, processar, passarParaHumano } = montar({ identidade: DESCONHECIDO });
    await s.processar(evento());
    expect(processar).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("motorista com cadastro em análise não conversa com o agente", async () => {
    // `resolverPorTelefone` confere `ativo`, não `status` — aqui não existe
    // guard nenhum, então a aprovação se confere na mão.
    const { s, processar, passarParaHumano } = montar({ status: "PENDENTE" });
    await s.processar(evento());
    expect(processar).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });
});

describe("o que o agente ignora", () => {
  it("ignora a mensagem que nós mesmos mandamos", async () => {
    // Sem isto o robô responde à própria resposta, em loop.
    const { s, processar, responder } = montar();
    await s.processar(evento({ message_type: "outgoing" }));
    expect(processar).not.toHaveBeenCalled();
    expect(responder).not.toHaveBeenCalled();
  });

  it("ignora evento que não é mensagem criada", async () => {
    const { s, processar } = montar();
    await s.processar(evento({ event: "conversation_status_changed" }));
    expect(processar).not.toHaveBeenCalled();
  });

  it("áudio e foto vão pra pessoa, não pro agente", async () => {
    // Fingir que entendeu é pior que entregar pra quem entende.
    const { s, processar, passarParaHumano } = montar();
    await s.processar(evento({ content: "" }));
    expect(processar).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });
});

describe("quando o agente não dá conta", () => {
  it("resposta vazia vira fila humana", async () => {
    // Silêncio no WhatsApp é pior que demora: a pessoa fica olhando pro nada.
    const { s, responder, passarParaHumano } = montar({ resposta: "   " });
    await s.processar(evento());
    expect(responder).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("erro no meio do caminho não derruba o webhook", async () => {
    // Quem chama já respondeu 200 pro Chatwoot; lançar aqui faria ele reenviar,
    // e reenvio é o motorista recebendo a mesma resposta de novo.
    const { s } = montar();
    await expect(
      s.processar(evento({ conversation: undefined, account: undefined })),
    ).resolves.toBeUndefined();
  });
});

describe("histórico", () => {
  it("grava entrada e saída pro agente ter memória no próximo turno", async () => {
    // O AgenteService monta o contexto a partir de `whatsapp_mensagens`, não do
    // que o Chatwoot guarda: sem gravar, toda mensagem seria a primeira.
    const { s, create } = montar();
    await s.processar(evento());
    expect(create).toHaveBeenCalledTimes(2);
    const direcoes = create.mock.calls.map((c) => c[0].data.direcao);
    expect(direcoes).toEqual(["ENTRADA", "SAIDA"]);
  });
});

describe("vínculo por código de convite", () => {
  it("código válido vincula o telefone e não vira ticket", async () => {
    // Sem este caminho o código morreria na fila humana e ninguém novo
    // conseguiria se vincular pelo canal oficial.
    const { s, consumir, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      contaDoCodigo: "conta-1",
    });
    await s.processar(evento({ content: "A1B2C3" }));
    expect(consumir).toHaveBeenCalledOnce();
    expect(responder.mock.calls[0]?.[2]).toContain("vinculado");
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("código expirado responde o motivo, sem abrir ticket", async () => {
    // Erro de digitação é de quem digitou; virar ticket a cada typo entope a fila.
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      contaDoCodigo: "conta-1",
      consumirErro: "Código expirou",
    });
    await s.processar(evento({ content: "A1B2C3" }));
    expect(responder).toHaveBeenCalledWith(1, 7, "Código expirou");
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("palavra curta que não é código segue pro caminho normal", async () => {
    const { s, consumir, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      contaDoCodigo: null,
    });
    await s.processar(evento({ content: "oi" }));
    expect(consumir).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });
});

describe("a chave que liga e desliga", () => {
  it("agente desligado no painel não responde pelo Chatwoot", async () => {
    // Sem esta checagem, desligar o agente na tela não desligaria nada — o
    // Chatwoot seguiria respondendo por um caminho que a tela não conhece.
    const { s, processar, passarParaHumano } = montar({ agenteAtivo: false });
    await s.processar(evento());
    expect(processar).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });
});

describe("o SDR atendendo prospect", () => {
  const RESPOSTA: RespostaSdr = {
    texto: "Pra 8 caminhões, sai por *R$ 1.890,00* por mês.",
    passarParaHumano: false,
    motivoHumano: null,
    ferramentas: ["consultar_preco"],
  };

  it("prospect conhecido é atendido pelo SDR, sem virar ticket", async () => {
    const { s, responder, passarParaHumano, atender } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ content: "quanto custa?" }));
    expect(atender).toHaveBeenCalledWith("lead-1", "quanto custa?");
    expect(responder).toHaveBeenCalledWith(1, 7, RESPOSTA.texto);
    // O ponto todo: uma conversa que o SDR resolveu não ocupa fila humana.
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("quem escreveu sem estar na base vira lead e é atendido na hora", async () => {
    // Era o contrário, e estava invertido: quem veio do Instagram, do site ou
    // de indicação caía na fila humana, enquanto o lead frio do RNTRC — que
    // nunca pediu nada — tinha atendimento. A procedência obrigatória é régua
    // de prospecção ATIVA; quem escreve primeiro deu o número no ato.
    const { s, atender, leadCreate, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: false,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ content: "quanto custa?" }));
    expect(leadCreate).toHaveBeenCalledOnce();
    expect(atender).toHaveBeenCalledWith("lead-novo", "quanto custa?");
    expect(responder).toHaveBeenCalledWith(1, 7, RESPOSTA.texto);
    expect(passarParaHumano).not.toHaveBeenCalled();
  });

  it("o lead nasce com o telefone no formato da casa, sem o DDI", async () => {
    // `registrarOptOut` compara telefone por igualdade exata. Gravar "55" na
    // frente faria o opt-out marcar zero leads — e a pessoa seguiria
    // recebendo mensagem depois de pedir pra parar.
    const { s, leadCreate } = montar({ identidade: DESCONHECIDO, respostaSdr: RESPOSTA });
    await s.processar(evento({ content: "oi, vi o instagram de vocês" }));
    const dados = leadCreate.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(dados.telefone).toBe("4299998888");
    expect(dados.origem).toBe("WHATSAPP_INBOUND");
    // NOVO é a fila de quem ainda não foi tocado, de onde saem as campanhas:
    // quem já está conversando não pode receber um "oi" frio por cima.
    expect(dados.status).toBe("EM_CONTATO");
  });

  it("o nome do perfil vira a pessoa, mas o número disfarçado de nome não", async () => {
    const comNome = montar({ identidade: DESCONHECIDO, respostaSdr: RESPOSTA });
    await comNome.s.processar(evento({ sender: { phone_number: "+554299998888", name: "Sérgio" } }));
    expect((comNome.leadCreate.mock.calls[0]?.[0].data as { nome: unknown }).nome).toBe("Sérgio");

    // O Chatwoot preenche `name` com o próprio número quando o contato não tem
    // nome no perfil — gravar isso faria o SDR chamar alguém de "+5542...".
    const semNome = montar({ identidade: DESCONHECIDO, respostaSdr: RESPOSTA });
    await semNome.s.processar(
      evento({ sender: { phone_number: "+554299998888", name: "+55 42 99998888" } }),
    );
    expect((semNome.leadCreate.mock.calls[0]?.[0].data as { nome: unknown }).nome).toBeNull();
  });

  it("quem está em opt-out não é atendido nem vira lead novo", async () => {
    // A busca não filtra `optOut` justamente por isto: filtrando, o lead ficava
    // invisível e a criação abriria um cadastro novo pra quem pediu pra sumir.
    const { s, atender, leadCreate, passarParaHumano, interacaoCreate } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      leadOptOut: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ content: "quanto custa?" }));
    expect(leadCreate).not.toHaveBeenCalled();
    expect(atender).not.toHaveBeenCalled();
    // A interação fica registrada: ele escreveu, e isso é fato do funil.
    expect(interacaoCreate).toHaveBeenCalledOnce();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("número na supressão global não vira lead, mesmo sem cadastro", async () => {
    const { s, atender, leadCreate, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: false,
      suprimido: true,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ content: "quanto custa?" }));
    expect(leadCreate).not.toHaveBeenCalled();
    expect(atender).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("duas mensagens ao mesmo tempo não viram dois leads", async () => {
    // Webhooks paralelos disputam a criação; o índice único parcial derruba a
    // segunda. Achar o lead que a primeira criou é a resposta certa — dois
    // cadastros partiriam a conversa em duas e o SDR repetiria as perguntas.
    const { s, atender, responder } = montar({
      identidade: DESCONHECIDO,
      ehLead: false,
      createErro: "P2002",
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ content: "boa tarde" }));
    expect(atender).toHaveBeenCalledWith("lead-corrida", "boa tarde");
    expect(responder).toHaveBeenCalledWith(1, 7, RESPOSTA.texto);
  });

  it("SDR desligado devolve a conversa pra fila humana", async () => {
    // `null` do SDR é "não é comigo" — desligado, sem chave de IA ou opt-out.
    // Em todos esses casos o comportamento tem que ser o de antes dele existir.
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: null,
    });
    await s.processar(evento({ content: "quanto custa?" }));
    expect(responder.mock.calls[0]?.[2]).toContain("chamei alguém da equipe");
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("quando o SDR pede humano, ele responde E encaminha", async () => {
    // As duas coisas, não uma ou outra: a pessoa precisa ler "alguém vai te
    // chamar" e a conversa precisa aparecer pra quem vai chamar.
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: {
        texto: "Alguém da Movatruck vai te chamar.",
        passarParaHumano: true,
        motivoHumano: "quer negociar preço",
        ferramentas: ["passar_para_humano"],
      },
    });
    await s.processar(evento({ content: "consegue fazer por 1200?" }));
    expect(responder).toHaveBeenCalledWith(1, 7, "Alguém da Movatruck vai te chamar.");
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("SDR que explode cai na fila humana, sem derrubar o webhook", async () => {
    // Erro aqui não pode virar exceção: o Chatwoot reenvia o webhook que falha,
    // e reenviar significa a pessoa recebendo a mesma resposta de novo.
    const { s, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      sdrErro: "timeout do provider",
    });
    await s.processar(evento({ content: "quanto custa?" }));
    expect(responder.mock.calls[0]?.[2]).toContain("chamei alguém da equipe");
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("motorista conhecido continua indo pro agente do sistema, não pro SDR", async () => {
    // A regressão que importa: o SDR entrou no mesmo webhook do agente, e
    // trocar os dois faria motorista receber conversa de venda.
    const { s, processar, atender } = montar({ respostaSdr: RESPOSTA });
    await s.processar(evento({ content: "e minha viagem de ontem?" }));
    expect(processar).toHaveBeenCalledOnce();
    expect(atender).not.toHaveBeenCalled();
  });
});

/**
 * O canal por onde a pessoa escreveu decide quem atende.
 *
 * A fronteira é de segurança: o agente do motorista lê viagem, km e ticket de
 * uma empresa, e o comercial é o canal onde qualquer prospect escreve.
 */
describe("canal comercial", () => {
  const COMERCIAL = { inbox: { id: 2 } };

  it("motorista conhecido que escreve no comercial NÃO fala com o agente dele", async () => {
    const { s, processar, passarParaHumano } = montar({ inboxComercial: "2" });
    await s.processar(evento(COMERCIAL));
    expect(processar).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalled();
  });

  it("lead conhecido no comercial é atendido pelo SDR", async () => {
    const { s, atender, responder } = montar({
      inboxComercial: "2",
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: {
        texto: "Oi! Posso te mostrar como funciona?",
        passarParaHumano: false,
        motivoHumano: null,
        ferramentas: [],
      },
    });
    await s.processar(evento(COMERCIAL));
    expect(atender).toHaveBeenCalled();
    expect(responder).toHaveBeenCalledWith(1, 7, "Oi! Posso te mostrar como funciona?");
  });

  it("desconhecido no comercial não fica em silêncio", async () => {
    const { s, responder, passarParaHumano } = montar({
      inboxComercial: "2",
      identidade: DESCONHECIDO,
      ehLead: false,
    });
    await s.processar(evento(COMERCIAL));
    expect(responder).toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalled();
  });

  it("não repete o aviso de fila humana na segunda mensagem seguida", async () => {
    // O bug que o dono encontrou testando: três "oi" em dez minutos viraram
    // três respostas idênticas. Cada mensagem é um webhook novo, e nada lembrava
    // do anterior — a etiqueta já aplicada é essa memória.
    const { s, responder, passarParaHumano } = montar({
      inboxComercial: "2",
      identidade: DESCONHECIDO,
      ehLead: false,
      jaEtiquetada: true,
    });
    await s.processar(evento(COMERCIAL));
    expect(responder).not.toHaveBeenCalled();
    // O repasse continua: garante a conversa aberta na fila mesmo que alguém
    // a tenha fechado no meio.
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("áudio no comercial vai pra uma pessoa, sem virar lead nem acordar o SDR", async () => {
    // Mídia chega com `content` vazio. O guard geral de mensagem sem texto mora
    // depois do desvio pro comercial, então sem tratamento aqui o áudio seguia:
    // criava lead com resumo em branco e mandava mensagem vazia pro modelo.
    const { s, atender, responder, passarParaHumano, leadCreate } = montar({
      inboxComercial: "2",
      identidade: DESCONHECIDO,
      ehLead: true,
    });
    await s.processar(evento({ ...COMERCIAL, content: "" }));
    expect(atender).not.toHaveBeenCalled();
    expect(leadCreate).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
  });

  it("no inbox de operação o motorista segue falando com o agente", async () => {
    const { s, processar } = montar({ inboxComercial: "2" });
    await s.processar(evento({ inbox: { id: 1 } }));
    expect(processar).toHaveBeenCalled();
  });

  it("sem inbox comercial configurado, nada muda", async () => {
    const { s, processar } = montar();
    await s.processar(evento(COMERCIAL));
    expect(processar).toHaveBeenCalled();
  });
});

describe("o lead e a conversa ficam ligados", () => {
  it("guarda conta, contato e conversa do Chatwoot no lead", async () => {
    // É o que faz a ficha do painel abrir a conversa e o atendimento saber
    // que aquele número é uma transportadora com CNPJ e nota.
    const { s, vincular } = montar({ identidade: DESCONHECIDO, ehLead: true });
    await s.processar(evento({ sender: { id: 55, phone_number: "+554299998888" } }));
    expect(vincular).toHaveBeenCalledWith("lead-1", {
      contaId: 1,
      contatoId: 55,
      conversaId: 7,
    });
  });

  it("vincula também quem pediu pra não ser contatado", async () => {
    // Justamente aí é que importa: o "não contatar" precisa chegar na tela de
    // quem está com o dedo no gatilho de responder.
    const { s, vincular, atender } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      leadOptOut: true,
    });
    await s.processar(evento({ sender: { id: 55, phone_number: "+554299998888" } }));
    expect(atender).not.toHaveBeenCalled();
    expect(vincular).toHaveBeenCalledWith("lead-1", expect.objectContaining({ contatoId: 55 }));
  });

  it("payload sem contato não impede o vínculo da conversa", async () => {
    const { s, vincular } = montar({ identidade: DESCONHECIDO, ehLead: true });
    await s.processar(evento());
    expect(vincular).toHaveBeenCalledWith("lead-1", {
      contaId: 1,
      contatoId: null,
      conversaId: 7,
    });
  });

  it("número na supressão não vira lead nem vínculo", async () => {
    const { s, vincular, leadCreate } = montar({
      identidade: DESCONHECIDO,
      ehLead: false,
      suprimido: true,
    });
    await s.processar(evento({ sender: { id: 55, phone_number: "+554299998888" } }));
    expect(leadCreate).not.toHaveBeenCalled();
    expect(vincular).not.toHaveBeenCalled();
  });
});

describe("quando a pessoa pede pra parar", () => {
  it("SAIR tira da lista, confirma e não chama o SDR", async () => {
    // É o que a mensagem de prospecção promete no fim. Promessa de opt-out
    // que depende de alguém ler o ticket é promessa quebrada.
    const { s, registrarOptOut, atender, responder, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
    });
    await s.processar(evento({ content: "SAIR" }));
    expect(registrarOptOut).toHaveBeenCalledWith(
      "4299998888",
      expect.stringContaining("pediu no WhatsApp"),
      "WHATSAPP",
    );
    expect(atender).not.toHaveBeenCalled();
    expect(passarParaHumano).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalledWith(1, 7, expect.stringContaining("tirei seu número"));
  });

  it("vale também no canal comercial", async () => {
    const { s, registrarOptOut } = montar({
      inboxComercial: "2",
      identidade: DESCONHECIDO,
      ehLead: true,
    });
    await s.processar(evento({ inbox: { id: 2 }, content: "não quero mais" }));
    expect(registrarOptOut).toHaveBeenCalled();
  });

  it("não confunde negociação com desistência", async () => {
    // "não quero pagar caro" é conversa. Tirar da lista quem estava
    // negociando é tão ruim quanto insistir com quem pediu pra sair.
    const { s, registrarOptOut, atender } = montar({
      identidade: DESCONHECIDO,
      ehLead: true,
      respostaSdr: { texto: "Posso te explicar o preço", passarParaHumano: false, motivoHumano: null, ferramentas: [] },
    });
    await s.processar(evento({ content: "não quero pagar caro nisso" }));
    expect(registrarOptOut).not.toHaveBeenCalled();
    expect(atender).toHaveBeenCalled();
  });
});
