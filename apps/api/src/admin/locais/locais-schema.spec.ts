import { describe, expect, it } from "vitest";
import { AtualizarLocalInput, CriarLocalInput } from "@ronan/shared-types";

/**
 * O contrato do corpo da requisição.
 *
 * Existe por causa de um defeito que não dava erro nenhum: o Zod DESCARTA chave
 * não declarada em silêncio, então um campo que o painel manda e o schema não
 * conhece simplesmente some entre a rede e o banco. Foi o que aconteceu com o
 * `ativo` do local — o botão de ativar/desativar chamava a API, recebia 200, e
 * nada mudava. Nenhum log, nenhuma exceção, nenhum jeito de perceber olhando.
 *
 * Testar o schema é a única barreira barata contra essa classe de erro.
 */

const base = {
  nome: "Pedreira Norte",
  logradouro: "Rodovia do Café",
  cidade: "Ponta Grossa",
  uf: "PR",
  tipo: "CARGA" as const,
};

describe("corpo do cadastro de local", () => {
  it("a edição aceita ativo — o botão da lista depende disso", () => {
    const r = AtualizarLocalInput.safeParse({ ativo: false });
    expect(r.success).toBe(true);
    expect(r.success && r.data.ativo).toBe(false);
  });

  it("os campos fiscais chegam inteiros ao banco", () => {
    // Eles existiam como coluna e não eram aceitos aqui: o CT-e lia null de um
    // campo que o usuário achava que tinha preenchido.
    const r = CriarLocalInput.safeParse({
      ...base,
      cnpjCpf: "34238864000168",
      razaoSocialFiscal: "Mineração Santa Rita Ltda",
      inscricaoEstadual: "9012345678",
      indicadorIe: "1",
      codigoMunicipioIbge: "4119905",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.cnpjCpf).toBe("34238864000168");
    expect(r.success && r.data.codigoMunicipioIbge).toBe("4119905");
  });

  it("CNPJ com dígito errado não entra", () => {
    const r = CriarLocalInput.safeParse({ ...base, cnpjCpf: "34238864000169" });
    expect(r.success).toBe(false);
  });

  it("contribuinte sem inscrição estadual é barrado no cadastro, não na SEFAZ", () => {
    const r = CriarLocalInput.safeParse({ ...base, indicadorIe: "1" });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.path).toEqual(["inscricaoEstadual"]);
  });

  it("não contribuinte COM inscrição estadual também é contradição", () => {
    const r = CriarLocalInput.safeParse({
      ...base,
      indicadorIe: "9",
      inscricaoEstadual: "9012345678",
    });
    expect(r.success).toBe(false);
  });

  it("código IBGE de outro estado é recusado com o motivo", () => {
    // O erro clássico da importação de planilha: sete dígitos válidos, estado
    // errado. Passa por qualquer validação de formato.
    const r = CriarLocalInput.safeParse({ ...base, uf: "PR", codigoMunicipioIbge: "4314902" });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0]?.message).toContain("não é de PR");
  });

  it("local sem nada de fiscal continua válido", () => {
    // A maioria dos locais nunca entra num documento. Exigir CNPJ de todos
    // travaria o cadastro do dia a dia por causa de um uso que talvez nunca
    // aconteça.
    expect(CriarLocalInput.safeParse(base).success).toBe(true);
  });
});
