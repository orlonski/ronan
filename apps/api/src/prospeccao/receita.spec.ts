import { describe, expect, it } from "vitest";
import {
  ehCnaeDeGranel,
  ehCnaeDeTransporteDeCarga,
  emailValido,
  extrair,
  socioPrincipal,
  telefoneValido,
} from "./receita";

describe("telefoneValido", () => {
  it("aceita fixo e celular", () => {
    expect(telefoneValido("4335353078")).toBe("4335353078");
    expect(telefoneValido("42988776655")).toBe("42988776655");
  });

  it("recusa o preenchimento de zeros que a Receita usa como vazio", () => {
    expect(telefoneValido("000000000000")).toBeNull();
    expect(telefoneValido("0000000000")).toBeNull();
    expect(telefoneValido("99999999999")).toBeNull();
  });

  it("recusa o que não tem tamanho de telefone", () => {
    expect(telefoneValido("123")).toBeNull();
    expect(telefoneValido("")).toBeNull();
    expect(telefoneValido(null)).toBeNull();
    expect(telefoneValido("4335353078999")).toBeNull();
  });
});

describe("emailValido", () => {
  it("normaliza pra minúsculas", () => {
    expect(emailValido("  Contato@Empresa.COM.BR ")).toBe("contato@empresa.com.br");
  });

  it("recusa o que não é e-mail", () => {
    expect(emailValido("sem-arroba")).toBeNull();
    expect(emailValido(null)).toBeNull();
  });
});

describe("socioPrincipal", () => {
  it("prefere o administrador, que é quem decide", () => {
    const qsa = [
      { nome_socio: "MARIA SOUZA", qualificacao_socio: "Sócio" },
      { nome_socio: "JOAO LIMA", qualificacao_socio: "Sócio-Administrador" },
    ];
    expect(socioPrincipal(qsa)).toBe("JOAO LIMA");
  });

  it("cai no primeiro quando ninguém é administrador", () => {
    expect(socioPrincipal([{ nome_socio: "ARLETE MARTINS LABRES" }])).toBe(
      "ARLETE MARTINS LABRES",
    );
  });

  it("devolve null sem sócio", () => {
    expect(socioPrincipal([])).toBeNull();
    expect(socioPrincipal(null)).toBeNull();
    expect(socioPrincipal([{ nome_socio: "  " }])).toBeNull();
  });
});

describe("extrair — resposta real da BrasilAPI", () => {
  const real = {
    razao_social: "AML BRITAGEM E TRANSPORTES LTDA",
    nome_fantasia: "NOVO TEMPO",
    ddd_telefone_1: "4335353078",
    ddd_telefone_2: "000000000000",
    email: null,
    cnae_fiscal: 4930202,
    cnae_fiscal_descricao: "Transporte rodoviário de carga…",
    porte: "MICRO EMPRESA",
    capital_social: 200000,
    descricao_situacao_cadastral: "ATIVA",
    qsa: [{ nome_socio: "ARLETE MARTINS LABRES", qualificacao_socio: "Administrador" }],
  };

  it("pega o telefone bom e ignora a fileira de zeros do segundo", () => {
    const d = extrair(real);
    expect(d.telefone).toBe("4335353078");
    expect(d.nomeFantasia).toBe("NOVO TEMPO");
    expect(d.cnae).toBe("4930202");
    expect(d.capitalSocial).toBe(200000);
    expect(d.socio).toBe("ARLETE MARTINS LABRES");
  });

  it("usa o segundo telefone quando o primeiro é lixo", () => {
    const d = extrair({ ...real, ddd_telefone_1: "000000000000", ddd_telefone_2: "4199887766" });
    expect(d.telefone).toBe("4199887766");
  });

  it("não quebra com resposta vazia", () => {
    const d = extrair({});
    expect(d.telefone).toBeNull();
    expect(d.socio).toBeNull();
    expect(d.capitalSocial).toBeNull();
  });
});

describe("CNAE — a confirmação que a razão social não dá", () => {
  it("reconhece o grupo 4930 como transporte de carga", () => {
    expect(ehCnaeDeTransporteDeCarga("4930202")).toBe(true);
    expect(ehCnaeDeTransporteDeCarga("4930-2/01")).toBe(true);
    expect(ehCnaeDeTransporteDeCarga("4713004")).toBe(false); // comércio varejista
    expect(ehCnaeDeTransporteDeCarga(null)).toBe(false);
  });

  it("reconhece os ramos de granel que o produto atende", () => {
    expect(ehCnaeDeGranel("0810099")).toBe(true); // extração de pedra e areia
    expect(ehCnaeDeGranel("4312600")).toBe(true); // terraplenagem
    expect(ehCnaeDeGranel("2330301")).toBe(true); // artefatos de concreto
    expect(ehCnaeDeGranel("4930202")).toBe(false); // é transporte, não granel
  });
});
