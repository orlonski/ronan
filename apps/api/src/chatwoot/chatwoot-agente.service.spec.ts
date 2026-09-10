import { describe, it, expect, vi } from "vitest";
import { ChatwootAgenteService } from "./chatwoot-agente.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { SessaoService, SessaoResolvida } from "../whatsapp/sessao.service";
import type { AgenteService } from "../whatsapp/agente/agente.service";
import type { ChatwootClientService } from "./chatwoot-client.service";
import type { ConviteService } from "../whatsapp/convite.service";
import type { SdrService, RespostaSdr } from "../sdr/sdr.service";

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
    /** O SDR explode (falha de IA, timeout). */
    sdrErro?: string;
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
  const leadFindFirst = vi.fn(async () =>
    opts.ehLead ? { id: "lead-1", empresa: "Transportes Teste", status: "NOVO" } : null,
  );

  const s = new ChatwootAgenteService(
    {
      whatsappMensagem: { create },
      motorista: { findUnique },
      configuracaoAgente: { findUnique: configFind },
      lead: { findFirst: leadFindFirst, update: vi.fn(async () => ({})) },
      interacaoLead: { create: vi.fn(async () => ({})) },
    } as unknown as PrismaService,
    {
      resolverPorTelefone: vi.fn(async () => opts.identidade ?? MOTORISTA),
      marcarMensagemRecebida,
    } as unknown as SessaoService,
    { processar } as unknown as AgenteService,
    { contaDoCodigo, consumir } as unknown as ConviteService,
    { responder, passarParaHumano } as unknown as ChatwootClientService,
    { atender } as unknown as SdrService,
  );
  return { s, create, findUnique, processar, responder, passarParaHumano, consumir, atender };
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

  it("número fora da base de leads nunca chega no SDR", async () => {
    // A fronteira vale nos dois sentidos: o SDR fala de preço e de teste
    // grátis, e isso não é o que um número aleatório deve receber.
    const { s, atender, passarParaHumano } = montar({
      identidade: DESCONHECIDO,
      ehLead: false,
      respostaSdr: RESPOSTA,
    });
    await s.processar(evento({ content: "quanto custa?" }));
    expect(atender).not.toHaveBeenCalled();
    expect(passarParaHumano).toHaveBeenCalledWith(1, 7);
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
