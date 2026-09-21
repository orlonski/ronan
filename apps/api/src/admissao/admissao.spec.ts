import { describe, expect, it } from "vitest";
import { AdmissaoService } from "./admissao.service";

/**
 * As travas da porta pública.
 *
 * Isto é um endpoint sem login que ACEITA ARQUIVO e grava documento pessoal de
 * terceiro. Cada teste aqui é uma forma de vazar ou de sujar dado de cliente
 * que já foi fechada — e que uma refatoração distraída reabre.
 */

const DAQUI_A_UM_MES = new Date(Date.now() + 30 * 86_400_000);
const MES_PASSADO = new Date(Date.now() - 30 * 86_400_000);

function servico(over: {
  convite?: Record<string, unknown> | null;
  exigidos?: {
    tipo: string;
    titulo: string;
    obrigatorio: boolean;
    empresaId?: string | null;
    exigeAssinatura?: boolean;
    exigeIcpBrasil?: boolean;
  }[];
  enviados?: { tipo: string; storageKey?: string; hashArquivo?: string }[];
  assinaturas?: { tipoDocumento: string; modo: string; assinadoEm: Date; hashArquivo?: string }[];
  arquivoGuardado?: Buffer;
  alocacao?: Record<string, unknown> | null;
} = {}) {
  // As exigências ganham id aqui porque a IDENTIDADE do documento passou a ser
  // a exigência, não a gaveta. Os testes continuam falando em "CNH"/"ASO" (que
  // é como a operação fala) e o fake traduz pra chave, do mesmo jeito que o
  // service faz no banco.
  const exigidos = (
    over.exigidos ?? [{ tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null }]
  ).map((e, i) => ({ id: `e${i + 1}`, exigeAssinatura: false, exigeIcpBrasil: false, ...e }));
  const chaveDoTipo = (tipo: string) => {
    const e = exigidos.find((x) => x.tipo === tipo);
    return e ? `exig:${e.id}` : `gaveta:${tipo}`;
  };
  const enviados = (over.enviados ?? []).map((d) => ({
    ...d,
    chave: chaveDoTipo(d.tipo),
    storageKey: d.storageKey ?? "chave/no/minio",
    hashArquivo: d.hashArquivo ?? null,
  }));
  const assinaturas = (over.assinaturas ?? []).map((a) => ({
    ...a,
    chave: chaveDoTipo(a.tipoDocumento),
    hashArquivo: a.hashArquivo ?? null,
  }));
  const escritas: { tabela: string; data: Record<string, unknown> }[] = [];
  const convite =
    over.convite === undefined
      ? {
          id: "c1",
          contaId: "cnt1",
          motoristaId: "mot1",
          token: "tok",
          expiraEm: DAQUI_A_UM_MES,
          revogadoEm: null,
          enviosFeitos: 0,
          primeiroAcessoEm: null,
          motorista: { id: "mot1", nome: "João" },
        }
      : over.convite;

  const prisma = {
    conviteColeta: {
      findFirst: async () => convite,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "convite", data });
        return convite;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "convite", data });
        return { id: "c2", ...data };
      },
      findMany: async () => [],
    },
    alocacaoObra: { findFirst: async () => over.alocacao ?? null },
    documentoExigido: {
      findMany: async () => exigidos,
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
    motoristaDocumento: {
      findMany: async () => enviados,
      findFirst: async ({ where }: { where?: { chave?: string } } = {}) =>
        where?.chave ? (enviados.find((d) => d.chave === where.chave) ?? null) : (enviados[0] ?? null),
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        escritas.push({ tabela: "documento", data: create });
        return create;
      },
    },
    motorista: { findFirst: async () => ({ id: "mot1", nome: "João", cpf: "11122233344" }) },
    assinaturaDocumento: {
      findMany: async () => assinaturas,
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "assinatura", data });
        return data;
      },
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        escritas.push({ tabela: "assinatura", data: create });
        return { ...create, assinadoEm: new Date("2026-09-20T12:00:00Z") };
      },
    },
  };
  const uploads = {
    putMotoristaDocumento: async () => "chave/no/minio",
    removeObject: async () => undefined,
    getObjectBuffer: async () => over.arquivoGuardado ?? Buffer.from("conteudo do papel"),
  };
  return { s: new AdmissaoService(prisma as never, uploads as never), escritas };
}

const ARQUIVO = {
  buffer: Buffer.from("x"),
  mimetype: "image/jpeg",
  size: 1000,
  originalname: "cnh.jpg",
};

describe("o token é a única credencial", () => {
  it("token que não existe dá o MESMO erro de token expirado", async () => {
    // Distinguir contaria a quem tem um link velho que ele já existiu, e pra
    // quem. Mensagem única, sem pista.
    const inexistente = servico({ convite: null });
    await expect(inexistente.s.paginaPublica("qualquer")).rejects.toThrow(
      /não está mais disponível/i,
    );
  });

  it("link expirado não abre", async () => {
    const { s } = servico({
      convite: { id: "c1", contaId: "cnt1", motoristaId: "mot1", expiraEm: MES_PASSADO, revogadoEm: null },
    });
    await expect(s.paginaPublica("tok")).rejects.toThrow(/não está mais disponível/i);
  });

  it("link revogado não abre — e a linha continua existindo", async () => {
    const { s } = servico({
      convite: {
        id: "c1",
        contaId: "cnt1",
        motoristaId: "mot1",
        expiraEm: DAQUI_A_UM_MES,
        revogadoEm: new Date(),
      },
    });
    await expect(s.paginaPublica("tok")).rejects.toThrow(/não está mais disponível/i);
  });

  it("link expirado também não ACEITA arquivo", async () => {
    // O GET e o POST validam separado: bloquear só a leitura deixaria a porta
    // de escrita aberta pra quem já tem o token.
    const { s } = servico({
      convite: { id: "c1", contaId: "cnt1", motoristaId: "mot1", expiraEm: MES_PASSADO, revogadoEm: null },
    });
    await expect(s.receberArquivo("tok", { tipo: "CNH" }, ARQUIVO)).rejects.toThrow(
      /não está mais disponível/i,
    );
  });
});

describe("a página pública mostra o estado, nunca o arquivo", () => {
  it("diz o que falta E o que já chegou", async () => {
    // A primeira versão escondia o recebido: a pessoa mandava sete arquivos
    // sem saber qual entrou e não tinha como trocar uma foto tremida.
    const { s } = servico({
      exigidos: [
        { tipo: "CNH", titulo: "CNH", obrigatorio: true },
        { tipo: "ASO", titulo: "Exame", obrigatorio: true },
      ],
      enviados: [{ tipo: "CNH" }],
    });
    const r = await s.paginaPublica("tok");

    expect(r.documentos.find((d) => d.tipo === "CNH")?.recebido).toBe(true);
    expect(r.documentos.find((d) => d.tipo === "ASO")?.recebido).toBe(false);
    expect(r.recebidos).toBe(1);
    expect(r.total).toBe(2);
  });

  it("nunca devolve arquivo, nome de arquivo nem chave de storage", async () => {
    // O que caiu foi a contagem, não o sigilo do conteúdo. Quem abre o link
    // pode não ser o titular: ele precisa saber o que falta mandar, nunca ver
    // o que já está lá.
    const { s } = servico({
      exigidos: [{ tipo: "CNH", titulo: "CNH", obrigatorio: true }],
      enviados: [{ tipo: "CNH" }],
    });
    const r = await s.paginaPublica("tok");
    expect(JSON.stringify(r)).not.toMatch(/storageKey|minio|nomeArquivo|\.jpg|\.pdf/i);
  });
});

describe("o que entra pela porta pública", () => {
  it("recusa documento que este motorista não precisa mandar", async () => {
    // Sem isto, um link legítimo viraria upload livre de qualquer gaveta.
    const { s, escritas } = servico({
      exigidos: [{ tipo: "CNH", titulo: "CNH", obrigatorio: true }],
    });
    await expect(s.receberArquivo("tok", { tipo: "ASO" }, ARQUIVO)).rejects.toThrow(/não é pedido aqui/i);
    expect(escritas.filter((e) => e.tabela === "documento")).toHaveLength(0);
  });

  it("recusa tipo de arquivo que não é foto nem PDF", async () => {
    const { s } = servico();
    await expect(
      s.receberArquivo("tok", { tipo: "CNH" }, { ...ARQUIVO, mimetype: "application/x-msdownload" }),
    ).rejects.toThrow(/foto, um PDF ou o arquivo assinado/i);
  });

  it("recusa arquivo grande demais", async () => {
    const { s } = servico();
    await expect(
      s.receberArquivo("tok", { tipo: "CNH" }, { ...ARQUIVO, size: 30 * 1024 * 1024 }),
    ).rejects.toThrow(/grande demais/i);
  });

  it("recusa quando o link já recebeu arquivos demais", async () => {
    // Endpoint público de escrita sem teto vira hospedagem grátis pra quem
    // descobrir a URL.
    const { s } = servico({
      convite: {
        id: "c1",
        contaId: "cnt1",
        motoristaId: "mot1",
        expiraEm: DAQUI_A_UM_MES,
        revogadoEm: null,
        enviosFeitos: 40,
        motorista: { nome: "João" },
      },
    });
    await expect(s.receberArquivo("tok", { tipo: "CNH" }, ARQUIVO)).rejects.toThrow(/arquivos demais/i);
  });

  it("aceita o documento pedido e grava na gaveta certa", async () => {
    const { s, escritas } = servico();
    const r = await s.receberArquivo("tok", { tipo: "CNH" }, ARQUIVO);
    expect(r).toEqual({
      recebido: true,
      exigenciaId: "e1",
      tipo: "CNH",
      assinaturaEmbutida: false,
    });
    const doc = escritas.find((e) => e.tabela === "documento");
    expect(doc?.data.tipo).toBe("CNH");
    expect(doc?.data.motoristaId).toBe("mot1");
  });
});

describe("o link", () => {
  it("nasce com token longo o bastante pra não ser adivinhado", async () => {
    // 24 bytes = 192 bits, em base64url. O link É a credencial.
    const { s, escritas } = servico();
    await s.criarConvite("mot1", "u1");
    const token = escritas.find((e) => e.tabela === "convite")?.data.token as string;
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("nasce com prazo pra vencer sozinho", async () => {
    const { s, escritas } = servico();
    await s.criarConvite("mot1", "u1");
    const expira = escritas.find((e) => e.tabela === "convite")?.data.expiraEm as Date;
    expect(expira.getTime()).toBeGreaterThan(Date.now());
  });
});

/**
 * A assinatura. O que dá valor a ela não é o clique — é a trilha, e é o hash
 * amarrando a assinatura AO papel que foi assinado.
 */
describe("assinatura de documento", () => {
  const EXIGE_SIMPLES = [
    { tipo: "CNH", titulo: "Contrato", obrigatorio: true, empresaId: null, exigeAssinatura: true },
  ];
  const EXIGE_ICP = [
    {
      tipo: "CNH",
      titulo: "Contrato",
      obrigatorio: true,
      empresaId: null,
      exigeAssinatura: true,
      exigeIcpBrasil: true,
    },
  ];
  const P7S = Buffer.concat([
    Buffer.from([0x30, 0x82, 0x01, 0x00, 0x06, 0x09]),
    Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]),
  ]);

  it("grava nome, CPF, IP e o HASH do arquivo guardado", async () => {
    const { s, escritas } = servico({
      exigidos: EXIGE_SIMPLES,
      enviados: [{ tipo: "CNH", storageKey: "chave/no/minio" }],
    });
    await s.assinarDocumento(
      "tok",
      { tipo: "CNH", nome: "João da Silva", cpf: "111.222.333-44" },
      "203.0.113.9",
      "Mozilla/5.0",
    );
    const a = escritas.find((e) => e.tabela === "assinatura")!;
    expect(a.data.modo).toBe("SIMPLES");
    expect(a.data.nomeDeclarado).toBe("João da Silva");
    expect(a.data.cpfDeclarado).toBe("11122233344");
    expect(a.data.ip).toBe("203.0.113.9");
    expect(String(a.data.hashArquivo)).toHaveLength(64);
  });

  it("recusa quem não é o motorista — senão o dono assina no lugar dele", async () => {
    const { s } = servico({
      exigidos: EXIGE_SIMPLES,
      enviados: [{ tipo: "CNH", storageKey: "k" }],
    });
    await expect(
      s.assinarDocumento("tok", { tipo: "CNH", nome: "Outra Pessoa", cpf: "99988877766" }),
    ).rejects.toThrow(/CPF não confere/i);
  });

  it("não deixa assinar antes de mandar o arquivo — não há o que assinar", async () => {
    const { s } = servico({ exigidos: EXIGE_SIMPLES, enviados: [] });
    await expect(
      s.assinarDocumento("tok", { tipo: "CNH", nome: "João da Silva", cpf: "11122233344" }),
    ).rejects.toThrow(/Mande o arquivo antes/i);
  });

  it("documento com ICP não aceita aceite eletrônico — a assinatura é o arquivo", async () => {
    const { s } = servico({ exigidos: EXIGE_ICP, enviados: [{ tipo: "CNH", storageKey: "k" }] });
    await expect(
      s.assinarDocumento("tok", { tipo: "CNH", nome: "João da Silva", cpf: "11122233344" }),
    ).rejects.toThrow(/certificado digital/i);
  });

  it("documento com ICP recusa PDF escaneado, que é o erro que a pessoa comete", async () => {
    const { s } = servico({ exigidos: EXIGE_ICP });
    await expect(
      s.receberArquivo("tok", { tipo: "CNH" }, {
        buffer: Buffer.from("%PDF-1.4 nada assinado aqui"),
        mimetype: "application/pdf",
        size: 100,
        originalname: "contrato.pdf",
      }),
    ).rejects.toThrow(/certificado digital/i);
  });

  it("documento com ICP aceita .p7s e já registra a assinatura", async () => {
    const { s, escritas } = servico({ exigidos: EXIGE_ICP });
    const r = await s.receberArquivo("tok", { tipo: "CNH" }, {
      buffer: P7S,
      mimetype: "application/pkcs7-signature",
      size: P7S.length,
      originalname: "contrato.pdf.p7s",
    });
    expect(r.assinaturaEmbutida).toBe(true);
    const a = escritas.find((e) => e.tabela === "assinatura")!;
    expect(a.data.modo).toBe("ICP_BRASIL");
    // Ninguém digitou nada: a identidade está dentro do certificado.
    expect(a.data.nomeDeclarado).toBeUndefined();
  });

  it("recusa .p7s que não tem PKCS#7 dentro", async () => {
    const { s } = servico({ exigidos: EXIGE_ICP });
    await expect(
      s.receberArquivo("tok", { tipo: "CNH" }, {
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimetype: "application/octet-stream",
        size: 3,
        originalname: "cnh.jpg.p7s",
      }),
    ).rejects.toThrow(/não tem assinatura digital dentro/i);
  });
});

/**
 * A GAVETA NÃO É A IDENTIDADE DO DOCUMENTO.
 *
 * Um contratante pede 18 papéis; existem 12 gavetas. RG, CPF, CTPS e ficha de
 * registro caem todos em `REGISTRO_MOTORISTA`. Enquanto o único era
 * `(motoristaId, tipo)`, os quatro dividiam uma linha e um objeto no MinIO: o
 * segundo envio apagava o primeiro, e a tela marcava os quatro como recebidos.
 * Ninguém via erro nenhum, e o pacote só era desmentido na portaria da obra.
 */
describe("duas exigências na mesma gaveta são dois documentos", () => {
  const MESMA_GAVETA = [
    { tipo: "REGISTRO_MOTORISTA", titulo: "RG", obrigatorio: true, empresaId: null },
    { tipo: "REGISTRO_MOTORISTA", titulo: "CTPS", obrigatorio: true, empresaId: null },
  ];

  it("cada uma tem a sua chave, e mandar uma não marca a outra como recebida", async () => {
    const { s } = servico({
      exigidos: MESMA_GAVETA,
      // Só o RG (primeira exigência) chegou.
      enviados: [{ tipo: "REGISTRO_MOTORISTA" }],
    });
    const r = await s.paginaPublica("tok");

    const rg = r.documentos.find((d) => d.titulo === "RG")!;
    const ctps = r.documentos.find((d) => d.titulo === "CTPS")!;
    expect(rg.exigenciaId).not.toBe(ctps.exigenciaId);
    expect(rg.recebido).toBe(true);
    expect(ctps.recebido).toBe(false);
    expect(r.recebidos).toBe(1);
    expect(r.total).toBe(2);
  });

  it("o arquivo é guardado sob a chave da exigência, não sob a gaveta", async () => {
    const { s, escritas } = servico({ exigidos: MESMA_GAVETA });
    await s.receberArquivo("tok", { exigenciaId: "e2" }, ARQUIVO);

    const doc = escritas.find((e) => e.tabela === "documento")!;
    expect(doc.data.chave).toBe("exig:e2");
    expect(doc.data.exigenciaId).toBe("e2");
    // A gaveta continua gravada: é ela que o painel lista e o ZIP nomeia.
    expect(doc.data.tipo).toBe("REGISTRO_MOTORISTA");
  });

  it("mandar SÓ a gaveta, quando ela é ambígua, é recusado com os nomes", async () => {
    // Escolher uma das duas por sorteio é exatamente como o arquivo sumia.
    const { s } = servico({ exigidos: MESMA_GAVETA });
    await expect(
      s.receberArquivo("tok", { tipo: "REGISTRO_MOTORISTA" }, ARQUIVO),
    ).rejects.toThrow(/RG, CTPS/);
  });

  it("a gaveta continua valendo quando ela é inequívoca", async () => {
    // Página aberta há dez minutos não pode quebrar.
    const { s, escritas } = servico();
    await s.receberArquivo("tok", { tipo: "CNH" }, ARQUIVO);
    expect(escritas.find((e) => e.tabela === "documento")!.data.chave).toBe("exig:e1");
  });

  it("a exigência do contratante não é atropelada pela geral da mesma gaveta", async () => {
    // Uma "OS" geral sem assinatura vinha antes na lista e ganhava do `find`,
    // então a exigência de ICP do contratante simplesmente não rodava: a
    // pessoa mandava um escaneado, o sistema aceitava, e a obra recusava o
    // caminhão na portaria.
    const { s } = servico({
      exigidos: [
        { tipo: "OS", titulo: "OS geral", obrigatorio: true, empresaId: null },
        {
          tipo: "OS",
          titulo: "OS da obra",
          obrigatorio: true,
          empresaId: "emp1",
          exigeAssinatura: true,
          exigeIcpBrasil: true,
        },
      ],
    });
    await expect(s.receberArquivo("tok", { exigenciaId: "e2" }, ARQUIVO)).rejects.toThrow(
      /certificado digital/i,
    );
  });

  it("assinar aponta pra UMA exigência — assinar o contrato não carimba a ficha", async () => {
    const { s, escritas } = servico({
      exigidos: [
        {
          tipo: "REGISTRO_MOTORISTA",
          titulo: "Contrato de experiência",
          obrigatorio: true,
          empresaId: null,
          exigeAssinatura: true,
        },
        {
          tipo: "REGISTRO_MOTORISTA",
          titulo: "Ficha de registro",
          obrigatorio: true,
          empresaId: null,
          exigeAssinatura: true,
        },
      ],
      enviados: [{ tipo: "REGISTRO_MOTORISTA" }],
    });
    await s.assinarDocumento("tok", {
      exigenciaId: "e1",
      nome: "João da Silva",
      cpf: "11122233344",
    });
    expect(escritas.find((e) => e.tabela === "assinatura")!.data.chave).toBe("exig:e1");
  });
});

/**
 * O hash guardado é o que permite dizer "esta assinatura ainda vale".
 */
describe("a assinatura confere com o arquivo que está lá", () => {
  const EXIGE_ASSINATURA = [
    {
      tipo: "OS",
      titulo: "Ordem de serviço",
      obrigatorio: true,
      empresaId: null,
      exigeAssinatura: true,
    },
  ];

  it("hashes iguais conferem", async () => {
    const { s } = servico({
      exigidos: EXIGE_ASSINATURA,
      enviados: [{ tipo: "OS", hashArquivo: "abc" }],
      assinaturas: [
        { tipoDocumento: "OS", modo: "SIMPLES", assinadoEm: new Date(), hashArquivo: "abc" },
      ],
    });
    const r = await s.estadoDosDocumentos("mot1");
    expect(r.documentos[0].assinaturaConfere).toBe(true);
  });

  it("arquivo trocado por fora faz a assinatura DEIXAR de conferir", async () => {
    const { s } = servico({
      exigidos: EXIGE_ASSINATURA,
      enviados: [{ tipo: "OS", hashArquivo: "novo" }],
      assinaturas: [
        { tipoDocumento: "OS", modo: "SIMPLES", assinadoEm: new Date(), hashArquivo: "velho" },
      ],
    });
    const r = await s.estadoDosDocumentos("mot1");
    expect(r.documentos[0].assinaturaConfere).toBe(false);
  });

  it("documento sem hash guardado responde NULO, nunca 'confere'", async () => {
    // São as linhas anteriores a 21/09/2026. Dizer "confere" sem ter como
    // conferir é a mentira que este campo existe pra não contar.
    const { s } = servico({
      exigidos: EXIGE_ASSINATURA,
      enviados: [{ tipo: "OS" }],
      assinaturas: [
        { tipoDocumento: "OS", modo: "SIMPLES", assinadoEm: new Date(), hashArquivo: "velho" },
      ],
    });
    const r = await s.estadoDosDocumentos("mot1");
    expect(r.documentos[0].assinaturaConfere).toBeNull();
  });
});

/**
 * O recorte do APP: o motorista vê o que falta, não a evidência do escritório.
 */
describe("o que o motorista vê no app", () => {
  const EXIGE_ASSINATURA = [
    {
      tipo: "OS",
      titulo: "Ordem de serviço",
      obrigatorio: true,
      empresaId: null,
      exigeAssinatura: true,
    },
  ];

  it("diz quantos faltam e quem está pedindo", async () => {
    const { s } = servico({
      exigidos: [
        { tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null },
        { tipo: "CRLV", titulo: "Documento do caminhão", obrigatorio: true, empresaId: null },
      ],
      enviados: [{ tipo: "CNH" }],
      alocacao: { cliente: { empresaId: "emp1", nome: "Obra Centro" } },
    });
    const r = await s.paraOMotorista("mot1");

    expect(r.obra).toBe("Obra Centro");
    expect(r.total).toBe(2);
    expect(r.prontos).toBe(1);
    expect(r.faltamObrigatorios).toBe(1);
  });

  it("NÃO manda pro app a trilha da assinatura nem a chave do arquivo", async () => {
    // Nome, CPF, IP e hash são evidência pro escritório. Na tela dele não
    // ajudam em nada, e é dado sensível viajando à toa num 4G de beira de
    // estrada. Ele vê que assinou e quando.
    const { s } = servico({
      exigidos: EXIGE_ASSINATURA,
      enviados: [{ tipo: "OS", hashArquivo: "abc" }],
      assinaturas: [
        { tipoDocumento: "OS", modo: "SIMPLES", assinadoEm: new Date(), hashArquivo: "abc" },
      ],
    });
    const r = await s.paraOMotorista("mot1");

    const doc = r.documentos[0] as Record<string, unknown>;
    expect(doc.assinado).toBe(true);
    expect(doc.chave).toBeUndefined();
    expect(doc.storageKey).toBeUndefined();
    expect(doc.nomeArquivo).toBeUndefined();
    expect(doc.assinaturaConfere).toBeUndefined();
  });

  it("sem exigência nenhuma devolve lista vazia — o app some com a tela", async () => {
    // É o motorista de frete comum, de uma conta que nem contratou a admissão.
    // Não é erro, é o caso mais comum do sistema.
    const { s } = servico({ exigidos: [] });
    const r = await s.paraOMotorista("mot1");
    expect(r.total).toBe(0);
    expect(r.documentos).toEqual([]);
    expect(r.obra).toBeNull();
  });
});
