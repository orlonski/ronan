import { describe, it, expect, vi } from "vitest";
import { ChatwootAgenteService } from "./chatwoot-agente.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { SessaoService, SessaoResolvida } from "../whatsapp/sessao.service";
import type { AgenteService } from "../whatsapp/agente/agente.service";
import type { ChatwootClientService } from "./chatwoot-client.service";

const MOTORISTA: SessaoResolvida = {
  tipo: "MOTORISTA",
  sessaoId: "sessao-1",
  motoristaId: "motorista-1",
  nome: "Diego",
  contaId: "conta-1",
};

const DESCONHECIDO: SessaoResolvida = { tipo: "DESCONHECIDO", sessaoId: null, contaId: null };

function montar(opts: { identidade?: SessaoResolvida; status?: string; resposta?: string } = {}) {
  const create = vi.fn(async (_args: { data: { direcao: string } }) => ({}));
  const findUnique = vi.fn(async () => ({ status: opts.status ?? "APROVADO" }));
  const processar = vi.fn(async () => opts.resposta ?? "Sua última viagem foi conferida.");
  const responder = vi.fn(async () => true);
  const passarParaHumano = vi.fn(async () => {});
  const marcarMensagemRecebida = vi.fn(async () => {});

  const s = new ChatwootAgenteService(
    { whatsappMensagem: { create }, motorista: { findUnique } } as unknown as PrismaService,
    {
      resolverPorTelefone: vi.fn(async () => opts.identidade ?? MOTORISTA),
      marcarMensagemRecebida,
    } as unknown as SessaoService,
    { processar } as unknown as AgenteService,
    { responder, passarParaHumano } as unknown as ChatwootClientService,
  );
  return { s, create, findUnique, processar, responder, passarParaHumano };
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
