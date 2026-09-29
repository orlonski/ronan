import { describe, expect, it, vi } from "vitest";
import { contaAtual } from "../../common/conta/conta-context";
import { ConferenciaRespostaService, mesmoTelefone, type MensagemRecebida } from "./conferencia-resposta.service";

const ID = "3f2b1c9e-8d4a-4f6b-9a1e-0c7d5e2b6a11";
const DIA = new Date("2026-09-25T00:00:00Z");

type Vinculo = {
  id: string;
  contaId: string;
  nome: string;
  receberConferenciaDiaria: boolean;
  conta: { nome: string };
};

const MOTORISTA = { id: "m1", nome: "João", telefone: "42991088125", cpf: "11122233344", identidadeId: "i1" };

function montar(
  opts: {
    estado?: string;
    opcao?: string | null;
    wamid?: string | null;
    updateManyCount?: number;
    pendente?: boolean;
    vinculos?: Vinculo[];
    cfg?: { mensagemAoParar: string | null; contatoEmpresa: string | null } | null;
    linhasGuarda?: { estado: string; respondidaEm: Date | null }[];
  } = {},
) {
  const conf = {
    id: ID,
    contaId: "c1",
    estado: opts.estado ?? "ENVIADA",
    opcao: opts.opcao ?? null,
    wamid: opts.wamid === undefined ? "wamid.PERGUNTA" : opts.wamid,
    lembreteWamid: null,
    dia: DIA,
    motorista: MOTORISTA,
  };
  const contasVistas: Record<string, (string | undefined)[]> = { motoristaUpdate: [], sugestao: [], auditoria: [] };
  const motoristaUpdate = vi.fn(async (_a: { where: { id: string }; data: Record<string, unknown> }) => {
    contasVistas.motoristaUpdate!.push(contaAtual()?.contaId ?? undefined);
    return {};
  });
  const updateMany = vi.fn(async (_a: unknown) => ({ count: opts.updateManyCount ?? 1 }));
  const findUnique = vi.fn(async () => conf);
  const findFirst = vi.fn(async () => (opts.pendente === false ? null : conf));
  const findMany = vi.fn(async () => opts.linhasGuarda ?? []);
  const vinculos: Vinculo[] = opts.vinculos ?? [
    { id: "m1", contaId: "c1", nome: "João", receberConferenciaDiaria: true, conta: { nome: "Aurora Transportes" } },
  ];
  const prisma = {
    conferenciaDiaria: { findUnique, findFirst, findMany, updateMany },
    motorista: { findMany: vi.fn(async () => vinculos), update: motoristaUpdate },
    configuracaoConferenciaDiaria: {
      findFirst: vi.fn(async () => (opts.cfg === undefined ? null : opts.cfg)),
    },
  };
  const tentarEnviar = vi.fn(async (_e: { texto: string; rota: string; destino: { numero: string } }) => ({
    enviado: true,
  }));
  const abrir = vi.fn(async (a: { tipo: string; motoristaId: string }) => {
    contasVistas.sugestao!.push(contaAtual()?.contaId ?? undefined);
    return { id: `s-${a.tipo}-${a.motoristaId}`, criada: true };
  });
  const notificar = vi.fn(async () => {});
  const log = vi.fn(async (_a: { acao: string; entidadeId: string }) => {
    contasVistas.auditoria!.push(contaAtual()?.contaId ?? undefined);
  });
  const aoResponder = vi.fn(async () => {});
  const svc = new ConferenciaRespostaService(
    prisma as never,
    { tentarEnviar } as never,
    { log } as never,
    { abrir, notificar } as never,
    { aoResponder } as never,
  );
  return { svc, prisma, tentarEnviar, abrir, notificar, log, aoResponder, contasVistas, motoristaUpdate, updateMany };
}

const toque = (opcao: string, over: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  id: "wamid.TOQUE",
  from: "554291088125", // a Meta entrega sem o nono dígito
  type: "button",
  button: { payload: `cv:${ID}:${opcao}`, text: "x" },
  context: { id: "wamid.PERGUNTA" },
  ...over,
});
const texto = (body: string): MensagemRecebida => ({ id: "wamid.T", from: "554291088125", type: "text", text: { body } });

describe("efeitos por opção", () => {
  it("Não tive: registra RESPONDIDA e agradece — sem sugestão nem cadastro tocado", async () => {
    const t = montar();
    const r = await t.svc.tratarMensagem(toque("NAO_TIVE"));
    expect(r).toEqual({ tratada: true, opcao: "NAO_TIVE", origem: "BOTAO" });
    expect(t.updateMany.mock.calls[0]![0]).toMatchObject({ data: { estado: "RESPONDIDA", opcao: "NAO_TIVE" } });
    expect(t.abrir).not.toHaveBeenCalled();
    expect(t.motoristaUpdate).not.toHaveBeenCalled();
    expect(t.tentarEnviar).toHaveBeenCalledOnce();
    expect(t.tentarEnviar.mock.calls[0]![0].texto).toMatch(/obrigado/i);
  });

  it("Tive, não lancei: manda 'abra o app e lance' e abre sugestão pro gestor", async () => {
    const t = montar();
    await t.svc.tratarMensagem(toque("TIVE_NAO_LANCEI"));
    expect(t.tentarEnviar.mock.calls[0]![0].texto).toMatch(/abra o app e lance/i);
    expect(t.abrir).toHaveBeenCalledWith(expect.objectContaining({ tipo: "LANCAR_VIAGEM_FALTANTE", motoristaId: "m1" }));
    expect(t.motoristaUpdate).not.toHaveBeenCalled();
  });

  it("Saí da empresa: vira SUGESTÃO INATIVAR_VINCULO e responde que o gestor vai confirmar — NUNCA inativa", async () => {
    const t = montar();
    await t.svc.tratarMensagem(toque("SAI_DA_EMPRESA"));
    expect(t.abrir).toHaveBeenCalledWith(expect.objectContaining({ tipo: "INATIVAR_VINCULO", motoristaId: "m1" }));
    expect(t.tentarEnviar.mock.calls[0]![0].texto).toBe("Anotado. Seu gestor vai confirmar.");
    // O invariante que importa: nenhuma escrita em Motorista.
    expect(t.motoristaUpdate).not.toHaveBeenCalled();
    expect(t.prisma.motorista.update).not.toHaveBeenCalled();
  });

  it("a resposta sai pelo número que escreveu, e pela rota de resposta (não pelo Evolution)", async () => {
    const t = montar();
    await t.svc.tratarMensagem(toque("NAO_TIVE"));
    const e = t.tentarEnviar.mock.calls[0]![0];
    expect(e.destino.numero).toBe("554291088125");
    expect(e.rota).toBe("RESPOSTA_AGENTE");
  });
});

describe("Parar perguntas (opt-out)", () => {
  const dois: Vinculo[] = [
    { id: "m1", contaId: "c1", nome: "João", receberConferenciaDiaria: true, conta: { nome: "Aurora Transportes" } },
    { id: "m2", contaId: "c2", nome: "João", receberConferenciaDiaria: true, conta: { nome: "Beta Cargas" } },
  ];

  it("desliga em TODOS os vínculos, cada um dentro da conta dele", async () => {
    const t = montar({ vinculos: dois });
    await t.svc.tratarMensagem(toque("PARAR"));
    expect(t.motoristaUpdate).toHaveBeenCalledTimes(2);
    expect(t.motoristaUpdate.mock.calls.map((c) => c[0].where.id).sort()).toEqual(["m1", "m2"]);
    expect(t.contasVistas.motoristaUpdate).toEqual(["c1", "c2"]);
  });

  it("só liga receberConferenciaDiaria=false: aceitaWhatsapp (OTP, aviso de peso) NÃO é tocado", async () => {
    const t = montar({ vinculos: dois });
    await t.svc.tratarMensagem(toque("PARAR"));
    for (const c of t.motoristaUpdate.mock.calls) {
      expect(c[0].data).toEqual({ receberConferenciaDiaria: false });
    }
  });

  it("CADA empresa afetada recebe sugestão MOTORISTA_PAROU_WHATSAPP e aviso no sino", async () => {
    const t = montar({ vinculos: dois });
    await t.svc.tratarMensagem(toque("PARAR"));
    const chamadas = t.abrir.mock.calls.map((c) => c[0]);
    expect(chamadas.map((c) => [c.tipo, c.motoristaId])).toEqual([
      ["MOTORISTA_PAROU_WHATSAPP", "m1"],
      ["MOTORISTA_PAROU_WHATSAPP", "m2"],
    ]);
    expect(t.contasVistas.sugestao).toEqual(["c1", "c2"]);
    expect(t.notificar).toHaveBeenCalledTimes(2);
  });

  it("grava auditoria CONFERENCIA_OPTOUT por vínculo, na conta de cada um", async () => {
    const t = montar({ vinculos: dois });
    await t.svc.tratarMensagem(toque("PARAR"));
    expect(t.log.mock.calls.map((c) => [c[0].acao, c[0].entidadeId])).toEqual([
      ["CONFERENCIA_OPTOUT", "m1"],
      ["CONFERENCIA_OPTOUT", "m2"],
    ]);
    expect(t.contasVistas.auditoria).toEqual(["c1", "c2"]);
  });

  it("responde UMA vez, com a orientação (padrão) e o nome da empresa em que ele tocou", async () => {
    const t = montar({ vinculos: dois });
    await t.svc.tratarMensagem(toque("PARAR"));
    expect(t.tentarEnviar).toHaveBeenCalledOnce();
    const txt = t.tentarEnviar.mock.calls[0]![0].texto;
    expect(txt).toContain("não vamos mais enviar essa pergunta");
    expect(txt).toContain("viagem que não é lançada no app não entra no seu acerto");
    expect(txt).toContain("fale com Aurora Transportes.");
    expect(txt).not.toMatch(/schaba/i);
  });

  it("usa o texto e o contato configurados pela empresa", async () => {
    const t = montar({ cfg: { mensagemAoParar: "Fechado! Dúvida: {empresa}{contato}", contatoEmpresa: "42 3333-0000" } });
    await t.svc.tratarMensagem(toque("PARAR"));
    expect(t.tentarEnviar.mock.calls[0]![0].texto).toBe("Fechado! Dúvida: Aurora Transportes (42 3333-0000)");
  });

  it("vínculo que já tinha parado não é auditado de novo (mas o tocado sempre)", async () => {
    const t = montar({
      vinculos: [
        { id: "m1", contaId: "c1", nome: "João", receberConferenciaDiaria: false, conta: { nome: "A" } },
        { id: "m2", contaId: "c2", nome: "João", receberConferenciaDiaria: false, conta: { nome: "B" } },
      ],
    });
    await t.svc.tratarMensagem(toque("PARAR"));
    expect(t.motoristaUpdate).not.toHaveBeenCalled();
    expect(t.log.mock.calls.map((c) => c[0].entidadeId)).toEqual(["m1"]);
  });
});

describe("idempotência e confirmação", () => {
  it("o mesmo toque entregue duas vezes não repete resposta, sugestão nem auditoria", async () => {
    const t = montar({ updateManyCount: 0 });
    await t.svc.tratarMensagem(toque("SAI_DA_EMPRESA"));
    expect(t.tentarEnviar).not.toHaveBeenCalled();
    expect(t.abrir).not.toHaveBeenCalled();
    expect(t.log).not.toHaveBeenCalled();
  });

  it("pergunta já RESPONDIDA com a mesma opção: nada a fazer", async () => {
    const t = montar({ estado: "RESPONDIDA", opcao: "PARAR" });
    const r = await t.svc.tratarMensagem(toque("PARAR"));
    expect(r.tratada).toBe(true);
    expect(t.updateMany).not.toHaveBeenCalled();
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("depois de 'Não tive', tocar 'Parar' ainda vale (o botão continua na tela dele)", async () => {
    const t = montar({ estado: "RESPONDIDA", opcao: "NAO_TIVE" });
    await t.svc.tratarMensagem(toque("PARAR"));
    expect(t.motoristaUpdate).toHaveBeenCalled();
  });

  it("toque de um número que NÃO é do motorista é ignorado", async () => {
    const t = montar();
    const r = await t.svc.tratarMensagem(toque("PARAR", { from: "554299990000" }));
    expect(r.tratada).toBe(false);
    expect(t.updateMany).not.toHaveBeenCalled();
    expect(t.motoristaUpdate).not.toHaveBeenCalled();
  });

  it("toque respondendo a OUTRA mensagem (wamid não confere) é ignorado", async () => {
    const t = montar();
    const r = await t.svc.tratarMensagem(toque("PARAR", { context: { id: "wamid.OUTRA" } }));
    expect(r.tratada).toBe(false);
    expect(t.updateMany).not.toHaveBeenCalled();
  });

  it("sem context (alguns clientes omitem) o payload + telefone bastam", async () => {
    const t = montar();
    const r = await t.svc.tratarMensagem(toque("NAO_TIVE", { context: undefined }));
    expect(r.tratada).toBe(true);
  });

  it("conferência que não existe (payload forjado/antigo) é ignorada", async () => {
    const t = montar();
    t.prisma.conferenciaDiaria.findUnique.mockResolvedValueOnce(null as never);
    const r = await t.svc.tratarMensagem(toque("PARAR"));
    expect(r.tratada).toBe(false);
  });

  it("linha em SOMBRA (nada foi enviado) não aceita toque", async () => {
    const t = montar({ estado: "SOMBRA" });
    const r = await t.svc.tratarMensagem(toque("PARAR"));
    expect(r.tratada).toBe(false);
    expect(t.motoristaUpdate).not.toHaveBeenCalled();
  });

  it("nunca lança: erro no banco vira { tratada: false }", async () => {
    const t = montar();
    t.prisma.conferenciaDiaria.findUnique.mockRejectedValueOnce(new Error("banco fora"));
    await expect(t.svc.tratarMensagem(toque("PARAR"))).resolves.toEqual({ tratada: false, motivo: "erro" });
  });

  it("toda mensagem recebida limpa a suspeita de número inalcançável", async () => {
    const t = montar({ pendente: false });
    await t.svc.tratarMensagem(texto("oi"));
    expect(t.aoResponder).toHaveBeenCalledWith("554291088125");
  });
});

describe("texto livre", () => {
  it.each([
    ["1", "NAO_TIVE"],
    ["sim", "NAO_TIVE"],
    ["2", "TIVE_NAO_LANCEI"],
    ["3", "SAI_DA_EMPRESA"],
    ["parar", "PARAR"],
  ])("%j com pergunta pendente → %s", async (corpo, opcao) => {
    const t = montar();
    const r = await t.svc.tratarMensagem(texto(corpo));
    expect(r).toEqual({ tratada: true, opcao, origem: "TEXTO" });
  });

  it("sem pergunta pendente, 'sim' é conversa comum — não é nossa", async () => {
    const t = montar({ pendente: false });
    const r = await t.svc.tratarMensagem(texto("sim"));
    expect(r.tratada).toBe(false);
    expect(t.updateMany).not.toHaveBeenCalled();
  });

  it("texto que não bate vira sugestão RESPOSTA_AMBIGUA e NÃO é tratado (o atendimento responde)", async () => {
    const t = montar();
    const r = await t.svc.tratarMensagem(texto("cara hoje eu levei o caminhão na oficina"));
    expect(r.tratada).toBe(false);
    expect(t.abrir).toHaveBeenCalledWith(expect.objectContaining({ tipo: "RESPOSTA_AMBIGUA" }));
    expect(t.updateMany).not.toHaveBeenCalled();
    expect(t.tentarEnviar).not.toHaveBeenCalled();
  });

  it("áudio (sem texto) com pergunta pendente também vira sugestão pro gestor", async () => {
    const t = montar();
    const r = await t.svc.tratarMensagem({ id: "a", from: "554291088125", type: "audio" });
    expect(r.tratada).toBe(false);
    expect(t.abrir).toHaveBeenCalledWith(expect.objectContaining({ tipo: "RESPOSTA_AMBIGUA" }));
  });

  it("interactive button_reply também é lido como toque", async () => {
    const t = montar();
    const r = await t.svc.tratarMensagem({
      id: "i",
      from: "554291088125",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: `cv:${ID}:NAO_TIVE`, title: "Não tive" } },
      context: { id: "wamid.PERGUNTA" },
    });
    expect(r).toEqual({ tratada: true, opcao: "NAO_TIVE", origem: "BOTAO" });
  });
});

describe("guarda contra a resposta duplicada do agente", () => {
  const agora = () => new Date();
  it("toque (texto = rótulo) com pergunta ENVIADA: o agente NÃO responde", async () => {
    const t = montar({ linhasGuarda: [{ estado: "ENVIADA", respondidaEm: null }] });
    expect(await t.svc.respostaJaTratada("+554291088125", "Tive, não lancei")).toBe(true);
  });
  it("mesmo que o webhook já tenha carimbado RESPONDIDA há pouco, continua calado", async () => {
    const t = montar({ linhasGuarda: [{ estado: "RESPONDIDA", respondidaEm: agora() }] });
    expect(await t.svc.respostaJaTratada("+554291088125", "Não tive")).toBe(true);
  });
  it("texto que o interpretador não entende NUNCA é engolido", async () => {
    const t = montar({ linhasGuarda: [{ estado: "ENVIADA", respondidaEm: null }] });
    expect(await t.svc.respostaJaTratada("+554291088125", "preciso do romaneio da carga")).toBe(false);
  });
  it("sem pergunta pendente, 'sim' vai pro agente normalmente", async () => {
    const t = montar({ linhasGuarda: [] });
    expect(await t.svc.respostaJaTratada("+554291088125", "sim")).toBe(false);
  });
  it("pergunta EXPIRADA: só o rótulo exato de um botão é engolido (toque tardio)", async () => {
    const t = montar({ linhasGuarda: [{ estado: "EXPIRADA", respondidaEm: null }] });
    expect(await t.svc.respostaJaTratada("+554291088125", "Parar perguntas")).toBe(true);
    expect(await t.svc.respostaJaTratada("+554291088125", "sim")).toBe(false);
  });
  it("toque sem texto só é engolido logo depois de um toque casado", async () => {
    const recente = montar({ linhasGuarda: [{ estado: "RESPONDIDA", respondidaEm: agora() }] });
    expect(await recente.svc.respostaJaTratada("+554291088125", "")).toBe(true);
    const antigo = montar({ linhasGuarda: [{ estado: "RESPONDIDA", respondidaEm: new Date(Date.now() - 30 * 60_000) }] });
    expect(await antigo.svc.respostaJaTratada("+554291088125", "")).toBe(false);
    const semNada = montar({ linhasGuarda: [{ estado: "ENVIADA", respondidaEm: null }] });
    expect(await semNada.svc.respostaJaTratada("+554291088125", "")).toBe(false);
  });
  it("na dúvida (erro no banco) o agente responde", async () => {
    const t = montar();
    t.prisma.conferenciaDiaria.findMany.mockRejectedValueOnce(new Error("x"));
    expect(await t.svc.respostaJaTratada("+554291088125", "Não tive")).toBe(false);
  });
});

describe("mesmoTelefone", () => {
  it("com e sem nono dígito, com e sem DDI", () => {
    expect(mesmoTelefone("42991088125", "554291088125")).toBe(true);
    expect(mesmoTelefone("(42) 99108-8125", "5542991088125")).toBe(true);
    expect(mesmoTelefone("42991088125", "554299999999")).toBe(false);
  });
});

describe("toque com a linha ainda PENDENTE (chegou antes do update pós-envio)", () => {
  it("é aceito: payload da própria linha + telefone que confere; grava RESPONDIDA e responde", async () => {
    const t = montar({ estado: "PENDENTE", wamid: null });
    const r = await t.svc.tratarMensagem(toque("NAO_TIVE"));
    expect(r).toEqual({ tratada: true, opcao: "NAO_TIVE", origem: "BOTAO" });
    const a = t.updateMany.mock.calls[0]![0] as { where: { estado: { in: string[] } } };
    expect(a.where.estado.in).toContain("PENDENTE");
    expect(t.tentarEnviar).toHaveBeenCalledOnce();
  });

  it("de número que não é do motorista continua ignorado", async () => {
    const t = montar({ estado: "PENDENTE", wamid: null });
    const r = await t.svc.tratarMensagem(toque("NAO_TIVE", { from: "5511999990000" }));
    expect(r).toEqual({ tratada: false, motivo: "remetente não confere" });
    expect(t.updateMany).not.toHaveBeenCalled();
  });

  it("estado que não pode receber resposta (FALHOU) segue ignorado, com o motivo", async () => {
    const t = montar({ estado: "FALHOU" });
    expect(await t.svc.tratarMensagem(toque("NAO_TIVE"))).toEqual({ tratada: false, motivo: "estado FALHOU" });
  });
});

describe("trilha durável do toque", () => {
  function comTrilha(o: Parameters<typeof montar>[0] = {}) {
    const t = montar(o);
    const raw = vi.fn(async (..._a: unknown[]) => 1);
    (t.prisma as unknown as { $executeRaw: unknown }).$executeRaw = raw;
    // O JSON do evento é o 1º valor interpolado (depois das partes do template).
    const eventos = () => raw.mock.calls.map((c) => JSON.parse(c[1] as string) as { evento: string; detalhe: Record<string, unknown> });
    return { ...t, eventos };
  }

  it("toque gravado deixa TOQUE e RESPOSTA_GRAVADA (com count, opção, origem, context.id e wamid da linha)", async () => {
    const t = comTrilha();
    await t.svc.tratarMensagem(toque("NAO_TIVE"));
    const ev = t.eventos();
    expect(ev.map((e) => e.evento)).toEqual(["TOQUE", "RESPOSTA_GRAVADA"]);
    expect(ev[0]!.detalhe).toMatchObject({
      linhaId: ID,
      opcao: "NAO_TIVE",
      origem: "BOTAO",
      contextId: "wamid.PERGUNTA",
      wamidLinha: "wamid.PERGUNTA",
    });
    expect(ev[1]!.detalhe).toMatchObject({ count: 1, opcao: "NAO_TIVE" });
  });

  it("toque ignorado deixa o motivo na trilha", async () => {
    const t = comTrilha();
    await t.svc.tratarMensagem(toque("NAO_TIVE", { context: { id: "wamid.OUTRA" } }));
    const ev = t.eventos();
    expect(ev.map((e) => e.evento)).toEqual(["TOQUE", "IGNORADO"]);
    expect(ev[1]!.detalhe).toMatchObject({ motivo: "wamid não confere", contextId: "wamid.OUTRA" });
  });

  it("falha ao gravar a trilha nunca derruba o tratamento", async () => {
    const t = montar();
    (t.prisma as unknown as { $executeRaw: unknown }).$executeRaw = vi.fn(async () => {
      throw new Error("banco caiu");
    });
    const r = await t.svc.tratarMensagem(toque("NAO_TIVE"));
    expect(r.tratada).toBe(true);
  });
});
