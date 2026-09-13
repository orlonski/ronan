import { describe, expect, it } from "vitest";
import { ENTIDADE_POR_CHAVE } from "./campos";
import { acharCabecalho, casarColunas, faltandoObrigatorios, normalizar } from "./mapear";
import { lerData, resumirValidacao, validarLinhas } from "./validar";

const CLIENTES = ENTIDADE_POR_CHAVE.get("clientes")!;
const LOCAIS = ENTIDADE_POR_CHAVE.get("locais")!;
const MOTORISTAS = ENTIDADE_POR_CHAVE.get("motoristas")!;
const VEICULOS = ENTIDADE_POR_CHAVE.get("veiculos")!;

describe("acharCabecalho", () => {
  it("pula título, logo e linha em branco", () => {
    // É assim que chega a planilha: título da empresa, vazio, e só então o
    // cabeçalho. Pedir "informe a linha do cabeçalho" faz o usuário desistir.
    const linhas = [
      ["TRANSPORTES XYZ LTDA", null, null],
      [null, null, null],
      ["Relação de locais - 2026", null, null],
      ["Nome", "Endereço", "Município", "UF"],
      ["Pedreira Norte", "Rod. do Café km 12", "Ponta Grossa", "PR"],
    ];
    expect(acharCabecalho(linhas, LOCAIS)).toBe(3);
  });

  it("uma coluna reconhecida só não é cabeçalho", () => {
    // Coincidência (uma célula escrita "nome" no meio dos dados) deslocaria
    // tudo o que vem depois.
    const linhas = [["nome", null, null], ["a", "b", "c"]];
    expect(acharCabecalho(linhas, LOCAIS)).toBe(-1);
  });
});

describe("casarColunas", () => {
  it("reconhece os nomes que a planilha da transportadora usa", () => {
    const mapa = casarColunas(["Nome", "Logradouro", "Município", "UF"], LOCAIS);
    expect(mapa).toEqual({ nome: 0, logradouro: 1, cidade: 2, uf: 3 });
  });

  it("o exato ganha do que só contém a palavra", () => {
    // "CPF" tem que cair no campo cpf, não no "cpf cnpj" de outro campo.
    const mapa = casarColunas(["Nome", "CPF"], MOTORISTAS);
    expect(mapa.cpf).toBe(1);
  });

  it("primeira coluna vence o empate", () => {
    // "Nome" e "Nome Fantasia" na mesma planilha: o principal é o que vem antes.
    const mapa = casarColunas(["Nome", "Nome Fantasia"], CLIENTES);
    expect(mapa.nome).toBe(0);
  });

  it("cobra o obrigatório que não achou", () => {
    const mapa = casarColunas(["Telefone"], MOTORISTAS);
    expect(faltandoObrigatorios(mapa, MOTORISTAS).sort()).toEqual(["cpf", "nome"]);
  });
});

describe("normalizar", () => {
  it("ignora acento, caixa e pontuação", () => {
    expect(normalizar("Razão Social")).toBe(normalizar("RAZAO  social"));
  });
});

describe("validarLinhas", () => {
  const mapa = { nome: 0, cpf: 1, telefone: 2 };

  it("converte e limpa o que entra", () => {
    const r = validarLinhas([["  Jorge Silva ", "111.444.777-35", "42999998888"]], MOTORISTAS, mapa);
    expect(r[0]!.erros).toEqual([]);
    expect(r[0]!.valores).toEqual({
      nome: "Jorge Silva",
      cpf: "11144477735",
      telefone: "42999998888",
    });
  });

  it("CPF inválido vira erro na linha, não cadastro errado", () => {
    const r = validarLinhas([["Jorge", "111.111.111-11", null]], MOTORISTAS, mapa);
    expect(r[0]!.erros[0]!.campo).toBe("cpf");
  });

  it("uma linha ruim não derruba as boas", () => {
    // Recusar o arquivo inteiro por causa de um CPF digitado errado é o que faz
    // a implantação voltar pro e-mail.
    const r = validarLinhas(
      [
        ["Jorge", "111.444.777-35", null],
        ["Maria", "000", null],
        ["Ana", "529.982.247-25", null],
      ],
      MOTORISTAS,
      mapa,
    );
    expect(resumirValidacao(r)).toEqual({
      total: 3,
      prontas: 2,
      comErro: 1,
      duplicadasNoArquivo: 0,
    });
  });

  it("linha em branco é rodapé, não registro vazio", () => {
    const r = validarLinhas([["Jorge", "111.444.777-35", null], [null, null, null]], MOTORISTAS, mapa);
    expect(r).toHaveLength(1);
  });

  it("campo obrigatório em branco é dito por nome", () => {
    const r = validarLinhas([[null, "111.444.777-35", null]], MOTORISTAS, mapa);
    expect(r[0]!.erros[0]!.mensagem).toContain("Nome");
  });

  it("mesma chave duas vezes no arquivo: a primeira vale", () => {
    const r = validarLinhas(
      [
        ["Jorge", "111.444.777-35", "42988887777"],
        ["Jorge S.", "111.444.777-35", "42999996666"],
      ],
      MOTORISTAS,
      mapa,
    );
    expect(r[0]!.duplicadaNoArquivo).toBeUndefined();
    expect(r[1]!.duplicadaNoArquivo).toBe(true);
  });

  it("no campo inteiro, o ponto é milhar: '2.019' é 2019", () => {
    const m = { placa: 0, ano: 1 };
    const r = validarLinhas([["ABC1D23", "2.019"], ["XYZ4E56", "2019"]], VEICULOS, m);
    expect(r[0]!.valores.ano).toBe(2019);
    expect(r[1]!.valores.ano).toBe(2019);
  });

  it("no campo decimal, o ponto é decimal: latitude não vira milhar", () => {
    // Ler "-25.093" como -25093 colocaria a pedreira no meio do oceano.
    const r = validarLinhas([["Pedreira", "-25.093", "-50.161"]], LOCAIS, {
      nome: 0,
      lat: 1,
      lng: 2,
    });
    expect(r[0]!.valores.lat).toBe(-25.093);
    expect(r[0]!.valores.lng).toBe(-50.161);
  });

  it("decimal com vírgula: o ponto volta a ser milhar", () => {
    const r = validarLinhas([["Pedreira", "-25,093", "-1.234,5"]], LOCAIS, {
      nome: 0,
      lat: 1,
      lng: 2,
    });
    expect(r[0]!.valores.lat).toBe(-25.093);
    expect(r[0]!.valores.lng).toBe(-1234.5);
  });

  it("placa aceita com e sem traço, e recusa o que não é placa", () => {
    const m = { placa: 0 };
    const r = validarLinhas([["abc-1d23"], ["CAVALO 1"]], VEICULOS, m);
    expect(r[0]!.valores.placa).toBe("ABC1D23");
    expect(r[1]!.erros[0]!.campo).toBe("placa");
  });

  it("um campo opcional inválido não apaga o resto da linha", () => {
    const r = validarLinhas([["Pedreira Norte", "Rod. do Café", "Ponta Grossa", "Paraná"]], LOCAIS, {
      nome: 0,
      logradouro: 1,
      cidade: 2,
      uf: 3,
    });
    expect(r[0]!.valores.nome).toBe("Pedreira Norte");
    expect(r[0]!.erros[0]!.campo).toBe("uf");
  });
});

describe("lerData", () => {
  it("dd/mm/aaaa é lido como brasileiro", () => {
    // `new Date("03/04/2026")` em JS entende MARÇO — e uma planilha lida assim
    // erra o mês em dois terços das linhas sem nunca falhar.
    expect(lerData("03/04/2026")).toBe("2026-04-03");
  });

  it("aceita ano de dois dígitos", () => {
    expect(lerData("03/04/26")).toBe("2026-04-03");
  });

  it("aceita ISO", () => {
    expect(lerData("2026-04-03")).toBe("2026-04-03");
  });

  it("31 de fevereiro não existe", () => {
    expect(lerData("31/02/2026")).toBeNull();
  });
});
