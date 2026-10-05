import { describe, it, expect, vi } from "vitest";
import { LeitorTicketService, escolherNumero, forcarSemLeitura } from "./leitor-ticket.service";
import { ClienteIaFactory, ProvedorIaNaoConfigurado } from "../ia/cliente-ia";
import type { UsoIaService } from "../ia/uso-ia.service";
import type { ConfigService } from "@nestjs/config";

/**
 * O corpo da chamada, sem tocar em rede.
 *
 * Até aqui nenhum teste exercitava `messages.create` — a verificação era o
 * script manual. Isso passou a doer quando o MiniMax entrou: agora o MESMO
 * método monta requests diferentes conforme o fornecedor, e essa bifurcação é
 * exatamente o tipo de coisa que quebra em silêncio.
 */

const usoFake = { registrar: vi.fn() } as unknown as UsoIaService;

const RESPOSTA_OK = {
  usage: { input_tokens: 1500, output_tokens: 120 },
  content: [
    {
      type: "text",
      text: JSON.stringify({
        tipoDocumento: "ticket_balanca",
        legivel: true,
        confidence: 0.92,
        numeroDocumento: "43625",
        toneladas: 32.5,
        data: "2026-08-20",
        placa: "ABC1D23",
        cliente: "Construtora Bronze",
        material: "Brita 1",
        conferencia: {
          toneladas: { confere: "sim", porque: "bate com o líquido" },
        },
      }),
    },
  ],
};

/** Fábrica que devolve um cliente falso e guarda o request montado. */
function montarLeitor(chaves: Record<string, string | undefined>) {
  const create = vi.fn(async (_req: Record<string, unknown>) => RESPOSTA_OK as unknown);
  const config = {
    get: (chave: string) => chaves[chave],
  } as unknown as ConfigService;

  const clientes = new ClienteIaFactory(config);
  // Só o transporte é falso; a escolha de fornecedor segue sendo a real.
  vi.spyOn(clientes, "para").mockImplementation((modelo: string) => {
    if (!clientes.disponivel(modelo)) throw new ProvedorIaNaoConfigurado("minimax", modelo);
    return { messages: { create } } as never;
  });

  return { leitor: new LeitorTicketService(clientes, usoFake), create };
}

const ARGS = { fotoBase64: "AAAA", mime: "image/jpeg", declarado: { toneladas: 32.5 } };

describe("LeitorTicketService.ler", () => {
  it("manda o modelo pedido e a foto em base64", async () => {
    const { leitor, create } = montarLeitor({ ANTHROPIC_API_KEY: "sk-ant-x" });
    const r = await leitor.ler({ ...ARGS, modelo: "claude-haiku-4-5-20251001" });

    const req = create.mock.calls[0]![0];
    expect(req.model).toBe("claude-haiku-4-5-20251001");
    expect(req.max_tokens).toBe(800);
    const conteudo = (req.messages as { content: Record<string, unknown>[] }[])[0]!.content;
    expect(conteudo[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
    expect(r.lido.toneladas).toBe(32.5);
    expect(r.lido.ticket).toBe("43625");
    expect(r.falha).toBeNull();
  });

  it("desliga o raciocínio no MiniMax, e não manda o parâmetro pra Anthropic", async () => {
    // `max_tokens: 400` só cabe porque a resposta é o JSON e nada mais. Se o
    // MiniMax ligar "thinking" por default um dia, os 400 tokens acabam antes
    // do JSON começar e TODA leitura vira truncada — em silêncio, porque o
    // parse tem fallback de corte balanceado.
    const chaves = { ANTHROPIC_API_KEY: "sk-ant-x", MINIMAX_API_KEY: "mm-x" };

    const mini = montarLeitor(chaves);
    await mini.leitor.ler({ ...ARGS, modelo: "MiniMax-M3" });
    expect(mini.create.mock.calls[0]![0].thinking).toEqual({ type: "disabled" });

    const claude = montarLeitor(chaves);
    await claude.leitor.ler({ ...ARGS, modelo: "claude-opus-5" });
    expect(claude.create.mock.calls[0]![0].thinking).toBeUndefined();
  });

  it("usa o MESMO prompt nos dois fornecedores — senão a comparação não vale nada", async () => {
    const chaves = { ANTHROPIC_API_KEY: "sk-ant-x", MINIMAX_API_KEY: "mm-x" };

    const mini = montarLeitor(chaves);
    await mini.leitor.ler({ ...ARGS, modelo: "MiniMax-M3" });
    const claude = montarLeitor(chaves);
    await claude.leitor.ler({ ...ARGS, modelo: "claude-haiku-4-5-20251001" });

    const sistema = (c: typeof mini) => c.create.mock.calls[0]![0].system as string;
    expect(sistema(mini)).toBe(sistema(claude));
  });

  it("cobra o preço do fornecedor certo", async () => {
    const chaves = { ANTHROPIC_API_KEY: "sk-ant-x", MINIMAX_API_KEY: "mm-x" };

    const mini = montarLeitor(chaves);
    const rMini = await mini.leitor.ler({ ...ARGS, modelo: "MiniMax-M3" });
    const claude = montarLeitor(chaves);
    const rClaude = await claude.leitor.ler({ ...ARGS, modelo: "claude-haiku-4-5-20251001" });

    expect(rMini.custoUsd).toBeGreaterThan(0);
    expect(rMini.custoUsd).toBeLessThan(rClaude.custoUsd);
  });

  it("modelo sem chave do fornecedor falha com nome, não com undefined", async () => {
    const { leitor } = montarLeitor({ ANTHROPIC_API_KEY: "sk-ant-x" });
    await expect(leitor.ler({ ...ARGS, modelo: "MiniMax-M3" })).rejects.toThrow(
      ProvedorIaNaoConfigurado,
    );
  });

  it("resposta fora do formato é defeito de execução, não foto ruim", async () => {
    const { leitor, create } = montarLeitor({ ANTHROPIC_API_KEY: "sk-ant-x" });
    create.mockResolvedValueOnce({
      usage: { input_tokens: 10, output_tokens: 3 },
      content: [{ type: "text", text: "desculpa, não consegui" }],
    } as never);

    const r = await leitor.ler(ARGS);
    // "resposta-invalida" retenta; "foto-ilegivel" mandaria o motorista parar o
    // caminhão pra fotografar de novo. Confundir os dois cobra do lado errado.
    expect(r.falha).toBe("resposta-invalida");
  });
});

/**
 * As regras abaixo não são estilo — cada uma corrige um erro que foi OBSERVADO
 * numa leitura real durante a avaliação do MiniMax M3, em 24/08/2026. Ficam
 * travadas em teste porque some fácil numa reescrita de prompt, e o custo de
 * perder qualquer uma delas é peso errado indo pro faturamento.
 */
describe("INSTRUCOES — regras pagas com medição", () => {
  const prompt = () => {
    const { leitor, create } = montarLeitor({ ANTHROPIC_API_KEY: "sk-ant-x" });
    return leitor
      .ler(ARGS)
      .then(() => (create.mock.calls[0]![0] as { system: string }).system);
  };

  it("proíbe usar a coluna de M³ como peso", async () => {
    // O erro real: numa foto girada 270°, o modelo leu "23,376" (o M³) em vez
    // de "39,740" (as toneladas) — as duas colunas vêm coladas no romaneio da
    // usina. Confiança 0,92: errado E confiante. Faturaria a viagem pela metade.
    expect(await prompt()).toMatch(/M³|METRO CÚBICO/i);
  });

  it("manda conferir o líquido contra bruto − tara", async () => {
    // A trava aritmética que pega troca de coluna sem depender da vista.
    expect(await prompt()).toMatch(/bruto − tara|bruto - tara/i);
  });

  it("avisa que a foto pode estar em qualquer posição", async () => {
    // Motorista fotografa de pé, deitado e de cabeça pra baixo — não há padrão,
    // e ler a coluna vizinha por causa da inclinação era o erro mais comum.
    expect(await prompt()).toMatch(/QUALQUER POSIÇÃO/i);
  });

  it("manda devolver null em vez de chutar", async () => {
    // null custa uma conferida humana; número inventado entra no faturamento.
    expect(await prompt()).toMatch(/null, NUNCA UM CHUTE/i);
  });

  it("segue mandando usar o peso LÍQUIDO", async () => {
    expect(await prompt()).toMatch(/SEMPRE o LÍQUIDO/);
  });
});

/**
 * O caso que mudou o desenho (05/10/2026): com o lançado na mesma chamada da
 * foto, o modelo devolveu "Obra: ARENA — confere" num ticket sem "ARENA"
 * escrito. Ele copiou. A trava é ele não ver o lançado enquanto lê.
 */
describe("leitura às cegas", () => {
  const DECLARADO = {
    numeroDocumento: "46779",
    toneladas: 39.85,
    cliente: "ARENA",
    material: "BICA CORRIDA",
  };

  function respostas(leitura: Record<string, unknown>, julgamento: Record<string, unknown>) {
    const { leitor, create } = montarLeitor({ ANTHROPIC_API_KEY: "sk-ant-x" });
    create
      .mockResolvedValueOnce({
        usage: { input_tokens: 1500, output_tokens: 120 },
        content: [{ type: "text", text: JSON.stringify(leitura) }],
      } as never)
      .mockResolvedValueOnce({
        usage: { input_tokens: 600, output_tokens: 150 },
        content: [{ type: "text", text: JSON.stringify(julgamento) }],
      } as never);
    return { leitor, create };
  }

  const LEITURA_SEM_OBRA = {
    tipoDocumento: "ticket_balanca",
    legivel: true,
    confidence: 0.92,
    numeroDocumento: "46779",
    toneladas: 39.85,
    cliente: null,
    material: "BICA CORRIDA",
  };

  it("a chamada com a foto NÃO leva nada do que foi lançado", async () => {
    const { leitor, create } = respostas(LEITURA_SEM_OBRA, {});
    await leitor.ler({ fotoBase64: "AAAA", mime: "image/jpeg", declarado: DECLARADO });

    const req = create.mock.calls[0]![0];
    const tudo = JSON.stringify(req);
    expect(tudo).toContain('"type":"image"');
    expect(tudo).not.toContain("ARENA");
    expect(tudo).not.toContain("39.85");
    expect(tudo).not.toContain("46779");
  });

  it("o julgamento é só texto: sem foto, com o lido e o lançado", async () => {
    const { leitor, create } = respostas(LEITURA_SEM_OBRA, {});
    await leitor.ler({ fotoBase64: "AAAA", mime: "image/jpeg", declarado: DECLARADO });

    const req = create.mock.calls[1]![0];
    const tudo = JSON.stringify(req);
    expect(tudo).not.toContain('"type":"image"');
    expect(tudo).toContain("LIDO:");
    expect(tudo).toContain("ARENA");
  });

  it("campo que o papel não trouxe nunca sai 'confere', diga o julgamento o que disser", async () => {
    const { leitor } = respostas(LEITURA_SEM_OBRA, {
      cliente: { confere: "sim", porque: "bate" },
      material: { confere: "sim", porque: "bate" },
    });
    const r = await leitor.ler({ fotoBase64: "AAAA", mime: "image/jpeg", declarado: DECLARADO });

    expect(r.lido.clienteNome).toBeNull();
    expect(r.julgamento.cliente?.confere).toBe("incerto");
    expect(r.julgamento.material?.confere).toBe("sim");
  });

  it("soma o custo das duas etapas", async () => {
    const duas = respostas(LEITURA_SEM_OBRA, {});
    const r = await duas.leitor.ler({ fotoBase64: "AAAA", mime: "image/jpeg", declarado: DECLARADO });
    // Mesma leitura, mas ilegível: só a etapa 1 é paga.
    const uma = respostas({ ...LEITURA_SEM_OBRA, legivel: false }, {});
    const r1 = await uma.leitor.ler({ fotoBase64: "AAAA", mime: "image/jpeg", declarado: DECLARADO });
    expect(r1.custoUsd).toBeGreaterThan(0);
    expect(r.custoUsd).toBeGreaterThan(r1.custoUsd);
  });

  it("foto ilegível não paga o julgamento", async () => {
    const { leitor, create } = respostas({ legivel: false, confidence: 0 }, {});
    const r = await leitor.ler({ fotoBase64: "AAAA", mime: "image/jpeg", declarado: DECLARADO });
    expect(r.falha).toBe("foto-ilegivel");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("julgamento fora do formato retenta, não vira foto ruim", async () => {
    const { leitor, create } = montarLeitor({ ANTHROPIC_API_KEY: "sk-ant-x" });
    create
      .mockResolvedValueOnce({
        usage: { input_tokens: 1500, output_tokens: 120 },
        content: [{ type: "text", text: JSON.stringify(LEITURA_SEM_OBRA) }],
      } as never)
      .mockResolvedValueOnce({
        usage: { input_tokens: 600, output_tokens: 3 },
        content: [{ type: "text", text: "hmm" }],
      } as never);
    const r = await leitor.ler({ fotoBase64: "AAAA", mime: "image/jpeg", declarado: DECLARADO });
    expect(r.falha).toBe("resposta-invalida");
  });
});

describe("escolherNumero", () => {
  it("prefere, entre os números LIDOS, o que bate com o lançado", () => {
    expect(escolherNumero("998877", ["TKB-043625"], "43625")).toBe("TKB-043625");
  });

  it("sem nenhum lido batendo, fica o principal — o lançado nunca entra no lugar", () => {
    expect(escolherNumero("998877", ["112233"], "43625")).toBe("998877");
    expect(escolherNumero(null, [], "43625")).toBeNull();
  });

  it("série diferente dos dois lados é outro documento", () => {
    expect(escolherNumero("998877", ["A-3174"], "B-3174")).toBe("998877");
  });
});

describe("forcarSemLeitura", () => {
  it("rebaixa 'sim' a 'incerto' quando o lido está vazio, e não mexe no resto", () => {
    const j = forcarSemLeitura(
      {
        cliente: { confere: "sim", porque: "x" },
        placa: { confere: "nao", porque: "y" },
        toneladas: { confere: "sim", porque: "z" },
      },
      { confianca: 0.9, clienteNome: null, placa: null, toneladas: 30 },
    );
    expect(j.cliente).toEqual({ confere: "incerto", porque: "não aparece no documento" });
    expect(j.placa?.confere).toBe("nao");
    expect(j.toneladas?.confere).toBe("sim");
  });
});

describe("LeitorTicketService.disponivel", () => {
  it("basta a chave de UM fornecedor", async () => {
    const so_minimax = new ClienteIaFactory({
      get: (c: string) => (c === "MINIMAX_API_KEY" ? "mm-x" : undefined),
    } as unknown as ConfigService);
    expect(new LeitorTicketService(so_minimax, usoFake).disponivel).toBe(true);

    const nenhum = new ClienteIaFactory({ get: () => undefined } as unknown as ConfigService);
    expect(new LeitorTicketService(nenhum, usoFake).disponivel).toBe(false);
  });
});
