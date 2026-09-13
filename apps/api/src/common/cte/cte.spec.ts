import { describe, expect, it } from "vitest";
import { lerChaveFiscal } from "../chave-fiscal";
import { gerarChaveCte, sortearCodigoNumerico } from "./chave";
import { montarCfop, montarCte, quemEhOTomador, type EntradaCte, type Participante } from "./montar";
import { validarCte } from "./validar";

const EMITIDO = new Date("2026-09-13T18:30:00.000Z"); // 15:30 em Brasília

function endereco(over: Partial<Participante["endereco"]> = {}) {
  return {
    logradouro: "Rodovia do Café",
    numero: "1200",
    bairro: "Uvaranas",
    codigoMunicipio: "4119905", // Ponta Grossa/PR
    municipio: "Ponta Grossa",
    cep: "84035-000",
    uf: "PR",
    ...over,
  };
}

function participante(over: Partial<Participante> = {}): Participante {
  return {
    cnpjCpf: "11222333000181",
    razaoSocial: "Pedreira Norte Ltda",
    inscricaoEstadual: "9012345678",
    indicadorIe: "1",
    endereco: endereco(),
    ...over,
  };
}

function entrada(over: Partial<EntradaCte> = {}): EntradaCte {
  return {
    emitente: {
      ...participante({ cnpjCpf: "34238864000168", razaoSocial: "Transportes Schaba Ltda" }),
      crt: "3",
      rntrc: "12345678",
    },
    remetente: participante(),
    destinatario: participante({
      cnpjCpf: "45997418000153",
      razaoSocial: "Construtora Obra Centro Ltda",
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

describe("gerarChaveCte", () => {
  it("monta os 44 dígitos e o DV fecha na leitura", () => {
    // A prova de ida e volta: quem gera e quem lê a chave têm que concordar,
    // senão o sistema aceita a própria chave como inválida na tela seguinte.
    const { chave } = gerarChaveCte({
      ufEmitente: "PR",
      cnpjEmitente: "34238864000168",
      emitidoEm: EMITIDO,
      serie: 1,
      numero: 1042,
      codigoNumerico: 87654321,
    });
    expect(chave).toHaveLength(44);
    const lida = lerChaveFiscal(chave, "57");
    expect(lida.ok).toBe(true);
    if (lida.ok) {
      expect(lida.dados.uf).toBe("PR");
      expect(lida.dados.cnpjEmitente).toBe("34238864000168");
      expect(lida.dados.numero).toBe("000001042");
      expect(lida.dados.serie).toBe("001");
      expect(lida.dados.competencia).toBe("2609");
    }
  });

  it("a competência é o mês em Brasília, não o do servidor", () => {
    // 1º de outubro às 00:30 UTC ainda é 30 de setembro no Brasil. Usar o mês
    // do container mandaria a chave pra uma competência que não começou.
    const { chave } = gerarChaveCte({
      ufEmitente: "PR",
      cnpjEmitente: "34238864000168",
      emitidoEm: new Date("2026-10-01T00:30:00.000Z"),
      serie: 1,
      numero: 1,
      codigoNumerico: 1,
    });
    expect(chave.slice(2, 6)).toBe("2609");
  });

  it("recusa UF que não existe", () => {
    expect(() =>
      gerarChaveCte({
        ufEmitente: "XX",
        cnpjEmitente: "34238864000168",
        emitidoEm: EMITIDO,
        serie: 1,
        numero: 1,
      }),
    ).toThrow(/UF do emitente/);
  });

  it("recusa número fora da faixa", () => {
    expect(() =>
      gerarChaveCte({
        ufEmitente: "PR",
        cnpjEmitente: "34238864000168",
        emitidoEm: EMITIDO,
        serie: 1,
        numero: 0,
      }),
    ).toThrow(/fora da faixa/);
  });
});

describe("sortearCodigoNumerico", () => {
  it("nunca devolve o próprio número do CT-e", () => {
    // A SEFAZ rejeita código numérico igual ao número do documento.
    const sorteioViciado = () => 1042 / 100_000_000;
    expect(Number(sortearCodigoNumerico(1042, sorteioViciado))).not.toBe(1042);
  });

  it("sempre sai com 8 dígitos", () => {
    expect(sortearCodigoNumerico(7, () => 0.00000042)).toHaveLength(8);
  });
});

describe("montarCfop", () => {
  it("mesma UF nas duas pontas é 5", () => {
    expect(montarCfop("353", "PR", "PR")).toBe("5353");
  });

  it("UFs diferentes é 6", () => {
    expect(montarCfop("353", "PR", "SP")).toBe("6353");
  });

  it("quem manda é a prestação, não a sede do emitente", () => {
    // Transportadora do PR levando de SP pra SP faz prestação INTERNA. Olhar a
    // UF do emitente daria 6353 e a SEFAZ rejeitaria.
    expect(montarCfop("353", "SP", "SP")).toBe("5353");
  });
});

describe("montarCte", () => {
  it("os componentes somam o total da prestação", () => {
    // Rejeição clássica: vTPrest que não bate com a soma dos Comp. Aqui o total
    // SAI da soma, então não há como divergir.
    const cte = montarCte(entrada({ valores: { valorFrete: 1200, valorPedagio: 75 } }));
    expect(cte.vPrest.vTPrest).toBe("1275.00");
    expect(cte.vPrest.Comp).toEqual([
      { xNome: "FRETE VALOR", vComp: "1200.00" },
      { xNome: "PEDAGIO", vComp: "75.00" },
    ]);
  });

  it("extras entram como componente e no total", () => {
    const cte = montarCte(
      entrada({
        valores: { valorFrete: 1000, valorPedagio: null, extras: [{ nome: "ESTADIA", valor: 160 }] },
      }),
    );
    expect(cte.vPrest.vTPrest).toBe("1160.00");
  });

  it("Simples Nacional não destaca ICMS", () => {
    const cte = montarCte(
      entrada({
        emitente: { ...entrada().emitente, crt: "1" },
        config: { ...entrada().config, icms: { tipo: "SN" } },
      }),
    );
    expect(cte.imp).toEqual({ ICMS: { ICMSSN: { CST: "90", indSN: 1 } } });
  });

  it("regime normal calcula o ICMS sobre o total", () => {
    const cte = montarCte(entrada()); // 1275,00 a 12%
    expect(cte.imp).toEqual({
      ICMS: { ICMS00: { CST: "00", vBC: "1275.00", pICMS: "12.00", vICMS: "153.00" } },
    });
  });

  it("redução de base reduz a base E o imposto", () => {
    const cte = montarCte(
      entrada({ config: { ...entrada().config, icms: { tipo: "20", aliquota: 12, reducaoBase: 20 } } }),
    );
    // 1275 − 20% = 1020; 12% de 1020 = 122,40
    expect(cte.imp).toEqual({
      ICMS: {
        ICMS20: { CST: "20", pRedBC: "20.00", vBC: "1020.00", pICMS: "12.00", vICMS: "122.40" },
      },
    });
  });

  it("contribuinte isento vai com IE literal ISENTO", () => {
    // Mandar o número de uma IE que não existe é rejeição na hora.
    const cte = montarCte(
      entrada({
        destinatario: participante({ indicadorIe: "2", inscricaoEstadual: "123456" }),
      }),
    );
    expect((cte.dest as Record<string, unknown>).IE).toBe("ISENTO");
  });

  it("pessoa física entra como CPF, não CNPJ", () => {
    const cte = montarCte(
      entrada({
        destinatario: participante({
          cnpjCpf: "111.444.777-35",
          indicadorIe: "9",
          inscricaoEstadual: null,
        }),
      }),
    );
    expect(cte.dest).toMatchObject({ CPF: "11144477735" });
    expect(cte.dest).not.toHaveProperty("CNPJ");
  });

  it("sem NF-e a carga entra como documento avulso, não some", () => {
    const cte = montarCte(entrada({ carga: { ...entrada().carga, documentoAvulso: "TK-88213" } }));
    const infDoc = (cte.infCTeNorm as Record<string, any>).infDoc;
    expect(infDoc.infOutros[0]).toMatchObject({ tpDoc: "99", nDoc: "TK-88213" });
  });

  it("com NF-e a carga aponta pra chave dela", () => {
    const cte = montarCte(
      entrada({
        carga: { ...entrada().carga, chaveNfe: "41260911222333000181550010000012341000012347" },
      }),
    );
    const infDoc = (cte.infCTeNorm as Record<string, any>).infDoc;
    expect(infDoc.infNFe[0].chave).toBe("41260911222333000181550010000012341000012347");
  });

  it("tomador destinatário vira toma3 com código 3", () => {
    const cte = montarCte(entrada());
    expect((cte.ide as any).toma3).toEqual({ toma: 3 });
    expect((cte.ide as any).indIEToma).toBe("1");
  });

  it("tomador 'outro' vira toma4 com os dados dele", () => {
    const cte = montarCte(
      entrada({
        papelTomador: "OUTRO",
        tomadorOutro: participante({ razaoSocial: "Agenciadora Fretes ME" }),
      }),
    );
    expect((cte.ide as any).toma4.toma).toBe(4);
    expect((cte.ide as any).toma4.xNome).toBe("Agenciadora Fretes ME");
  });

  it("a quantidade da carga sai em tonelada", () => {
    const cte = montarCte(entrada());
    expect((cte.infCTeNorm as any).infCarga.infQ[0]).toEqual({
      cUnid: "02",
      tpMed: "PESO BRUTO",
      qCarga: "28.5000",
    });
  });

  it("o responsável técnico é a DESENVOLVEDORA, não a transportadora", () => {
    // É o único lugar da software house no documento: emitente é quem presta o
    // serviço de transporte, e ela não tem RNTRC nem inscrição estadual.
    const cte = montarCte(
      entrada({
        responsavelTecnico: {
          cnpj: "45997418000153",
          contato: "Diego Orlonski",
          email: "suporte@movatruck.com.br",
          telefone: "(42) 99999-8888",
        },
      }),
    );
    expect(cte.infRespTec).toEqual({
      CNPJ: "45997418000153",
      xContato: "Diego Orlonski",
      email: "suporte@movatruck.com.br",
      fone: "42999998888",
    });
    // E não se confunde com o emitente.
    expect((cte.emit as any).CNPJ).toBe("34238864000168");
  });

  it("sem responsável técnico o grupo simplesmente não vai", () => {
    expect(montarCte(entrada()).infRespTec).toBeUndefined();
  });

  it("o RNTRC entra no modal rodoviário", () => {
    const cte = montarCte(entrada());
    expect((cte.infCTeNorm as any).infModal.rodo.RNTRC).toBe("12345678");
  });

  it("a data de emissão sai com o fuso de Brasília", () => {
    const cte = montarCte(entrada());
    expect((cte.ide as any).dhEmi).toBe("2026-09-13T15:30:00-03:00");
  });
});

describe("quemEhOTomador", () => {
  it("acha o participante pelo papel", () => {
    expect(quemEhOTomador(entrada({ papelTomador: "REMETENTE" })).razaoSocial).toBe(
      "Pedreira Norte Ltda",
    );
  });

  it("papel sem participante informado é erro explícito", () => {
    expect(() => quemEhOTomador(entrada({ papelTomador: "EXPEDIDOR" }))).toThrow(/expedidor/);
  });
});

describe("validarCte", () => {
  it("o caminho feliz passa", () => {
    const r = validarCte(entrada());
    expect(r.erros).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("código IBGE de outro estado é pego aqui, não pela SEFAZ", () => {
    // O erro clássico da importação de planilha. A SEFAZ devolve "código de
    // município inválido" sem dizer qual dos quatro.
    const r = validarCte(
      entrada({ fimPrestacao: { codigo: "3550308", nome: "São Paulo", uf: "PR" } }),
    );
    expect(r.ok).toBe(false);
    expect(r.erros.some((e) => e.mensagem.includes("não é de PR"))).toBe(true);
  });

  it("sem RNTRC não emite", () => {
    const r = validarCte(entrada({ emitente: { ...entrada().emitente, rntrc: "" } }));
    expect(r.erros.some((e) => e.campo === "rntrc")).toBe(true);
  });

  it("Simples Nacional destacando ICMS é barrado", () => {
    // O tomador creditaria um imposto que não foi recolhido.
    const r = validarCte(
      entrada({
        emitente: { ...entrada().emitente, crt: "1" },
        config: { ...entrada().config, icms: { tipo: "00", aliquota: 12 } },
      }),
    );
    expect(r.erros.some((e) => e.campo === "icms")).toBe(true);
  });

  it("regime normal com regra do Simples também é barrado", () => {
    const r = validarCte(entrada({ config: { ...entrada().config, icms: { tipo: "SN" } } }));
    expect(r.erros.some((e) => e.campo === "icms")).toBe(true);
  });

  it("contribuinte sem inscrição estadual é rejeição", () => {
    const r = validarCte(
      entrada({ destinatario: participante({ indicadorIe: "1", inscricaoEstadual: null }) }),
    );
    expect(r.erros.some((e) => e.mensagem.includes("inscrição estadual"))).toBe(true);
  });

  it("não contribuinte com inscrição estadual também é", () => {
    const r = validarCte(
      entrada({ destinatario: participante({ indicadorIe: "9", inscricaoEstadual: "9012345678" }) }),
    );
    expect(r.erros.some((e) => e.mensagem.includes("NÃO contribuinte"))).toBe(true);
  });

  it("CNPJ com dígito errado não passa", () => {
    const r = validarCte(entrada({ remetente: participante({ cnpjCpf: "11222333000100" }) }));
    expect(r.erros.some((e) => e.mensagem.includes("CNPJ do remetente"))).toBe(true);
  });

  it("viagem sem valor não vira CT-e", () => {
    const r = validarCte(entrada({ valores: { valorFrete: 0 } }));
    expect(r.erros.some((e) => e.campo === "valor")).toBe(true);
  });

  it("viagem sem peso não vira CT-e", () => {
    const r = validarCte(entrada({ carga: { ...entrada().carga, toneladas: 0 } }));
    expect(r.erros.some((e) => e.campo === "carga")).toBe(true);
  });

  it("responsável técnico ausente é aviso, não trava a emissão", () => {
    // A obrigatoriedade do grupo varia; uma env esquecida não pode impedir uma
    // emissão que o gateway aceitaria.
    const r = validarCte(entrada());
    expect(r.ok).toBe(true);
    expect(r.avisos.some((a) => a.campo === "respTec")).toBe(true);
  });

  it("sem NF-e é AVISO, não erro — o documento é emissível", () => {
    const r = validarCte(entrada());
    expect(r.ok).toBe(true);
    expect(r.avisos.some((a) => a.campo === "nfe")).toBe(true);
  });

  it("data no futuro é erro", () => {
    const r = validarCte(entrada({ emitidoEm: new Date(Date.now() + 60 * 60_000) }));
    expect(r.erros.some((e) => e.campo === "data")).toBe(true);
  });

  it("local de descarga sem município cadastrado diz o que falta", () => {
    const r = validarCte(entrada({ fimPrestacao: { codigo: "", nome: "", uf: "" } }));
    expect(r.erros.some((e) => e.mensagem.includes("local de descarga"))).toBe(true);
  });
});
