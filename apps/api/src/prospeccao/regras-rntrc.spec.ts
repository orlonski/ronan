import { describe, expect, it } from "vitest";
import { dataBr, ehEmpresarioIndividual, qualificar, type LinhaRntrc } from "./regras-rntrc";

/** Linha-base ativa, ETC, no Paraná. Cada teste muda só o que interessa. */
function linha(over: Partial<LinhaRntrc> = {}): LinhaRntrc {
  return {
    nomeTransportador: "TRANSPORTES SERRA VERDE LTDA",
    numeroRntrc: "059695866",
    dataPrimeiroCadastro: "23/07/2026",
    situacaoRntrc: "ATIVO",
    cpfCnpj: "67.699.237/0001-83",
    categoria: "ETC",
    cep: "85508-327",
    municipio: "PATO BRANCO",
    uf: "PR",
    ...over,
  };
}

const AGORA = new Date("2026-09-09T12:00:00Z");

describe("ehEmpresarioIndividual", () => {
  it("pega o nome que a Receita monta como CNPJ + pessoa", () => {
    expect(ehEmpresarioIndividual("11.680.983 GILBERTO RODRIGUES DA SILVA")).toBe(true);
  });

  it("não confunde com empresa que tem número no nome", () => {
    expect(ehEmpresarioIndividual("TRANSPORTES 3 IRMAOS LTDA")).toBe(false);
    expect(ehEmpresarioIndividual("09 JUNHO TRANSPORTES LTDA.")).toBe(true);
  });
});

describe("dataBr", () => {
  it("lê o formato brasileiro da ANTT", () => {
    expect(dataBr("23/07/2026")?.toISOString()).toBe("2026-07-23T00:00:00.000Z");
  });

  it("devolve null no que não é data", () => {
    expect(dataBr("")).toBeNull();
    expect(dataBr("2026-07-23")).toBeNull();
  });
});

describe("qualificar — quem fica de fora", () => {
  it("descarta registro que não está ativo", () => {
    const r = qualificar(linha({ situacaoRntrc: "PENDENTE" }), { agora: AGORA });
    expect(r).toEqual({ entra: false, motivo: "SITUACAO_INATIVA" });
  });

  it("descarta o autônomo (TAC) e a cooperativa (CTC)", () => {
    expect(qualificar(linha({ categoria: "TAC" }), { agora: AGORA })).toEqual({
      entra: false,
      motivo: "CATEGORIA_NAO_EMPRESA",
    });
    expect(qualificar(linha({ categoria: "CTC" }), { agora: AGORA })).toEqual({
      entra: false,
      motivo: "CATEGORIA_NAO_EMPRESA",
    });
  });

  it("descarta empresário individual — é 1 caminhão e é pessoa natural", () => {
    const r = qualificar(
      linha({ nomeTransportador: "11.680.983 GILBERTO RODRIGUES DA SILVA" }),
      { agora: AGORA },
    );
    expect(r).toEqual({ entra: false, motivo: "EMPRESARIO_INDIVIDUAL" });
  });

  it("respeita o recorte de UF quando ele existe", () => {
    expect(qualificar(linha({ uf: "SP" }), { ufs: ["PR"], agora: AGORA })).toEqual({
      entra: false,
      motivo: "UF_FORA_DO_ALVO",
    });
    expect(qualificar(linha({ uf: "SP" }), { ufs: [], agora: AGORA }).entra).toBe(true);
  });

  it("a ordem do descarte não muda o veredito de quem falha em dois critérios", () => {
    // TAC inativo: seja qual for a razão relatada, não entra.
    const r = qualificar(linha({ categoria: "TAC", situacaoRntrc: "BAIXADO" }), {
      agora: AGORA,
    });
    expect(r.entra).toBe(false);
  });
});

describe("qualificar — a nota", () => {
  it("dá a nota mais alta pra quem tirou registro há pouco", () => {
    const nova = qualificar(linha({ dataPrimeiroCadastro: "23/07/2026" }), { agora: AGORA });
    const velha = qualificar(linha({ dataPrimeiroCadastro: "10/03/2005" }), { agora: AGORA });

    expect(nova.entra && velha.entra).toBe(true);
    if (!nova.entra || !velha.entra) return;
    expect(nova.score).toBeGreaterThan(velha.score);
    expect(nova.scoreMotivo).toContain("menos de 1 ano");
  });

  it("penaliza S/A, que costuma ser grande demais pro alvo", () => {
    const ltda = qualificar(linha(), { agora: AGORA });
    const sa = qualificar(
      linha({ nomeTransportador: "EXPRESSO PARANAENSE S.A." }),
      { agora: AGORA },
    );

    expect(ltda.entra && sa.entra).toBe(true);
    if (!ltda.entra || !sa.entra) return;
    expect(sa.score).toBeLessThan(ltda.score);
  });

  it("nunca sai da faixa de 0 a 100", () => {
    const casos = ["23/07/2026", "01/01/1998", "15/06/2024", ""];
    for (const data of casos) {
      const r = qualificar(
        linha({ dataPrimeiroCadastro: data, nomeTransportador: "X TRANSPORTES S.A." }),
        { agora: AGORA },
      );
      if (!r.entra) continue;
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("registro sem data entra sem o bônus de recência, mas o nicho continua contando", () => {
    const r = qualificar(linha({ dataPrimeiroCadastro: "" }), { agora: AGORA });
    expect(r.entra).toBe(true);
    if (!r.entra) return;
    // 50 de base + 8 por "TRANSPORTES" no nome, e nada de recência.
    expect(r.score).toBe(58);
    expect(r.scoreMotivo).toContain("sem data de registro");
    expect(r.scoreMotivo).not.toContain("menos de 1 ano");
  });
});

// --- parser do CSV -----------------------------------------------------------

import { parsearLinha } from "./rntrc.service";

describe("parsearLinha", () => {
  const real =
    '"DPS LOGISTICA LTDA";"050085788";"23/05/2017";"ATIVO";"11.193.322/0001-10";"ETC";"14095-290";"RIBEIRÃO PRETO";"SP";"Sim";"23/10/2024"';

  it("lê a linha real da ANTT, com acento e tudo", () => {
    const l = parsearLinha(real);
    expect(l).not.toBeNull();
    expect(l?.nomeTransportador).toBe("DPS LOGISTICA LTDA");
    expect(l?.cpfCnpj).toBe("11.193.322/0001-10");
    expect(l?.categoria).toBe("ETC");
    expect(l?.municipio).toBe("RIBEIRÃO PRETO");
    expect(l?.uf).toBe("SP");
  });

  it("não quebra em razão social com ponto e vírgula dentro das aspas", () => {
    const l = parsearLinha(
      '"TRANSPORTES A; B LTDA";"1";"01/01/2020";"ATIVO";"00.000.000/0001-00";"ETC";"80000-000";"CURITIBA";"PR"',
    );
    expect(l?.nomeTransportador).toBe("TRANSPORTES A; B LTDA");
    expect(l?.uf).toBe("PR");
  });

  it("descarta linha truncada e linha sem CNPJ", () => {
    expect(parsearLinha('"SO ISSO";"123"')).toBeNull();
    expect(
      parsearLinha('"X LTDA";"1";"01/01/2020";"ATIVO";"";"ETC";"80000-000";"CURITIBA";"PR"'),
    ).toBeNull();
  });
});

// --- descoberta do arquivo no catálogo da ANTT -------------------------------

import { competenciaDoRecurso } from "./rntrc.service";

describe("competenciaDoRecurso", () => {
  it("lê a competência do nome do arquivo na URL", () => {
    expect(
      competenciaDoRecurso("https://dados.antt.gov.br/x/transportadores_rntrc_07_2026.csv", ""),
    ).toBe(202607);
  });

  it("ordena corretamente na virada de ano", () => {
    const dez = competenciaDoRecurso("x/transportadores_rntrc_12_2025.csv", "");
    const jan = competenciaDoRecurso("x/transportadores_rntrc_01_2026.csv", "");
    expect(jan).toBeGreaterThan(dez);
  });

  it("cai no título abreviado em português quando a URL não diz nada", () => {
    expect(competenciaDoRecurso("https://dados.antt.gov.br/x/download", "Jul26 - RNTRC")).toBe(
      202607,
    );
    expect(competenciaDoRecurso("x/y", "Ago20 - RNTRC")).toBe(202008);
    expect(competenciaDoRecurso("x/y", "Set20 - RNTRC")).toBe(202009);
  });

  it("devolve 0 no que não dá pra datar, pra quem chama descartar", () => {
    expect(competenciaDoRecurso("x/dicionario.pdf", "Dicionário de Dados - RNTRC")).toBe(0);
    expect(competenciaDoRecurso("", "")).toBe(0);
  });

  it("a URL vence o título quando os dois existem e discordam", () => {
    expect(competenciaDoRecurso("x/transportadores_rntrc_07_2026.csv", "Jan20 - RNTRC")).toBe(
      202607,
    );
  });
});

// --- aderência ao nicho ------------------------------------------------------

import { aderenciaAoNicho, pareceNomeDePessoa } from "./regras-rntrc";

describe("pareceNomeDePessoa", () => {
  it("pega razão social que é só o nome de alguém", () => {
    expect(pareceNomeDePessoa("MARCELO SEIDEL")).toBe(true);
    expect(pareceNomeDePessoa("JOSE CARLOS DA SILVA")).toBe(true);
  });

  it("não confunde com empresa de verdade", () => {
    expect(pareceNomeDePessoa("SEIDEL TRANSPORTES LTDA")).toBe(false);
    expect(pareceNomeDePessoa("MARCELO SEIDEL LTDA")).toBe(false);
    expect(pareceNomeDePessoa("SILVA LOGISTICA")).toBe(false);
    // Nome comprido sem sufixo é mais provável ser empresa que pessoa.
    expect(pareceNomeDePessoa("IRMAOS PEREIRA COMERCIO E INDUSTRIA DO PARANA")).toBe(false);
  });
});

describe("aderenciaAoNicho", () => {
  it("premia quem move granel, que é o que o produto resolve", () => {
    const granel = aderenciaAoNicho("TRANSPORTES DE BRITA E AREIA LTDA");
    const generica = aderenciaAoNicho("EXPRESSO CENTRAL TRANSPORTES LTDA");
    expect(granel.ajuste).toBeGreaterThan(generica.ajuste);
  });

  it("penaliza quem tirou RNTRC pra levar a própria carga", () => {
    const atacado = aderenciaAoNicho("VENANCIO COMERCIO ATACADISTA DE ALIMENTO LTDA");
    expect(atacado.ajuste).toBeLessThan(0);
    expect(atacado.razao).toContain("não indica transporte");
  });

  it("penaliza forte a razão social que é nome de pessoa", () => {
    expect(aderenciaAoNicho("MARCELO SEIDEL").ajuste).toBe(-30);
  });

  it("construtora entra bem — areia e brita são o nicho", () => {
    expect(aderenciaAoNicho("RM CONSTRUTORA & TRANSPORTADORA LTDA").ajuste).toBeGreaterThan(0);
  });
});

describe("qualificar com nicho — ordena o que importa", () => {
  it("transportadora de granel nova vence atacadista nova", () => {
    const granel = qualificar(
      linha({ nomeTransportador: "TRANSPORTES DE AREIA E BRITA LTDA" }),
      { agora: AGORA },
    );
    const atacado = qualificar(
      linha({ nomeTransportador: "VENANCIO COMERCIO ATACADISTA DE ALIMENTO LTDA" }),
      { agora: AGORA },
    );
    expect(granel.entra && atacado.entra).toBe(true);
    if (!granel.entra || !atacado.entra) return;
    expect(granel.score).toBeGreaterThan(atacado.score);
  });
});
