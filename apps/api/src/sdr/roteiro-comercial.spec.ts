import { describe, expect, it } from "vitest";
import {
  abertura,
  caminhos,
  codigoNaoChegou,
  controleAtual,
  disseQueCriouConta,
  duvidaDeCadastro,
  ehAbertura,
  ehCaminhos,
  ehTestePasso1,
  ehTestePasso2,
  escolhaDeCaminho,
  primeiroNome,
  querConhecer,
  testePasso1,
  testePasso2,
  travouNoCadastro,
} from "./roteiro-comercial";

const OFERTA = { diasTeste: 30, linkTeste: "https://app.movatruck.com.br/cadastro" };
const NADA = { veiculo: false, locais: false, cliente: false, motorista: false, viagem: false };

describe("a abertura", () => {
  it("termina numa pergunta sobre a operação dele, sem link solto e sem frota", () => {
    const a = abertura("Diego");
    expect(a).toMatch(/^Opa, Diego!/);
    expect(a).toMatch(/controlam as viagens como: planilha, caderno ou algum sistema\?$/);
    expect(a).not.toMatch(/https?:\/\//);
    expect(a).not.toMatch(/caminh[oõ]es\s+rodam|quantos/i);
    expect(ehAbertura(a)).toBe(true);
  });

  it("nunca usa travessão", () => {
    for (const t of [abertura(null), caminhos(OFERTA, "planilha"), testePasso1(OFERTA), testePasso2(null)]) {
      expect(t).not.toMatch(/[—–]/);
    }
  });
});

describe("os dois caminhos", () => {
  it("explica o que cada um é e reconhece como ele controla hoje", () => {
    const c = caminhos(OFERTA, "planilha");
    expect(c).toMatch(/^Entendi, planilha\./);
    expect(c).toContain("*1.* Um consultor te liga");
    expect(c).toContain("*2.* Você cria sua conta e testa 30 dias grátis, sem cartão, e eu te acompanho");
    expect(ehCaminhos(c)).toBe(true);
  });

  it.each([
    ["1", 1],
    ["a primeira", 1],
    ["Ligação", 1],
    ["prefiro que o consultor ligue", 1],
    ["2", 2],
    ["Prefiro testar", 2],
    ["quero criar a conta", 2],
    ["a segunda opção", 2],
    ["sei lá", null],
    ["não quero ligação", null],
    ["ninguém me liga", null],
  ])("%s → %s", (texto, esperado) => {
    expect(escolhaDeCaminho(texto)).toBe(esperado);
  });

  it.each([
    ["uso planilha", "planilha"],
    ["no caderno mesmo", "caderno"],
    ["pelo zap", "whatsapp"],
    ["temos um sistema", "sistema"],
    ["de cabeça", "nada"],
    ["legal", null],
  ])("controle: %s → %s", (texto, esperado) => {
    expect(controleAtual(texto)).toBe(esperado);
  });
});

describe("o teste guiado", () => {
  it("passo 1 é criar a conta da TRANSPORTADORA, com o que o formulário pede", () => {
    const p = testePasso1(OFERTA);
    expect(p).toContain(OFERTA.linkTeste);
    expect(p).toContain("nome da transportadora, seu nome, WhatsApp, e-mail e uma senha");
    expect(p).toContain("sem cartão e sem fidelidade");
    expect(p).not.toMatch(/lan[cç]ando uma viagem|cadastrando um motorista/i);
    expect(ehTestePasso1(p)).toBe(true);
  });

  it("passo 2 segue a ordem do painel e deixa o motorista por último", () => {
    const p = testePasso2(NADA);
    const ordem = ["*Caminhões:*", "*Locais:*", "*Clientes:*", "*Motoristas:*"].map((x) => p.indexOf(x));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(p).toMatch(/^Conta criada!/);
    expect(p).toContain("*Primeiros passos*");
    expect(p).toContain("*Importar dados*");
    expect(ehTestePasso2(p)).toBe(true);
  });

  it("passo 2 pula o que já foi feito, e diz o que viu", () => {
    const p = testePasso2({ ...NADA, veiculo: true, locais: true });
    expect(p).toMatch(/^Vi que você já cadastrou caminhão e os locais\. Agora falta:/);
    expect(p).not.toContain("*Caminhões:*");
    expect(p).toContain("*1.* *Clientes:*");
    expect(p).toContain("*2.* *Motoristas:*");
  });

  it("com tudo cadastrado, a vez é do motorista", () => {
    const p = testePasso2({ veiculo: true, locais: true, cliente: true, motorista: true, viagem: false });
    expect(p).toMatch(/A sua parte está pronta/);
    expect(p).toMatch(/motorista abrir o app e lançar a primeira viagem/);
  });

  it("sem saber a conta (outro telefone), manda a lista inteira sem dizer 'conta criada'", () => {
    const p = testePasso2(null, false);
    expect(p).toMatch(/^Boa! Agora é deixar o painel/);
    expect(p).toContain("*Caminhões:*");
  });

  it.each([
    ["criei", true],
    ["pronto, já entrei", true],
    ["consegui", true],
    ["ainda não consegui", false],
    ["não criei ainda", false],
  ])("criou a conta: %s → %s", (texto, esperado) => {
    expect(disseQueCriouConta(texto)).toBe(esperado);
  });

  it("reconhece o código que não chegou e o cadastro travado", () => {
    expect(codigoNaoChegou("não chegou o código")).toBe(true);
    expect(codigoNaoChegou("cadê o código?")).toBe(true);
    expect(codigoNaoChegou("chegou o código")).toBe(false);
    expect(travouNoCadastro("não consigo entrar")).toBe(true);
    expect(travouNoCadastro("deu erro aqui")).toBe(true);
  });
});

describe("dúvida de cadastro no meio do teste", () => {
  it.each([
    ["onde eu cadastro a pedreira?", "*Locais*"],
    ["como coloco o caminhão", "*Veículos*"],
    ["onde cadastro o cliente?", "*Clientes*"],
    ["como convido o motorista?", "convida pelo CPF"],
  ])("%s → %s", (texto, esperado) => {
    expect(duvidaDeCadastro(texto)).toContain(esperado);
  });

  it("não pega conversa que não é dúvida de cadastro", () => {
    expect(duvidaDeCadastro("quanto custa?")).toBeNull();
    expect(duvidaDeCadastro("tenho 3 caminhões")).toBeNull();
  });
});

describe("querConhecer", () => {
  it.each([
    ["Tenho uma transportadora e quero conhecer a Movatruck", true],
    ["me fala mais", true],
    ["o que é a Movatruck?", true],
    ["quero testar", false],
    ["quanto custa?", false],
  ])("%s → %s", (texto, esperado) => {
    expect(querConhecer(texto)).toBe(esperado);
  });
});

describe("primeiroNome", () => {
  it.each([
    ["Passe Livre — Diego", "Diego"],
    ["diego orlonski", "Diego"],
    ["+5542998424945", null],
    ["Transportes Silva", null],
    ["Areia Boa Ltda", null],
    ["Cliente Teste", null],
    [null, null],
  ])("%s → %s", (bruto, esperado) => {
    expect(primeiroNome(bruto)).toBe(esperado);
  });
});
