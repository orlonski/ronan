import { describe, expect, it } from "vitest";
import { escolherTomador, type ObraFiscal, type PagadorFiscal } from "./tomador";
import type { Participante } from "./montar";

const endereco = {
  logradouro: "Rua A",
  numeroEndereco: "10",
  bairro: "Centro",
  codigoMunicipioIbge: "4106902",
  municipio: "Curitiba",
  cep: "80000000",
  uf: "PR",
};

const participante = (cnpj: string): Participante => ({
  cnpjCpf: cnpj,
  razaoSocial: "Local",
  inscricaoEstadual: null,
  indicadorIe: "9",
  endereco: {
    logradouro: "x",
    numero: "1",
    bairro: "x",
    codigoMunicipio: "4106902",
    municipio: "Curitiba",
    cep: null,
    uf: "PR",
  },
});

const PEDREIRA = "11111111000111";
const OBRA_LOCAL = "22222222000122";
const CONSTRUTORA = "33333333000133";
const SPE = "44444444000144";

const remetente = participante(PEDREIRA);
const destinatario = participante(OBRA_LOCAL);

const pagador = (p: Partial<PagadorFiscal> = {}): PagadorFiscal => ({
  nome: "Castilho",
  cnpj: CONSTRUTORA,
  razaoSocial: "Castilho Engenharia Ltda",
  inscricaoEstadual: "9012345678",
  indicadorIe: "1",
  email: "fiscal@castilho.com.br",
  ...endereco,
  ...p,
});

const obra = (p: Partial<ObraFiscal> = {}): ObraFiscal => ({
  nome: "CASTILHO",
  cnpjCpf: null,
  razaoSocialFiscal: null,
  inscricaoEstadual: null,
  indicadorIe: null,
  telefone: null,
  email: null,
  ...endereco,
  logradouro: null,
  numeroEndereco: null,
  bairro: null,
  codigoMunicipioIbge: null,
  municipio: null,
  cep: null,
  uf: null,
  ...p,
});

describe("tomador do CT-e = quem paga", () => {
  it("obra sem CNPJ: o tomador é o cliente que paga, com o cadastro fiscal dele", () => {
    const r = escolherTomador({ obra: obra(), pagador: pagador(), remetente, destinatario });
    expect(r.origem).toBe("CLIENTE");
    expect(r.papelTomador).toBe("OUTRO");
    expect(r.tomadorOutro).toMatchObject({
      cnpjCpf: CONSTRUTORA,
      razaoSocial: "Castilho Engenharia Ltda",
      inscricaoEstadual: "9012345678",
      indicadorIe: "1",
      endereco: { codigoMunicipio: "4106902", uf: "PR", numero: "10" },
      email: "fiscal@castilho.com.br",
    });
  });

  it("obra com CNPJ próprio (SPE, filial, consórcio) vence o cliente", () => {
    const r = escolherTomador({
      obra: obra({ cnpjCpf: SPE, razaoSocialFiscal: "SPE Duplicação BR-277" }),
      pagador: pagador(),
      remetente,
      destinatario,
    });
    expect(r.origem).toBe("OBRA");
    expect(r.tomadorOutro?.cnpjCpf).toBe(SPE);
    expect(r.tomadorOutro?.razaoSocial).toBe("SPE Duplicação BR-277");
  });

  it("ninguém com CNPJ: cai no destinatário, como era antes", () => {
    const r = escolherTomador({
      obra: obra(),
      pagador: pagador({ cnpj: null }),
      remetente,
      destinatario,
    });
    expect(r).toEqual({ papelTomador: "DESTINATARIO", tomadorOutro: null, origem: "DESTINATARIO" });
  });

  it("viagem sem obra também cai no destinatário", () => {
    const r = escolherTomador({ obra: null, pagador: null, remetente, destinatario });
    expect(r.papelTomador).toBe("DESTINATARIO");
  });

  it("cliente que paga é o próprio destinatário: toma3 destinatário, sem bloco de outros", () => {
    const r = escolherTomador({
      obra: obra(),
      pagador: pagador({ cnpj: OBRA_LOCAL }),
      remetente,
      destinatario,
    });
    expect(r).toEqual({ papelTomador: "DESTINATARIO", tomadorOutro: null, origem: "CLIENTE" });
  });

  it("cliente que paga é a pedreira (frete CIF): toma3 remetente", () => {
    const r = escolherTomador({
      obra: obra(),
      pagador: pagador({ cnpj: PEDREIRA }),
      remetente,
      destinatario,
    });
    expect(r.papelTomador).toBe("REMETENTE");
    expect(r.tomadorOutro).toBeNull();
  });

  it("sem razão social usa o nome; sem indicador de IE vai como não contribuinte", () => {
    const r = escolherTomador({
      obra: obra(),
      pagador: pagador({ razaoSocial: "  ", indicadorIe: null, cnpj: "33.333.333/0001-33" }),
      remetente,
      destinatario,
    });
    expect(r.tomadorOutro?.razaoSocial).toBe("Castilho");
    expect(r.tomadorOutro?.indicadorIe).toBe("9");
    expect(r.tomadorOutro?.cnpjCpf).toBe(CONSTRUTORA);
  });
});
