import { describe, expect, it } from "vitest";
import { montarCte, type EntradaCte, type Participante } from "./montar";
import { gerarXmlCte } from "./xml";
import { validarContraXsd } from "./xsd";

/**
 * O teste que fecha o ciclo: o documento que este sistema produz é validado
 * contra os schemas OFICIAIS da SEFAZ, não contra a minha opinião sobre eles.
 *
 * É o que transforma "o payload me parece certo" em "o leiaute está certo", e
 * o que faz nota técnica futura aparecer como erro apontando o campo — em vez
 * de rejeição em produção com um código pra alguém ir procurar.
 */

const EMITIDO = new Date("2026-09-13T18:30:00.000Z");

const endereco = {
  logradouro: "Rodovia do Cafe",
  numero: "1200",
  bairro: "Uvaranas",
  codigoMunicipio: "4119905",
  municipio: "Ponta Grossa",
  cep: "84035000",
  uf: "PR",
};

function participante(over: Partial<Participante> = {}): Participante {
  return {
    cnpjCpf: "11222333000181",
    razaoSocial: "PEDREIRA NORTE LTDA",
    inscricaoEstadual: "9012345678",
    indicadorIe: "1",
    endereco,
    ...over,
  };
}

function entrada(over: Partial<EntradaCte> = {}): EntradaCte {
  return {
    emitente: {
      ...participante({ cnpjCpf: "34238864000168", razaoSocial: "TRANSPORTES AURORA LTDA" }),
      crt: "3",
      rntrc: "12345678",
    },
    remetente: participante(),
    destinatario: participante({
      cnpjCpf: "45997418000153",
      razaoSocial: "CONSTRUTORA OBRA CENTRO LTDA",
      inscricaoEstadual: "9087654321",
    }),
    papelTomador: "DESTINATARIO",
    inicioPrestacao: { codigo: "4119905", nome: "Ponta Grossa", uf: "PR" },
    fimPrestacao: { codigo: "4106902", nome: "Curitiba", uf: "PR" },
    carga: {
      produtoPredominante: "BRITA 1",
      toneladas: 28.5,
      valorCarga: 2100,
      chaveNfe: null,
      documentoAvulso: "TK-88213",
    },
    valores: { valorFrete: 1200, valorPedagio: 75 },
    config: {
      naturezaCfop: "353",
      naturezaOperacao: "PRESTACAO DE SERVICO DE TRANSPORTE",
      serie: 1,
      icms: { tipo: "00", aliquota: 12 },
    },
    numero: 1042,
    emitidoEm: EMITIDO,
    ambiente: 2,
    codigoNumerico: 87654321,
    ...over,
  };
}

async function validar(e: EntradaCte) {
  return validarContraXsd(gerarXmlCte(montarCte(e)));
}

describe("o XML passa no XSD oficial do CT-e 4.00", () => {
  it("caso completo: regime normal, tomador destinatário, sem NF-e", async () => {
    const r = await validar(entrada());
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("Simples Nacional (ICMSSN)", async () => {
    const r = await validar(
      entrada({
        emitente: { ...entrada().emitente, crt: "1" },
        config: { ...entrada().config, icms: { tipo: "SN" } },
      }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });

  it("com redução de base (ICMS20)", async () => {
    const r = await validar(
      entrada({ config: { ...entrada().config, icms: { tipo: "20", aliquota: 12, reducaoBase: 20 } } }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });

  it("isento (ICMS45)", async () => {
    const r = await validar(
      entrada({ config: { ...entrada().config, icms: { tipo: "45", cst: "41" } } }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });

  it("com a chave da NF-e amarrada", async () => {
    const r = await validar(
      entrada({
        carga: {
          ...entrada().carga,
          chaveNfe: "41260911222333000181550010000012341000012347",
        },
      }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });

  it("destinatário pessoa física, não contribuinte", async () => {
    const r = await validar(
      entrada({
        destinatario: participante({
          cnpjCpf: "11144477735",
          razaoSocial: "JOAO DA SILVA",
          indicadorIe: "9",
          inscricaoEstadual: null,
        }),
      }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });

  it("tomador é um terceiro (toma4)", async () => {
    const r = await validar(
      entrada({
        papelTomador: "OUTRO",
        tomadorOutro: participante({
          cnpjCpf: "45997418000153",
          razaoSocial: "AGENCIADORA DE FRETES ME",
        }),
      }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });

  it("prestação interestadual", async () => {
    const r = await validar(
      entrada({ fimPrestacao: { codigo: "3550308", nome: "Sao Paulo", uf: "SP" } }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });

  it("com responsável técnico", async () => {
    const r = await validar(
      entrada({
        responsavelTecnico: {
          cnpj: "45997418000153",
          contato: "Diego Orlonski",
          email: "suporte@movatruck.com.br",
          telefone: "42999998888",
        },
      }),
    );
    expect(r.erros.map((x) => x.mensagem)).toEqual([]);
  });
});

describe("o XSD pega o que regra escrita à mão não pega", () => {
  it("razão social acima do tamanho máximo é barrada", async () => {
    // 60 é o teto do xNome. Nenhuma regra nossa confere tamanho campo a campo —
    // e manter uma seria escrever um segundo schema à mão.
    const r = await validar(
      entrada({ destinatario: participante({ razaoSocial: "X".repeat(61) }) }),
    );
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.mensagem.includes("xNome"))).toBe(true);
  });

  it("o Id do documento é CTe + a chave, e ela se destrincha", async () => {
    const xml = gerarXmlCte(montarCte(entrada()));
    const chave = xml.match(/Id="CTe(\d{44})"/)?.[1];
    expect(chave).toBeDefined();
    // 41 PR · 2609 set/26 · CNPJ · 57 · série 001 · nº 000001042 · tpEmis 1 · cCT
    expect(chave!.slice(0, 2)).toBe("41");
    expect(chave!.slice(2, 6)).toBe("2609");
    expect(chave!.slice(6, 20)).toBe("34238864000168");
    expect(chave!.slice(20, 22)).toBe("57");
    expect(chave!.slice(22, 25)).toBe("001");
    expect(chave!.slice(25, 34)).toBe("000001042");
  });

  it("a conferência diz em voz alta que a assinatura não foi verificada", async () => {
    // "XSD ok" num documento sem assinatura não é "pronto pra SEFAZ".
    const r = await validarContraXsd(gerarXmlCte(montarCte(entrada())));
    expect(r.ok).toBe(true);
    expect(r.assinaturaVerificada).toBe(false);
  });

  it("o modal rodoviário é conferido à parte — o schema principal o pula", async () => {
    // `infModal` é xs:any processContents="skip": o conteúdo NÃO é validado ali.
    const xml = gerarXmlCte(montarCte(entrada())).replace(
      "<RNTRC>12345678</RNTRC>",
      "<RNTRC>123</RNTRC>",
    );
    const r = await validarContraXsd(xml);
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.mensagem.includes("modal rodoviário"))).toBe(true);
  });

  it("não sai tag vazia pra campo opcional ausente", async () => {
    // Tag vazia em campo opcional é rejeição, não omissão.
    const xml = gerarXmlCte(montarCte(entrada()));
    expect(xml).not.toMatch(/<\w+\/>/);
    expect(xml).not.toMatch(/<(\w+)><\/\1>/);
  });

  it("o XML não tem espaço entre as tags", async () => {
    // A assinatura cobre os bytes: espaço entre tags entra no que foi assinado.
    const xml = gerarXmlCte(montarCte(entrada()));
    expect(xml).not.toMatch(/>\s+</);
  });
});
