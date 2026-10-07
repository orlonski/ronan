import { describe, expect, it } from "vitest";
import { conteudoParaGuardar, mascararTexto, rotaSemIds, servicoDoHost, urlSemSegredo, usoDeIa } from "./registro";

describe("registro de chamadas externas", () => {
  it("dá nome ao serviço pelo endereço; rota e arquivos guardam só o resumo", () => {
    expect(servicoDoHost("api.anthropic.com")).toEqual({ nome: "IA (Anthropic)", soResumo: false });
    expect(servicoDoHost("dados.antt.gov.br").nome).toBe("ANTT");
    expect(servicoDoHost("osrm.interno:5000", { OSRM_URL: "http://osrm.interno:5000" })).toEqual({ nome: "Rotas (OSRM)", soResumo: true });
    expect(servicoDoHost("algo-novo.com.br")).toEqual({ nome: "algo-novo.com.br", soResumo: false });
  });

  it("segredo nunca fica: chave, token, senha; CPF, telefone e e-mail mascarados", () => {
    const g = conteudoParaGuardar({
      apiKey: "sk-123",
      senha: "x",
      motorista: { cpf: "111.444.777-35", telefone: "5565999998888", email: "joao@exemplo.com" },
      texto: "CPF 11144477735",
    }) as Record<string, unknown>;
    expect(g.apiKey).toBe("***");
    expect(g.senha).toBe("***");
    expect(JSON.stringify(g)).not.toMatch(/111\.444|11144477735|999998888|joao@/);
    // 11 dígitos soltos podem ser CPF ou celular: os dois saem mascarados.
    expect(mascararTexto("motorista 65999998888 ligou")).not.toMatch(/9999/);
    expect(mascararTexto("fone 556599998888")).toBe("fone (65) *****-8888");
  });

  it("foto em base64 mandada pra IA não é guardada", () => {
    const foto = "A".repeat(5000);
    const g = conteudoParaGuardar({ messages: [{ content: [{ type: "image", source: { data: foto } }] }] });
    expect(JSON.stringify(g)).toMatch(/arquivo em base64, 4 KB — não guardado/);
  });

  it("conteúdo enorme é cortado", () => {
    const g = conteudoParaGuardar({ lista: Array.from({ length: 150 }, (_, i) => ({ i, t: "x".repeat(400) })) }) as Record<string, unknown>;
    expect(g.cortado).toBe(true);
  });

  it("query com chave some da URL", () => {
    expect(urlSemSegredo("https://maps.googleapis.com/maps/api/geocode/json?address=Cuiaba&key=ABC")).toEqual({
      host: "maps.googleapis.com",
      caminho: "/maps/api/geocode/json?address=Cuiaba&key=***",
    });
  });

  it("segredo no CAMINHO some: webhooks conhecidos e pedaço com cara de chave", () => {
    expect(urlSemSegredo("https://hooks.zapier.com/hooks/catch/1234567/3xyz8kq/").caminho).toBe("/hooks/catch/***");
    expect(urlSemSegredo("https://hooks.slack.com/services/T000/B000/XXXXxxxx1234YYYY5678zz").caminho).toBe("/services/***");
    expect(urlSemSegredo("https://discord.com/api/webhooks/123/abcDEF456ghi").caminho).toBe("/api/webhooks/***");
    expect(urlSemSegredo("https://api.telegram.org/bot123456:AAH-segredo9x/sendMessage").caminho).toBe("/***/sendMessage");
    expect(urlSemSegredo("https://exemplo.com/receber/a8F3kL9pQ2xZ7vB4nM6tR1sE/eventos").caminho).toBe("/receber/***/eventos");
    // Id de registro não é segredo.
    expect(urlSemSegredo("https://exemplo.com/viagens/3701a585-f51e-47bb-8950-1e0af637e56d").caminho).toBe(
      "/viagens/3701a585-f51e-47bb-8950-1e0af637e56d",
    );
    // Token na query (o JWT aceita ?access_token=).
    expect(urlSemSegredo("http://api/admin/x?access_token=eyJabc&pagina=2").caminho).toBe("/admin/x?access_token=***&pagina=2");
  });

  it("lê tokens da Anthropic, OpenAI e Gemini", () => {
    expect(usoDeIa({ model: "claude-haiku", usage: { input_tokens: 10, output_tokens: 5 } })).toEqual({ modelo: "claude-haiku", tokensEntrada: 10, tokensSaida: 5 });
    expect(usoDeIa({ model: "gpt", usage: { prompt_tokens: 3, completion_tokens: 2 } })?.tokensSaida).toBe(2);
    expect(usoDeIa({ modelVersion: "gemini-2", usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 1 } })?.tokensEntrada).toBe(7);
    expect(usoDeIa({ ok: true })).toBeNull();
  });

  it("gatilho agrupa as rotas sem os ids", () => {
    expect(rotaSemIds("POST", "/admin/viagens/3701a585-f51e-47bb-8950-1e0af637e56d/fotos?x=1")).toBe("POST /admin/viagens/:id/fotos");
  });
});
