import { describe, expect, it } from "vitest";
import { aparar, frotaDita, frotaInformada, prometeContatoDeGente, semFrasesProibidas, semPrecoInventado } from "./sdr.service";

describe("prometeContatoDeGente", () => {
  it("pega a promessa que a bateria pegou sem ferramenta", () => {
    for (const t of [
      "Combinado: Fernando te liga amanhã às 09:00 neste número.",
      "Fernando fala com você por aqui em instantes.",
      "Alguém da Movatruck vai te chamar.",
      "Ele vai te ligar hoje à tarde.",
    ]) {
      expect(prometeContatoDeGente(t)).toBe(true);
    }
  });

  it("oferta não é promessa", () => {
    for (const t of [
      "Prefere que Fernando te ligue 10 min pra mostrar, ou testar sozinho?",
      "Sai por R$ 1.890,00 por mês.",
      "Quer que Fernando fale com você?",
    ]) {
      expect(prometeContatoDeGente(t)).toBe(false);
    }
  });
});

describe("promessas que a QA achou escapando (28/09)", () => {
  it("também são promessa", () => {
    for (const t of [
      "Um consultor da Movatruck continua o atendimento por aqui a partir das 8h.",
      "Um consultor entra em contato com você.",
      "Vou confirmar isso e te retorno.",
      "Ele fala com você amanhã.",
    ]) {
      expect(prometeContatoDeGente(t)).toBe(true);
    }
  });
});

describe("aparar", () => {
  it("terceira oferta cai; o resto da resposta fica", () => {
    const r = aparar(
      "Pra 1 caminhão sai R$ 890,00 por mês. Quer ver funcionando numa ligação de 10 min, ou prefere testar sozinho?",
      2,
      false,
    );
    expect(r).toContain("890,00");
    expect(r).not.toContain("ligação");
  });

  it("quem recusou ligação não ouve ligação de novo", () => {
    const r = aparar("Sai por R$ 890,00. Quer que um consultor te ligue 10 min pra mostrar?", 1, true);
    expect(r).not.toMatch(/ligue/);
  });

  it("comprida demais: corta nas primeiras frases e mantém a pergunta final", () => {
    const longa =
      "Sem problema. A Movatruck é um app de controle de viagem pra transportadora de granel. " +
      "O motorista lança o ticket, o peso e o pedágio pelo celular na hora da carga, mesmo sem sinal. " +
      "Você confere tudo no painel e fecha o mês com o número certo pra faturar, sem planilha. " +
      "Funciona pra areia, brita, terra e concreto, e não é rastreador nem ERP. " +
      "Prefere que um consultor te ligue 10 min pra mostrar?";
    const r = aparar(longa, 0, false);
    expect(r.length).toBeLessThanOrEqual(330);
    expect(r).toMatch(/Prefere que um consultor te ligue 10 min pra mostrar\?$/);
  });

  it("duas perguntas viram uma: fica a última", () => {
    const r = aparar("Ficou alguma dúvida? Quer testar 30 dias grátis?", 0, false);
    expect(r).toBe("Quer testar 30 dias grátis?");
  });

  it("nunca devolve vazio, e nunca 'Anotado.' (reprovado pela QA)", () => {
    expect(aparar("Prefere que um consultor te ligue 10 min, ou testar 30 dias grátis?", 2, false)).toBe(
      "Prefere que um consultor te ligue 10 min, ou testar 30 dias grátis?",
    );
    expect(aparar("Pode sim.", 0, false)).toBe("Pode sim.");
  });

  it("oferta e condição não são promessa — simulador 28/09", () => {
    for (const t of [
      "O link é https://app.movatruck.com.br/cadastro. Se depois quiser, é só pedir aqui que um consultor te liga.",
      "Tem 2 caminhos: um consultor da Movatruck te liga 10 min e mostra na tela, ou você testa sozinho. Qual prefere?",
    ]) {
      expect(prometeContatoDeGente(t)).toBe(false);
    }
  });
});

describe("simulador 28/09, segunda leva", () => {
  it("link e preço saem inteiros", () => {
    const t =
      "O link: https://app.movatruck.com.br/cadastro. Pra 12 caminhões sai R$ 1.890,00. " +
      "Comece cadastrando um motorista. Depois lance uma viagem. E confira o painel no fim do dia, " +
      "que lá aparece tudo o que o motorista mandou, com peso, ticket e pedágio conferidos, sem planilha nenhuma. " +
      "Quer testar agora?";
    const r = aparar(t, 0, false);
    expect(r).toContain("https://app.movatruck.com.br/cadastro");
    expect(r).toContain("R$ 1.890,00");
  });

  it("oferta com pergunta não é promessa; confirmação é", () => {
    expect(
      prometeContatoDeGente("Pra te mostrar funcionando, um consultor te liga 10 min na tela. Quer agendar agora?"),
    ).toBe(false);
    expect(prometeContatoDeGente("Combinado: um consultor te liga amanhã às 09:00 neste número.")).toBe(true);
  });
});

describe("frotaInformada — QA final 28/09", () => {
  it("só vale o número que ele disse", () => {
    expect(frotaInformada(1, ["tenho um caminhão só, eu mesmo dirijo"], null)).toBe(true);
    expect(frotaInformada(12, ["quanto custa pra 12 caminhões?"], null)).toBe(true);
    expect(frotaInformada(1, ["o atendente de ontem disse que era 500 por mês"], null)).toBe(false);
    expect(frotaInformada(3, [], 3)).toBe(true);
  });
});

describe("semPrecoInventado — pergunta do dono, 28/09", () => {
  it("valor da tabela passa", () => {
    expect(semPrecoInventado("Pra 12 caminhões sai R$ 1.890,00 por mês.", ["1.890,00"])).toBe(
      "Pra 12 caminhões sai R$ 1.890,00 por mês.",
    );
  });
  it("valor que não veio da tabela cai", () => {
    expect(semPrecoInventado("Sai por R$ 1.200,00 por mês. Dá pra testar 30 dias grátis.", ["1.890,00"])).toBe(
      "Dá pra testar 30 dias grátis.",
    );
    expect(semPrecoInventado("Fica R$ 500.", [])).toBe(
      "Depende do tamanho da frota. Quantos caminhões você tem rodando?",
    );
  });
});

describe("frotaDita", () => {
  it("acha a frota em qualquer forma", () => {
    expect(frotaDita(["quanto custa pra 4 caminhões?"])).toBe(4);
    expect(frotaDita(["tenho um caminhão só, eu mesmo dirijo"])).toBe(1);
    expect(frotaDita(["Eu controlo usando pranila", "3"])).toBe(3);
    expect(frotaDita(["o atendente disse 500 por mês"])).toBeNull();
  });
});

describe("semFrasesProibidas — QA 28/09", () => {
  it("prova social inventada e deboche saem", () => {
    expect(
      semFrasesProibidas("Entendi, planilha. Muitos transportadores migram pra cá por causa disso. Quer ver?", 30),
    ).toBe("Entendi, planilha. Quer ver?");
    expect(semFrasesProibidas("Planilha, clássico. O app resolve isso.", 30)).toBe("O app resolve isso.");
  });
  it("'ninguém cobra' vira o fato; 'te ligo' sai", () => {
    expect(semFrasesProibidas("Pode testar. Ninguém te cobra nada.", 30)).toBe(
      "Pode testar. O teste é 30 dias grátis, sem cartão e sem fidelidade.",
    );
    expect(semFrasesProibidas("Link enviado. Depois te ligo pra mostrar.", 30)).toBe("Link enviado.");
  });
});

describe("generalização sobre o mercado — QA 28/09, quinta revisão", () => {
  it("sai, em qualquer redação", () => {
    expect(
      semFrasesProibidas("Faz sentido, planilha é o que a maioria usa até descobrir o celular. Qual prefere?", 30),
    ).toBe("Qual prefere?");
    expect(semFrasesProibidas("Planilha é o que a gente mais vê por aí. Quantos caminhões rodam?", 30)).toBe(
      "Quantos caminhões rodam?",
    );
    expect(semFrasesProibidas("Justo, desconfiança com app novo é normal. Pode testar.", 30)).toBe("Pode testar.");
  });
});

describe("tempo de empresa e quem usa — QA sexta revisão", () => {
  it("sai", () => {
    expect(
      semFrasesProibidas(
        "Entendo o cuidado. A Movatruck tá no site há anos, com transportadoras de granel usando todo dia: https://www.movatruck.com.br",
        30,
      ),
    ).toBe("Entendo o cuidado.");
  });
});
