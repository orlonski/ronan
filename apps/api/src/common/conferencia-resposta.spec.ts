import { describe, expect, it } from "vitest";
import {
  BOTOES_CONFERENCIA_DIARIA,
  lerPayloadConferencia,
  montarMensagemAoParar,
  payloadConferencia,
} from "@ronan/shared-types";
import {
  FRASES_NUMERO_ERRADO,
  FRASES_VOLTAR,
  ehNumeroErrado,
  deveSuprimirResumo,
  diaTextoConferencia,
  ehPedidoDeVoltar,
  interpretarIntencaoConferencia,
  interpretarRespostaConferencia,
  normalizarResposta,
  sufixoTelefone,
  textoPerguntaConferencia,
} from "./conferencia-resposta";

describe("interpretador da resposta (sem IA)", () => {
  // A tabela É a especificação: o que cada texto muda no sistema.
  const tabela: [string, string][] = [
    // botões (o Chatwoot entrega o TÍTULO do botão como texto)
    ["Não tive", "NAO_TIVE"],
    ["Tive, não lancei", "TIVE_NAO_LANCEI"],
    ["Saí da empresa", "SAI_DA_EMPRESA"],
    ["Parar perguntas", "PARAR"],
    // números do menu
    ["1", "NAO_TIVE"],
    ["2", "TIVE_NAO_LANCEI"],
    ["3", "SAI_DA_EMPRESA"],
    ["4", "PARAR"],
    [" 4 ", "PARAR"],
    ["4.", "PARAR"],
    // sim/não (pergunta é "você NÃO teve viagens?")
    ["sim", "NAO_TIVE"],
    ["Sim!", "NAO_TIVE"],
    ["SIM", "NAO_TIVE"],
    ["não", "TIVE_NAO_LANCEI"],
    ["Nao", "TIVE_NAO_LANCEI"],
    // variações naturais
    ["nao tive", "NAO_TIVE"],
    ["Não tive viagem", "NAO_TIVE"],
    ["não tive viagens.", "NAO_TIVE"],
    ["tive mas nao lancei", "TIVE_NAO_LANCEI"],
    ["esqueci", "TIVE_NAO_LANCEI"],
    ["sai da empresa", "SAI_DA_EMPRESA"],
    ["parar", "PARAR"],
    ["PARE", "PARAR"],
    ["stop", "PARAR"],
    ["não quero mais receber", "PARAR"],
    // qualquer outra coisa é ambígua — e vai pra um humano
    ["", "AMBIGUA"],
    ["   ", "AMBIGUA"],
    ["oi", "AMBIGUA"],
    ["bom dia", "AMBIGUA"],
    ["5", "AMBIGUA"],
    ["12", "AMBIGUA"],
    ["não tive tempo de ligar pro cliente", "AMBIGUA"], // nunca "contém"
    ["quero parar de trabalhar", "AMBIGUA"],
    ["sim, mas depois", "AMBIGUA"],
    ["tive 3 viagens ontem", "AMBIGUA"],
    ["👍", "AMBIGUA"],
    ["sair", "AMBIGUA"],
  ];
  it.each(tabela)("%j → %s", (texto, esperado) => {
    expect(interpretarRespostaConferencia(texto)).toBe(esperado);
  });

  it("áudio/foto/figurinha (sem texto) é ambíguo", () => {
    expect(interpretarRespostaConferencia(null)).toBe("AMBIGUA");
    expect(interpretarRespostaConferencia(undefined)).toBe("AMBIGUA");
  });

  it("o rótulo de CADA botão do template é entendido (o toque chega ao Chatwoot como texto)", () => {
    for (const b of BOTOES_CONFERENCIA_DIARIA) {
      expect(interpretarRespostaConferencia(b.rotulo)).toBe(b.opcao);
    }
  });

  it("normaliza acento, caixa e pontuação", () => {
    expect(normalizarResposta("  Saí,  da EMPRESA!! ")).toBe("sai da empresa");
  });
});

describe("payload do botão", () => {
  const id = "3f2b1c9e-8d4a-4f6b-9a1e-0c7d5e2b6a11";
  it("vai e volta", () => {
    for (const b of BOTOES_CONFERENCIA_DIARIA) {
      const p = payloadConferencia(id, b.opcao);
      expect(p).toBe(`cv:${id}:${b.opcao}`);
      expect(lerPayloadConferencia(p)).toEqual({ conferenciaId: id, opcao: b.opcao });
    }
  });
  it("cabe nos 256 caracteres da Meta", () => {
    for (const b of BOTOES_CONFERENCIA_DIARIA) expect(payloadConferencia(id, b.opcao).length).toBeLessThan(256);
  });
  it("lixo, payload de outra coisa e opção inventada não passam", () => {
    expect(lerPayloadConferencia(undefined)).toBeNull();
    expect(lerPayloadConferencia("")).toBeNull();
    expect(lerPayloadConferencia("outra:coisa")).toBeNull();
    expect(lerPayloadConferencia(`cv:${id}:APAGAR_TUDO`)).toBeNull();
    // AMBIGUA não é botão: ninguém pode "tocar" nela.
    expect(lerPayloadConferencia(`cv:${id}:AMBIGUA`)).toBeNull();
    expect(lerPayloadConferencia(`xcv:${id}:PARAR`)).toBeNull();
  });
});

describe("texto da pergunta", () => {
  it("o dia sai como 'sexta, 25/09'", () => {
    expect(diaTextoConferencia("2026-09-25")).toBe("sexta, 25/09");
    expect(diaTextoConferencia("2026-09-27")).toBe("domingo, 27/09");
  });
  it("o texto do histórico espelha o do template e lista as opções", () => {
    const t = textoPerguntaConferencia("sexta, 25/09");
    expect(t).toContain("No dia sexta, 25/09, você não teve viagens?");
    expect(t).toContain("4. Parar perguntas");
  });
  it("não fala em pessoa da equipe nem em subordinação", () => {
    const t = textoPerguntaConferencia("sexta, 25/09").toLowerCase();
    expect(t).not.toMatch(/fernando|consultor|funcionári|controle|obrigatóri/);
  });
});

describe("pedido de voltar a receber (VOLTAR)", () => {
  it.each([
    "voltar",
    "VOLTAR",
    "Voltar!",
    "  voltar.  ",
    "quero voltar",
    "Quero voltar",
    "retomar",
    "pode voltar a perguntar",
    "Pode voltar a perguntar!",
    "quero receber",
    "voltar a receber",
    "Voltar a receber as perguntas",
    "voltem a perguntar",
  ])("%s é VOLTAR", (t) => {
    expect(interpretarIntencaoConferencia(t)).toBe("VOLTAR");
    expect(ehPedidoDeVoltar(t)).toBe(true);
  });

  it.each([
    "voltar amanhã com a carga",
    "vou voltar pro posto",
    "não quero voltar",
    "nao quero receber voltar",
    "já volto",
    "vou voltar mais tarde",
    "quero voltar pra empresa de vocês amanhã",
    "voltar pro pátio",
    "volto amanhã",
    "",
    "   ",
    "👍",
  ])("%j NÃO é VOLTAR", (t) => {
    expect(interpretarIntencaoConferencia(t)).not.toBe("VOLTAR");
    expect(ehPedidoDeVoltar(t)).toBe(false);
  });

  it("vazio/nulo é AMBIGUA", () => {
    expect(interpretarIntencaoConferencia(null)).toBe("AMBIGUA");
    expect(interpretarIntencaoConferencia(undefined)).toBe("AMBIGUA");
  });

  it("as opções da pergunta continuam lidas pelo mesmo interpretador", () => {
    expect(interpretarIntencaoConferencia("parar perguntas")).toBe("PARAR");
    expect(interpretarIntencaoConferencia("1")).toBe("NAO_TIVE");
  });

  it("o interpretador antigo nunca devolve VOLTAR (não é opção da pergunta)", () => {
    expect(interpretarRespostaConferencia("voltar")).toBe("AMBIGUA");
  });

  it("a tabela só tem frases já normalizadas e sem colisão com as opções", () => {
    for (const f of FRASES_VOLTAR) {
      expect(normalizarResposta(f)).toBe(f);
      expect(interpretarRespostaConferencia(f)).toBe("AMBIGUA");
    }
  });
});

describe("mensagem ao parar (orientação, por empresa)", () => {
  it("o texto padrão ensina a voltar", () => {
    expect(montarMensagemAoParar(null, "Aurora", null)).toContain("responder VOLTAR");
  });
  it("padrão com o nome da empresa e sem contato", () => {
    const t = montarMensagemAoParar(null, "Transportes Aurora", null);
    expect(t).toContain("fale com Transportes Aurora.");
    expect(t).toContain("viagem que não é lançada no app não entra no seu acerto");
    expect(t).not.toContain("{");
  });
  it("com contato, entra entre parênteses", () => {
    expect(montarMensagemAoParar(null, "Aurora", "42 99999-0000")).toContain("fale com Aurora (42 99999-0000).");
  });
  it("texto próprio da empresa vence o padrão", () => {
    expect(montarMensagemAoParar("Ok. Chame {empresa}{contato}", "Aurora", "no zap 4299")).toBe(
      "Ok. Chame Aurora (no zap 4299)",
    );
  });
  it("modelo em branco cai no padrão", () => {
    expect(montarMensagemAoParar("   ", "Aurora", null)).toContain("Aurora");
  });
  it("nunca cita a Schaba: quem aparece é o nome da conta", () => {
    expect(montarMensagemAoParar(null, "Outra Transportadora", null)).not.toMatch(/schaba/i);
  });
});

describe("resumo diário e a conferência", () => {
  const base = { suprimirLigado: true, temPendencia: false, recebeuPerguntaHoje: true };
  it("recebeu a pergunta hoje e nada pendente: suprime", () => {
    expect(deveSuprimirResumo(base)).toBe(true);
  });
  it("pendência de peso/divergência SEMPRE sai", () => {
    expect(deveSuprimirResumo({ ...base, temPendencia: true })).toBe(false);
  });
  it("quem não recebeu a pergunta recebe o resumo", () => {
    expect(deveSuprimirResumo({ ...base, recebeuPerguntaHoje: false })).toBe(false);
  });
  it("opção desligada: nunca suprime", () => {
    expect(deveSuprimirResumo({ ...base, suprimirLigado: false })).toBe(false);
  });
});

describe("sufixo do telefone", () => {
  it("os 8 últimos dígitos, em qualquer formato", () => {
    expect(sufixoTelefone("+55 (42) 99108-8125")).toBe("91088125");
    expect(sufixoTelefone("42991088125")).toBe(sufixoTelefone("554291088125"));
  });
});

describe("\"número errado\" (texto livre, correspondência exata)", () => {
  it.each([
    "Número errado",
    "NUMERO ERRADO!",
    "engano",
    "Foi engano.",
    "não sou eu",
    "Não sou eu!!",
    "não conheço",
    "não sou motorista",
    "Não sou essa pessoa",
    "esse não é meu número",
    "Esse não é o meu número.",
    "numero trocado",
  ])("%s é número errado", (t) => {
    expect(ehNumeroErrado(t)).toBe(true);
    expect(interpretarIntencaoConferencia(t)).toBe("NUMERO_ERRADO");
  });

  it.each([
    "não sou eu que dirijo hoje",
    "engano meu, esqueci de lançar",
    "esse número é meu sim",
    "não conheço essa rota",
    "numero",
    "errado",
    "não",
    "sim",
    "1",
    "parar",
    "voltar",
    "",
  ])("%s NÃO é número errado (nunca por semelhança)", (t) => {
    expect(ehNumeroErrado(t)).toBe(false);
    expect(interpretarIntencaoConferencia(t)).not.toBe("NUMERO_ERRADO");
  });

  it("texto vazio/nulo não é", () => {
    expect(ehNumeroErrado(null)).toBe(false);
    expect(ehNumeroErrado(undefined)).toBe(false);
  });

  it("não conflita com os botões, com 'parar' nem com 'voltar'", () => {
    for (const f of FRASES_NUMERO_ERRADO) {
      expect(interpretarRespostaConferencia(f), f).toBe("AMBIGUA");
      expect(ehPedidoDeVoltar(f), f).toBe(false);
    }
  });
});
