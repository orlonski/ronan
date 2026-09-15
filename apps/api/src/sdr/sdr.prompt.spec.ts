import { describe, it, expect } from "vitest";
import { promptSdr } from "./sdr.prompt";
import { EMPRESA_A_DESCOBRIR, empresaConhecida, nomeDePessoa, telefoneDaCasa } from "./lead-inbound";

const LEAD_CONHECIDO = {
  empresa: "Transportes Serra Azul",
  nome: "Sérgio",
  municipio: "Ponta Grossa",
  uf: "PR",
  frotaQtd: 12,
  origem: "PROSPECCAO_ATIVA",
};

/** Quem chegou sozinho pelo WhatsApp: o sistema só tem o número dele. */
const LEAD_INBOUND = {
  empresa: null,
  nome: null,
  municipio: null,
  uf: null,
  frotaQtd: null,
  origem: "WHATSAPP_INBOUND",
};

describe("o que o SDR sabe de quem está do outro lado", () => {
  it("diz o que sabe do lead que a prospecção encontrou", () => {
    const p = promptSdr(LEAD_CONHECIDO);
    expect(p).toContain("Empresa: Transportes Serra Azul");
    expect(p).toContain("Falando com: Sérgio");
    expect(p).toContain("Frota conhecida: 12 caminhões");
  });

  it("não inventa empresa pra quem chegou sozinho", () => {
    // O carimbo é de banco, não de conversa: dito ao modelo, ele o leria como
    // o nome da transportadora e chamaria o cara de "Contato pelo WhatsApp".
    const p = promptSdr(LEAD_INBOUND);
    expect(p).not.toContain(EMPRESA_A_DESCOBRIR);
    expect(p).toContain("Você só tem o número dele");
  });

  it("manda descobrir a empresa só quando não sabe qual é", () => {
    expect(promptSdr(LEAD_INBOUND)).toContain("De que empresa ele é");
    expect(promptSdr(LEAD_CONHECIDO)).not.toContain("De que empresa ele é");
  });

  it("avisa que foi ele quem procurou a gente", () => {
    // Sem isto o modelo trata inbound como prospecção e abre a conversa se
    // explicando — "estou entrando em contato porque..." — pra quem escreveu
    // primeiro. Queima a conversa no primeiro parágrafo.
    const p = promptSdr(LEAD_INBOUND);
    expect(p).toContain("Ele escreveu primeiro");
    expect(promptSdr(LEAD_CONHECIDO)).not.toContain("Ele escreveu primeiro");
  });
});

describe("o lead que nasce de uma mensagem", () => {
  it("o carimbo de empresa não conta como empresa", () => {
    expect(empresaConhecida(EMPRESA_A_DESCOBRIR)).toBeNull();
    expect(empresaConhecida("   ")).toBeNull();
    expect(empresaConhecida(null)).toBeNull();
    expect(empresaConhecida("Transportes Serra Azul")).toBe("Transportes Serra Azul");
  });

  it("guarda o telefone como a Receita guarda: só dígitos, sem DDI", () => {
    // `registrarOptOut` compara por igualdade exata — "55" na frente faz o
    // opt-out marcar zero leads.
    expect(telefoneDaCasa("+55 42 99998-8888")).toBe("42999988888");
    expect(telefoneDaCasa("4335353078")).toBe("4335353078");
  });

  it("o número disfarçado de nome não vira pessoa", () => {
    expect(nomeDePessoa("Sérgio", "42999988888")).toBe("Sérgio");
    expect(nomeDePessoa("+55 42 99998-8888", "42999988888")).toBeNull();
    expect(nomeDePessoa("  ", "42999988888")).toBeNull();
  });
});
