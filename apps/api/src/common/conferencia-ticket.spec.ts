import { describe, it, expect } from "vitest";
import {
  compararDeclaradoComLido,
  conferirComJulgamento,
  decidirVeredito,
  precisaSegundaOpiniao,
  explicarPesoSuspeito,
  normalizarTicket,
  normalizarPlaca,
  distanciaEdicao,
  LIMIARES_PADRAO,
  type Declarado,
  type Lido,
} from "./conferencia-ticket";

/** Uma viagem que bate em tudo — base pra variar um campo por vez. */
const DECLARADO: Declarado = {
  toneladas: 35.14,
  ticket: "3174",
  placa: "AQF7758",
  data: "2026-08-22",
  clienteNome: "TRIPOLONI",
  materialNome: "PÓ DE PEDRA",
};

const LIDO: Lido = {
  toneladas: 35.14,
  ticket: "3174",
  placa: "AQF7758",
  data: "2026-08-22",
  clienteNome: "TRIPOLONI",
  materialNome: "PÓ DE PEDRA",
  confianca: 0.92,
};

const conferir = (d: Partial<Declarado>, l: Partial<Lido>) =>
  compararDeclaradoComLido({ ...DECLARADO, ...d }, { ...LIDO, ...l });

describe("normalização", () => {
  it("ticket ignora pontuação e zero à esquerda", () => {
    expect(normalizarTicket("000-3174")).toBe("3174");
    expect(normalizarTicket("3174")).toBe("3174");
    expect(normalizarTicket("nº 3.174")).toBe("3174");
  });

  it("zero sozinho não some", () => {
    expect(normalizarTicket("0")).toBe("0");
  });

  it("placa ignora hífen e espaço", () => {
    expect(normalizarPlaca("AQF-7758")).toBe("AQF7758");
    expect(normalizarPlaca("aqf 7758")).toBe("AQF7758");
  });
});

describe("distanciaEdicao", () => {
  it("mede troca, sobra e falta de caractere", () => {
    expect(distanciaEdicao("AGF7758", "AQF7758")).toBe(1);
    expect(distanciaEdicao("3174", "3174")).toBe(0);
    expect(distanciaEdicao("3174", "31745")).toBe(1);
  });

  it("corta cedo quando está muito longe", () => {
    expect(distanciaEdicao("3174", "9999999", 1)).toBeGreaterThan(1);
  });
});

describe("peso — as armadilhas que protegem o motorista", () => {
  it("reconhece leitura do peso bruto no lugar do líquido", () => {
    // Caminhão carregado pesa ~1,5x a carga. O modelo pegou a linha errada.
    expect(explicarPesoSuspeito(32, 48)).toMatch(/bruto/);
  });

  it("reconhece leitura da tara", () => {
    expect(explicarPesoSuspeito(32, 14)).toMatch(/tara/);
  });

  it("reconhece quilo lido como tonelada", () => {
    expect(explicarPesoSuspeito(32, 32000)).toMatch(/quilos/);
  });

  it("diferença real de carga não vira suspeita de unidade", () => {
    expect(explicarPesoSuspeito(32, 30.5)).toBeNull();
  });

  it("peso bruto vira INCERTO, nunca cobrança ao motorista", () => {
    const r = conferir({ toneladas: 32 }, { toneladas: 48 });
    expect(r.divergencias).toHaveLength(0);
    expect(r.incertezas[0].campo).toBe("toneladas");
    expect(r.veredito).toBe("INCERTO");
  });

  it("diferença de peso plausível vira divergência ALTA — é dinheiro", () => {
    const r = conferir({ toneladas: 35.14 }, { toneladas: 30.5 });
    expect(r.divergencias[0]).toMatchObject({ campo: "toneladas", gravidade: "ALTA" });
    expect(r.veredito).toBe("DIVERGE");
  });

  it("arredondamento de balança não vira divergência", () => {
    const r = conferir({ toneladas: 35.14 }, { toneladas: 35.15 });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("viagem sem peso pra conferir não acusa nada", () => {
    // AGUARDANDO_PESO: o romaneio sai no fim do dia. Sem esta guarda, o sistema
    // cobraria TODO motorista que lançou sem peso.
    const r = conferir(
      { toneladas: null, pesoConferivel: false },
      { toneladas: 32 },
    );
    expect(r.conferidos).not.toContain("toneladas");
    expect(r.divergencias).toHaveLength(0);
  });
});

describe("ticket", () => {
  it("mesmo número escrito diferente bate", () => {
    const r = conferir({ ticket: "3174" }, { ticket: "000-3174" });
    expect(r.veredito).toBe("BATE");
  });

  it("um caractere de diferença é leitura ruim, não motorista errado", () => {
    const r = conferir({ ticket: "3174" }, { ticket: "3178" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.incertezas[0].campo).toBe("ticket");
    expect(r.veredito).toBe("INCERTO");
  });

  it("ticket completamente diferente é divergência ALTA", () => {
    const r = conferir({ ticket: "3174" }, { ticket: "9821" });
    expect(r.divergencias[0]).toMatchObject({ campo: "ticket", gravidade: "ALTA" });
  });
});

describe("placa", () => {
  it("G lido como Q não acusa o motorista (caso real de produção)", () => {
    // Ticket real: motorista declarou AQF7758, o modelo leu AGF7758.
    const r = conferir({ placa: "AQF7758" }, { placa: "AGF7758" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.incertezas[0].campo).toBe("placa");
    expect(r.veredito).toBe("INCERTO");
  });

  it("placa de outro caminhão é ALTA — mas só sabendo quais são os da frota", () => {
    // Sem a lista, placa desconhecida costuma ser a carreta. Ver a auditoria
    // de campos mais abaixo.
    const r = conferir(
      { placa: "AQF7758", placasConhecidas: ["AQF7758", "XYZ1234"] },
      { placa: "XYZ1234" },
    );
    expect(r.divergencias[0]).toMatchObject({ campo: "placa", gravidade: "ALTA" });
  });

  it("hífen não conta como diferença", () => {
    const r = conferir({ placa: "AQF-7758" }, { placa: "AQF7758" });
    expect(r.veredito).toBe("BATE");
  });
});

describe("data", () => {
  it("um dia de diferença é rotina (pesagem à noite, lançada no dia seguinte)", () => {
    const r = conferir({ data: "2026-08-22" }, { data: "2026-08-21" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("dois dias ou mais vira divergência — mas MEDIA, não cobrança", () => {
    const r = conferir({ data: "2026-08-22" }, { data: "2026-08-19" });
    expect(r.divergencias[0]).toMatchObject({ campo: "data", gravidade: "MEDIA" });
    expect(r.veredito).toBe("INCERTO");
  });

  it("aceita Date além de string", () => {
    const r = conferir({ data: new Date("2026-08-22T10:00:00Z") }, { data: "2026-08-22" });
    expect(r.veredito).toBe("BATE");
  });
});

describe("cliente e material", () => {
  it("acento e caixa não contam como diferença", () => {
    const r = conferir({ materialNome: "PÓ DE PEDRA" }, { materialNome: "po de pedra" });
    expect(r.veredito).toBe("BATE");
  });

  it("nome que não casou com o cadastro não vira divergência", () => {
    // O ticket traz o nome da pedreira, não o do cliente. Isso é normal.
    const r = conferir({ clienteNome: "TRIPOLONI" }, { clienteNome: null });
    expect(r.conferidos).not.toContain("cliente");
    expect(r.veredito).toBe("BATE");
  });

  it("cliente diferente NÃO vira divergência — decisão revista", () => {
    // Antes isto era MEDIA. Numa rodada real de 103 viagens, comparar nome de
    // cliente e material como se fosse chave respondeu pela maior parte dos
    // 100 falsos positivos: o ticket traz razão social, nome de obra, nome
    // técnico do produto. Quem manda no vínculo é o cadastro que o motorista
    // escolheu; estes campos são informação pra quem confere, não veredito.
    const r = conferir({ clienteNome: "TRIPOLONI" }, { clienteNome: "OUTRA EMPRESA" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });
});

describe("veredito — a faixa de confiança", () => {
  const semNada = { divergencias: [], incertezas: [], conferidos: ["ticket" as const] };

  it("tudo batendo com leitura boa: BATE", () => {
    expect(decidirVeredito([], [], ["ticket"], 0.92)).toBe("BATE");
  });

  it("leitura fraca invalida até a conclusão de que está tudo certo", () => {
    expect(decidirVeredito([], [], ["ticket"], 0.4)).toBe("INCERTO");
  });

  it("nada pra conferir é NAO_APLICAVEL, não sucesso", () => {
    expect(decidirVeredito([], [], [], 0.9)).toBe("NAO_APLICAVEL");
  });

  it("ALTA com confiança alta é o ÚNICO caso que chega ao motorista", () => {
    const alta = [{ campo: "toneladas" as const, declarado: "a", lido: "b", gravidade: "ALTA" as const, detalhe: "" }];
    expect(decidirVeredito(alta, [], ["toneladas"], 0.9)).toBe("DIVERGE");
  });

  it("a mesma ALTA com confiança média vira revisão humana", () => {
    const alta = [{ campo: "toneladas" as const, declarado: "a", lido: "b", gravidade: "ALTA" as const, detalhe: "" }];
    expect(decidirVeredito(alta, [], ["toneladas"], 0.7)).toBe("INCERTO");
  });

  it("só MEDIA nunca chega ao motorista, mesmo com leitura ótima", () => {
    const media = [{ campo: "data" as const, declarado: "a", lido: "b", gravidade: "MEDIA" as const, detalhe: "" }];
    expect(decidirVeredito(media, [], ["data"], 0.99)).toBe("INCERTO");
  });

  it("incerteza sozinha já barra o aviso", () => {
    const inc = [{ campo: "placa" as const, declarado: "a", lido: "b", motivo: "x" }];
    expect(decidirVeredito([], inc, ["placa"], 0.99)).toBe("INCERTO");
  });

  it("o limiar é configurável, não hardcoded", () => {
    const alta = [{ campo: "toneladas" as const, declarado: "a", lido: "b", gravidade: "ALTA" as const, detalhe: "" }];
    const rigoroso = { ...LIMIARES_PADRAO, confiancaParaAvisar: 0.95 };
    expect(decidirVeredito(alta, [], ["toneladas"], 0.9, rigoroso)).toBe("INCERTO");
  });

  it("sanidade: o objeto de apoio dos testes reflete o caso vazio", () => {
    expect(decidirVeredito(semNada.divergencias, semNada.incertezas, semNada.conferidos, 0.9)).toBe("BATE");
  });
});

describe("segunda opinião", () => {
  it("peso em jogo pede segunda leitura antes de acusar", () => {
    const r = conferir({ toneladas: 35.14 }, { toneladas: 30.5 });
    expect(precisaSegundaOpiniao(r, 0.92)).toBe(true);
  });

  it("peso suspeito (bruto) também pede", () => {
    const r = conferir({ toneladas: 32 }, { toneladas: 48 });
    expect(precisaSegundaOpiniao(r, 0.92)).toBe(true);
  });

  it("leitura fraca pede, mesmo sem divergência", () => {
    const r = conferir({}, { confianca: 0.5 });
    expect(precisaSegundaOpiniao(r, 0.5)).toBe(true);
  });

  it("tudo batendo com leitura boa NÃO gasta uma segunda chamada", () => {
    const r = conferir({}, {});
    expect(precisaSegundaOpiniao(r, 0.92)).toBe(false);
  });

  it("divergência que não é de peso, com leitura boa, não escala", () => {
    const r = conferir({ ticket: "3174" }, { ticket: "9821" });
    expect(precisaSegundaOpiniao(r, 0.92)).toBe(false);
  });
});

describe("caso completo — o ticket real de produção", () => {
  it("ticket 3174: peso e número exatos, placa com um caractere torto", () => {
    const r = conferir({}, { placa: "AGF7758" });
    // O que importa: nada disso vira cobrança ao motorista.
    expect(r.veredito).toBe("INCERTO");
    expect(r.divergencias).toHaveLength(0);
    expect(r.conferidos).toEqual(
      expect.arrayContaining(["toneladas", "ticket", "placa", "data", "cliente", "material"]),
    );
  });
});

describe("rótulo colado no número do ticket", () => {
  it("tira rótulo quando o resto é todo numérico", () => {
    expect(normalizarTicket("Nº 3.174")).toBe("3174");
    expect(normalizarTicket("TICKET 3174")).toBe("3174");
    expect(normalizarTicket("ROMANEIO-3174")).toBe("3174");
  });

  it("NÃO tira letra que faz parte do número de verdade", () => {
    // O rótulo só sai quando o que vem logo depois é dígito. Em "NF1234" o N é
    // seguido de F, então nada é removido — é a nota fiscal, não "N" + número.
    expect(normalizarTicket("NF1234")).toBe("NF1234");
    expect(normalizarTicket("A-3174")).toBe("A3174");
  });

  it("ticket com rótulo bate com o mesmo ticket sem rótulo", () => {
    const r = conferir({ ticket: "Nº 3174" }, { ticket: "3174" });
    expect(r.veredito).toBe("BATE");
  });
});

/**
 * Casos tirados de uma rodada real: 100 de 103 viagens saíram divergentes, e
 * quase tudo era o comparador sendo literal demais. Cada um destes estava
 * marcado como divergência e estava CERTO na viagem.
 */
describe("regressão: os falsos positivos da primeira rodada", () => {
  it("prefixo de série no ticket não é outro ticket", () => {
    // Motorista digita o número; a balança imprime a sigla do posto junto.
    const r = conferir({ ticket: "043625" }, { ticket: "TKB-043625" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.incertezas).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("razão social no ticket não é outro cliente", () => {
    const r = conferir({ clienteNome: "CASTILHO" }, { clienteNome: "CONSTRUTORA CASTILHO" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("nome técnico do material não é outro material", () => {
    // "MASSA DE ASFALTO" no cadastro, "C.B.U.Q. FAIXA C" impresso: mesmo
    // produto, nomes diferentes. Quem manda no vínculo é o cadastro que o
    // motorista escolheu, não o texto do ticket.
    const r = conferir({ materialNome: "MASSA DE ASFALTO" }, { materialNome: "C.B.U.Q. FAIXA C" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("nome do cliente completamente diferente também não acusa", () => {
    // Estes campos saíram do veredito de vez: o ticket traz nome de pedreira,
    // de obra, de produto técnico. É informação pra quem confere, não chave.
    const r = conferir({ clienteNome: "CASTILHO" }, { clienteNome: "PEDREIRA IRATI" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("zero à esquerda no ticket não é diferença", () => {
    expect(conferir({ ticket: "043625" }, { ticket: "43625" }).veredito).toBe("BATE");
  });

  it("o que ainda PRECISA acusar continua acusando", () => {
    // O afrouxamento não pode ter matado o propósito: peso e ticket de verdade
    // diferentes seguem sendo divergência.
    expect(conferir({ toneladas: 35.14 }, { toneladas: 30.5 }).veredito).toBe("DIVERGE");
    expect(conferir({ ticket: "043625" }, { ticket: "TKB-999999" }).veredito).toBe("DIVERGE");
  });
});

describe("auditoria dos demais campos (não só os que apareceram no relato)", () => {
  it("série de ticket diferente NÃO passa por igual — falso negativo perigoso", () => {
    // Comparar só os dígitos faria "A-3174" e "B-3174" baterem, e o conferente
    // deixaria passar exatamente o que existe pra pegar.
    //
    // Fica em revisão humana e não em cobrança porque A/B também é a cara de um
    // erro de leitura de um caractere. O que não pode, de jeito nenhum, é
    // passar como BATE.
    const r = conferir({ ticket: "A-3174" }, { ticket: "B-3174" });
    expect(r.veredito).not.toBe("BATE");
    expect(r.incertezas[0].campo).toBe("ticket");
  });

  it("mas série omitida de um lado segue batendo", () => {
    expect(conferir({ ticket: "043625" }, { ticket: "TKB-043625" }).veredito).toBe("BATE");
    expect(conferir({ ticket: "TKB-043625" }, { ticket: "TKB-043625" }).veredito).toBe("BATE");
  });

  it("rótulo não conta como série", () => {
    expect(conferir({ ticket: "TICKET 3174" }, { ticket: "3174" }).veredito).toBe("BATE");
  });

  it("placa que não é de nenhum caminhão da frota vira revisão, não acusação", () => {
    // Caso real de transporte: o ticket registra a placa da CARRETA e o
    // motorista lança o cavalo mecânico. Não é viagem no veículo errado.
    const r = conferir(
      { placa: "AQF7758", placasConhecidas: ["AQF7758", "XYZ1234"] },
      { placa: "QRS9876" },
    );
    expect(r.divergencias).toHaveLength(0);
    expect(r.incertezas[0].motivo).toMatch(/carreta|frota/);
    expect(r.veredito).toBe("INCERTO");
  });

  it("placa de OUTRO caminhão da frota é que vira divergência ALTA", () => {
    const r = conferir(
      { placa: "AQF7758", placasConhecidas: ["AQF7758", "XYZ1234"] },
      { placa: "XYZ1234" },
    );
    expect(r.divergencias[0]).toMatchObject({ campo: "placa", gravidade: "ALTA" });
    expect(r.veredito).toBe("DIVERGE");
  });

  it("sem a lista da frota, placa diferente é revisão — não dá pra afirmar", () => {
    const r = conferir({ placa: "AQF7758" }, { placa: "QRS9876" });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("INCERTO");
  });

  it("data virando o mês continua certa", () => {
    expect(conferir({ data: "2026-09-01" }, { data: "2026-08-31" }).veredito).toBe("BATE");
    expect(conferir({ data: "2026-01-01" }, { data: "2025-12-31" }).veredito).toBe("BATE");
  });
});

/**
 * A virada de desenho: comparar NOME é problema semântico, não de string.
 * Depois de três rodadas empilhando heurística e abrindo um buraco novo a cada
 * uma, quem julga nome e qual-número-é-o-do-documento passou a ser o modelo,
 * que entende do assunto. O código ficou com o peso (aritmética) e com as
 * travas de segurança.
 */
describe("conferência guiada pelo parecer da IA", () => {
  const declarado: Declarado = {
    toneladas: 35.14,
    ticket: "198398",
    placa: "AQF7758",
    data: "2026-08-22",
    clienteNome: "BRONZE PAVIMENTAÇÕES LTDA",
    materialNome: "MASSA DE ASFALTO",
  };
  const lido: Lido = {
    toneladas: 35.14,
    ticket: "198398",
    placa: "AQF7758",
    data: "2026-08-22",
    clienteNome: "Construtora Bronze",
    materialNome: "C.B.U.Q. FAIXA C",
    confianca: 0.92,
  };
  const ok = { confere: "sim" as const, porque: "" };

  it("razão social diferente que a IA reconhece como a mesma empresa: BATE", () => {
    const r = conferirComJulgamento(declarado, lido, {
      numeroDocumento: ok,
      toneladas: ok,
      cliente: { confere: "sim", porque: "Bronze Pavimentações e Construtora Bronze são a mesma" },
      material: { confere: "sim", porque: "CBUQ é massa asfáltica" },
    });
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("a IA sabendo qual número é o do documento resolve o formato certo", () => {
    // Nota fiscal traz número de NF, de pedido e às vezes do ticket. Qual deles
    // corresponde ao lançado é ela quem diz.
    const r = conferirComJulgamento(
      declarado,
      { ...lido, tipoDocumento: "nota_fiscal", ticket: "168395" },
      { numeroDocumento: { confere: "sim", porque: "168395 é o pedido; a NF é 198398" }, toneladas: ok },
    );
    expect(r.divergencias).toHaveLength(0);
    expect(r.veredito).toBe("BATE");
  });

  it("documento realmente de outro número continua divergindo", () => {
    const r = conferirComJulgamento(declarado, { ...lido, ticket: "999999" }, {
      numeroDocumento: { confere: "nao", porque: "o documento é o 999999" },
      toneladas: ok,
    });
    expect(r.divergencias[0]).toMatchObject({ campo: "ticket", gravidade: "ALTA" });
    expect(r.veredito).toBe("DIVERGE");
  });

  it("'nao' em cliente NÃO chega ao motorista — para na revisão", () => {
    // Nome é onde a leitura mais erra, e onde acusar sai mais caro que conferir.
    const r = conferirComJulgamento(declarado, lido, {
      numeroDocumento: ok,
      toneladas: ok,
      cliente: { confere: "nao", porque: "empresas diferentes" },
    });
    expect(r.divergencias).toHaveLength(0);
    expect(r.incertezas[0].campo).toBe("cliente");
    expect(r.veredito).toBe("INCERTO");
  });

  it("o peso continua sendo julgado no número, não no parecer", () => {
    // É aritmética e é o que vira dinheiro: não se delega.
    const r = conferirComJulgamento(declarado, { ...lido, toneladas: 30.5 }, {
      numeroDocumento: ok,
      toneladas: { confere: "sim", porque: "achei que batia" },
    });
    // A IA disse que confere, mas os números não fecham: vira revisão, e não
    // um "tudo certo" que deixaria passar diferença de carga.
    expect(r.veredito).toBe("INCERTO");
    expect(r.incertezas[0].campo).toBe("toneladas");
  });

  it("peso divergente sem aval da IA segue divergência ALTA", () => {
    const r = conferirComJulgamento(declarado, { ...lido, toneladas: 30.5 }, {
      numeroDocumento: ok,
      toneladas: { confere: "nao", porque: "o ticket mostra 30,5" },
    });
    expect(r.divergencias[0]).toMatchObject({ campo: "toneladas", gravidade: "ALTA" });
    expect(r.veredito).toBe("DIVERGE");
  });

  it("peso com cara de bruto continua sendo pego pelo código", () => {
    const r = conferirComJulgamento(declarado, { ...lido, toneladas: 52 }, {
      numeroDocumento: ok,
      toneladas: { confere: "nao", porque: "diferente" },
    });
    expect(r.divergencias).toHaveLength(0);
    expect(r.incertezas[0].motivo).toMatch(/bruto/);
  });

  it("leitura fraca invalida tudo, mesmo com a IA dizendo que confere", () => {
    const r = conferirComJulgamento(declarado, { ...lido, confianca: 0.3 }, {
      numeroDocumento: ok,
      toneladas: ok,
    });
    expect(r.veredito).toBe("INCERTO");
  });

  it("sem parecer nenhum, não inventa conclusão", () => {
    const r = conferirComJulgamento(declarado, lido, {});
    expect(r.divergencias).toHaveLength(0);
    // Só o peso foi conferível, e ele bate.
    expect(r.conferidos).toEqual(["toneladas"]);
  });
});
