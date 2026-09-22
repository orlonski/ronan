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
    publico?: "MENSAL" | "TODOS" | "REGISTRADOS";
    comoAssinar?: "NAO" | "NO_APP" | "JA_ASSINADO";
  }[];
  enviados?: {
    tipo: string;
    storageKey?: string;
    hashArquivo?: string;
    vistoEm?: Date;
    conferidoEm?: Date;
    recusadoEm?: Date;
    recusaMotivo?: string;
  }[];
  assinaturas?: { tipoDocumento: string; modo: string; assinadoEm: Date; hashArquivo?: string }[];
  arquivoGuardado?: Buffer;
  alocacao?: Record<string, unknown> | null;
  /** Vínculo vivo: contratado em carteira ou parceiro. */
  regime?: { id: string; regime: "PARCEIRO" | "EMPREGADO" } | null;
} = {}) {
  // As exigências ganham id aqui porque a IDENTIDADE do documento passou a ser
  // a exigência, não a gaveta. Os testes continuam falando em "CNH"/"ASO" (que
  // é como a operação fala) e o fake traduz pra chave, do mesmo jeito que o
  // service faz no banco.
  const exigidos = (
    over.exigidos ?? [{ tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null }]
  ).map((e, i) => ({
    id: `e${i + 1}`,
    exigeAssinatura: false,
    exigeIcpBrasil: false,
    publico: "MENSAL",
    comoAssinar: "NAO",
    ...e,
  }));
  const chaveDoTipo = (tipo: string) => {
    const e = exigidos.find((x) => x.tipo === tipo);
    return e ? `exig:${e.id}` : `gaveta:${tipo}`;
  };
  const enviados = (over.enviados ?? []).map((d) => ({
    ...d,
    chave: chaveDoTipo(d.tipo),
    storageKey: d.storageKey ?? "chave/no/minio",
    hashArquivo: d.hashArquivo ?? null,
    vistoEm: d.vistoEm ?? null,
    conferidoEm: d.conferidoEm ?? null,
    recusadoEm: d.recusadoEm ?? null,
    recusaMotivo: d.recusaMotivo ?? null,
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
      // Respeita o filtro de público como o banco faz: é o que separa a
      // papelada de obra de quem só roda frete comum.
      // `publico` pode vir exato ("TODOS") ou negado ({ not: "REGISTRADOS" }):
      // o que se pede de registrado mora no cadastro de funcionário.
      findMany: async ({ where }: { where?: { publico?: string | { not: string } } } = {}) => {
        const p = where?.publico;
        if (!p) return exigidos;
        return exigidos.filter((e) =>
          typeof p === "string" ? (e.publico ?? "MENSAL") === p : (e.publico ?? "MENSAL") !== p.not,
        );
      },
      findFirst: async ({ where }: { where?: { id?: string } } = {}) =>
        exigidos.find((e) => e.id === where?.id) ?? null,
      create: async () => ({}),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "exigencia-update", data });
        return data;
      },
    },
    motoristaDocumento: {
      findMany: async () => enviados,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        escritas.push({ tabela: "documento-update", data });
        return data;
      },
      findFirst: async ({ where }: { where?: { chave?: string } } = {}) => {
        const achado = where?.chave
          ? enviados.find((d) => d.chave === where.chave)
          : enviados[0];
        return achado ? { id: `doc-${achado.chave}`, ...achado } : null;
      },
      upsert: async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        // O `update` é o que importa pros testes de substituição: é ele que
        // zera conferência e recusa quando chega arquivo novo.
        escritas.push({ tabela: "documento", data: { ...create, ...update } });
        return create;
      },
    },
    motorista: {
      findFirst: async () => ({
        id: "mot1",
        nome: "João",
        cpf: "11122233344",
        expoPushToken: "tok-1",
      }),
    },
    // A trava de vínculo: é ela que diz se esta pessoa é contratada aqui.
    regimeVigente: { findFirst: async () => over.regime ?? null },
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
    removerObjeto: async () => undefined,
    getObjectBuffer: async () => over.arquivoGuardado ?? Buffer.from("conteudo do papel"),
  };
  // Push de mentira: o teste checa QUE avisou, não como.
  const push = {
    enviar: async (args: Record<string, unknown>) => {
      escritas.push({ tabela: "push", data: args });
      return { ok: true };
    },
  };
  return {
    s: new AdmissaoService(prisma as never, uploads as never, push as never),
    escritas,
  };
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
    // `recebidos` aqui é CHEGOU: esta página serve a quem está mandando, e
    // ele precisa saber o que já entrou pra não mandar duas vezes.
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
    // A CNH chegou mas ninguém conferiu: não é tarefa dele, e também não é
    // "pronto". São duas contas diferentes, e é essa distinção que impede a
    // tela de dizer que acabou quando não acabou.
    expect(r.prontos).toBe(0);
    expect(r.faltamDele).toBe(1);
    expect(r.comOEscritorio).toBe(1);
    expect(r.faltamObrigatorios).toBe(2);
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
      // Em obra: senão o filtro de público esconde a papelada de obra, que é
      // justamente o comportamento testado no describe de baixo.
      alocacao: { cliente: { empresaId: "emp1", nome: "Obra Centro" } },
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

/**
 * DE QUEM SE PEDE.
 *
 * ⚠️ Exigência sem contratante valia pra TODO motorista da conta. Quem só roda
 * frete comum abria o app com "3 documentos faltam" de uma papelada de obra em
 * que ele nunca pôs o caminhão — cobrança errada, na tela de quem não podia
 * resolver. Decisão do dono (21/09/2026): documento de admissão é de
 * mensalista; o resto se marca na tela, um por um.
 */
describe("quem não está em obra não é cobrado de papelada de obra", () => {
  const CATALOGO = [
    { tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null, publico: "TODOS" as const },
    {
      tipo: "ESOCIAL",
      titulo: "eSocial",
      obrigatorio: true,
      empresaId: null,
      publico: "MENSAL" as const,
    },
  ];

  it("sem alocação, só o que vale pra frota inteira", async () => {
    const { s } = servico({ exigidos: CATALOGO, alocacao: null });
    const r = await s.paraOMotorista("mot1");
    expect(r.documentos.map((d) => d.titulo)).toEqual(["CNH"]);
  });

  it("com alocação, vem tudo", async () => {
    const { s } = servico({
      exigidos: CATALOGO,
      alocacao: { cliente: { empresaId: "emp1", nome: "Obra Centro" } },
    });
    const r = await s.paraOMotorista("mot1");
    expect(r.documentos.map((d) => d.titulo)).toEqual(["CNH", "eSocial"]);
  });

  it("motorista de frete comum, catálogo só de obra: nenhuma pendência", async () => {
    // O app some com o bloco e com a tela. É o caso mais comum da base — a
    // maioria dos motoristas de uma transportadora não está em obra mensal.
    const { s } = servico({
      exigidos: [
        {
          tipo: "ESOCIAL",
          titulo: "eSocial",
          obrigatorio: true,
          empresaId: null,
          publico: "MENSAL" as const,
        },
      ],
      alocacao: null,
    });
    const r = await s.paraOMotorista("mot1");
    expect(r.total).toBe(0);
    expect(r.faltamObrigatorios).toBe(0);
  });
});

/**
 * O motorista mandando e assinando PELO APP.
 */
describe("a porta do app", () => {
  const COM_ASSINATURA = [
    {
      tipo: "OS",
      titulo: "Ordem de serviço",
      obrigatorio: true,
      empresaId: null,
      exigeAssinatura: true,
      publico: "TODOS" as const,
    },
  ];

  it("recusa mandar documento que não é pedido pra ELE", async () => {
    // Sem isto, um motorista autenticado poderia gravar arquivo em qualquer
    // exigência da conta — inclusive de exigência que não é do público dele.
    const { s } = servico({ exigidos: COM_ASSINATURA });
    await expect(s.receberDoMotorista("mot1", "nao-existe", ARQUIVO)).rejects.toThrow(
      /não é pedido pra você/i,
    );
  });

  it("grava com origem APP", async () => {
    // É o número que responde "o app está trazendo documento?".
    const { s, escritas } = servico({ exigidos: COM_ASSINATURA });
    await s.receberDoMotorista("mot1", "e1", ARQUIVO);
    expect(escritas.find((e) => e.tabela === "documento")!.data.origem).toBe("APP");
  });

  it("assinar pelo app registra a origem e SE ele abriu o papel antes", async () => {
    const { s, escritas } = servico({
      exigidos: COM_ASSINATURA,
      enviados: [{ tipo: "OS", vistoEm: new Date() }],
    });
    await s.assinarPeloMotorista("mot1", "e1", { nome: "João da Silva", cpf: "11122233344" });

    const a = escritas.find((e) => e.tabela === "assinatura")!.data;
    expect(a.origem).toBe("APP");
    expect(a.viuDocumento).toBe(true);
    // Sem convite: não veio por link nenhum.
    expect(a.conviteColetaId).toBeUndefined();
  });

  it("quem NÃO abriu o papel assina, mas isso fica escrito", async () => {
    // Não bloqueia — bloquear seria inventar uma regra que o link não tem.
    // Mas mentir que ele leu seria pior do que registrar que não abriu.
    const { s, escritas } = servico({
      exigidos: COM_ASSINATURA,
      enviados: [{ tipo: "OS" }],
    });
    await s.assinarPeloMotorista("mot1", "e1", { nome: "João da Silva", cpf: "11122233344" });
    expect(escritas.find((e) => e.tabela === "assinatura")!.data.viuDocumento).toBe(false);
  });

  it("CPF que não é o dele continua sendo recusado, mesmo com sessão autenticada", async () => {
    // A invariante da porta velha não afrouxa na porta nova.
    const { s } = servico({
      exigidos: COM_ASSINATURA,
      enviados: [{ tipo: "OS" }],
    });
    await expect(
      s.assinarPeloMotorista("mot1", "e1", { nome: "Outra Pessoa", cpf: "99988877766" }),
    ).rejects.toThrow(/CPF não confere/i);
  });

  it("não dá pra assinar antes do arquivo chegar", async () => {
    const { s } = servico({ exigidos: COM_ASSINATURA });
    await expect(
      s.assinarPeloMotorista("mot1", "e1", { nome: "João da Silva", cpf: "11122233344" }),
    ).rejects.toThrow(/ainda não chegou/i);
  });

  it("documento de certificado digital não se assina pelo app", async () => {
    const { s } = servico({
      exigidos: [{ ...COM_ASSINATURA[0], exigeIcpBrasil: true }],
      enviados: [{ tipo: "OS" }],
    });
    await expect(
      s.assinarPeloMotorista("mot1", "e1", { nome: "João da Silva", cpf: "11122233344" }),
    ).rejects.toThrow(/já assinado/i);
  });
});

/**
 * ASSINAR FORA: CARTÓRIO OU GOV.BR.
 *
 * ⚠️ É como a operação já trabalha — o documento vai por WhatsApp e volta
 * assinado, "e ficamos lutando pra eles devolverem em foto assinado ou PDF".
 * O par de booleanos antigo não expressava isso: marcar "exige certificado"
 * RECUSAVA a foto do papel com firma reconhecida (o motorista ia ao cartório,
 * pagava, e o app dizia não), e não marcar aceitava o contrato em branco.
 */
describe("o papel que chega assinado de fora", () => {
  /** PKCS#7 mínimo: o OID de signedData, que é o que a detecção procura. */
  const ASSINADO_DIGITAL = Buffer.concat([
    Buffer.from([0x30, 0x82, 0x01, 0x00, 0x06, 0x09]),
    Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]),
  ]);
  const FORA = [
    {
      tipo: "OS",
      titulo: "Comodato assinado",
      obrigatorio: true,
      empresaId: null,
      exigeAssinatura: true,
      comoAssinar: "JA_ASSINADO" as const,
      publico: "TODOS" as const,
    },
  ];

  it("aceita a FOTO do papel do cartório e registra que precisa de conferência", async () => {
    const { s, escritas } = servico({ exigidos: FORA });
    await s.receberArquivo("tok", { exigenciaId: "e1" }, ARQUIVO);

    const a = escritas.find((e) => e.tabela === "assinatura")!.data;
    // NO_PAPEL, não ICP: não há nada digital nesse arquivo pra detectar, e
    // carimbar "assinado digitalmente" numa foto seria inventar.
    expect(a.modo).toBe("NO_PAPEL");
  });

  it("o mesmo documento vindo do gov.br é reconhecido como digital", async () => {
    const { s, escritas } = servico({ exigidos: FORA });
    await s.receberArquivo("tok", { exigenciaId: "e1" }, {
      buffer: ASSINADO_DIGITAL,
      mimetype: "application/pkcs7-signature",
      size: ASSINADO_DIGITAL.length,
      originalname: "comodato.pdf.p7s",
    });
    expect(escritas.find((e) => e.tabela === "assinatura")!.data.modo).toBe("ICP_BRASIL");
  });

  it("o contratante rigoroso continua recusando a foto — e explica por quê", async () => {
    // `exigeIcpBrasil` sobrevive como refinamento: é o contratante que SÓ
    // aceita digital. Aí a recusa tem que acontecer no envio, e não na
    // portaria da obra.
    const { s } = servico({
      exigidos: [{ ...FORA[0], exigeIcpBrasil: true }],
    });
    await expect(s.receberArquivo("tok", { exigenciaId: "e1" }, ARQUIVO)).rejects.toThrow(
      /foto do papel não serve/i,
    );
  });

  it("editar a exigência não obriga a recriar — os arquivos enviados ficam", async () => {
    // Sem edição, mudar como um papel é assinado exigia desativar e criar de
    // novo, e aí o arquivo já enviado apontava pra exigência velha: sumia da
    // lista do motorista e ele mandava tudo outra vez.
    const { s, escritas } = servico({ exigidos: FORA });
    await s.editarExigido("e1", {
      titulo: "Comodato assinado",
      comoAssinar: "NO_APP",
    });
    const dados = escritas.find((e) => e.tabela === "exigencia-update")!.data;
    expect(dados.comoAssinar).toBe("NO_APP");
    // "Só vale digital" não quer dizer nada pro aceite feito aqui dentro.
    expect(dados.exigeIcpBrasil).toBe(false);
    expect(dados.exigeAssinatura).toBe(true);
  });
});

/**
 * CHEGAR NÃO É ESTAR CERTO.
 *
 * ⚠️ O defeito que este bloco fecha: o sistema não vê o que está DENTRO de uma
 * foto. Sem conferência humana, "chegou" virava "conferido" por omissão — a
 * ficha mostrava visto verde, a contagem do app zerava sozinha, e o motorista
 * ia pra obra achando que estava resolvido. Testado com uma foto qualquer, que
 * é exatamente como o defeito apareceu.
 */
describe("a conferência é de gente, não do sistema", () => {
  const UM = [
    { tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null, publico: "TODOS" as const },
  ];

  it("documento que chegou e ninguém olhou NÃO conta como pronto", async () => {
    const { s } = servico({ exigidos: UM, enviados: [{ tipo: "CNH" }] });
    const r = await s.estadoDosDocumentos("mot1");

    expect(r.documentos[0].recebido).toBe(true);
    expect(r.documentos[0].conferido).toBe(false);
    expect(r.prontos).toBe(0);
  });

  it("mas também NÃO conta como tarefa dele — quem tem que agir é o escritório", async () => {
    // Contar como "falta" mandaria ele resolver o que não tem como resolver.
    const { s } = servico({ exigidos: UM, enviados: [{ tipo: "CNH" }] });
    const r = await s.estadoDosDocumentos("mot1");

    expect(r.faltamDele).toBe(0);
    expect(r.comOEscritorio).toBe(1);
  });

  it("depois de conferido, aí sim está pronto", async () => {
    const { s } = servico({
      exigidos: UM,
      enviados: [{ tipo: "CNH", conferidoEm: new Date() }],
    });
    const r = await s.estadoDosDocumentos("mot1");
    expect(r.prontos).toBe(1);
    expect(r.comOEscritorio).toBe(0);
  });

  it("recusado volta a ser tarefa DELE, com o motivo junto", async () => {
    const { s } = servico({
      exigidos: UM,
      enviados: [
        { tipo: "CNH", recusadoEm: new Date(), recusaMotivo: "a foto está cortada" },
      ],
    });
    const r = await s.estadoDosDocumentos("mot1");

    expect(r.faltamDele).toBe(1);
    expect(r.documentos[0].recusado).toBe(true);
    // O motivo viaja junto: sem ele, "mande de novo" faz a pessoa repetir o
    // mesmo erro.
    expect(r.documentos[0].recusaMotivo).toBe("a foto está cortada");
  });

  it("recusar sem motivo é recusado", async () => {
    const { s } = servico({ exigidos: UM, enviados: [{ tipo: "CNH" }] });
    await expect(s.recusarDocumento("mot1", "e1", "  ", "u1")).rejects.toThrow(
      /escreva o que houve/i,
    );
  });

  it("arquivo novo apaga a conferência anterior", async () => {
    // Quem conferiu olhou O ARQUIVO ANTERIOR. Manter o visto faria a ficha
    // dizer que alguém aprovou um papel que ninguém viu.
    const { s, escritas } = servico({
      exigidos: UM,
      enviados: [{ tipo: "CNH", conferidoEm: new Date() }],
    });
    await s.receberDoMotorista("mot1", "e1", ARQUIVO);

    const up = escritas.find((e) => e.tabela === "documento")!.data;
    expect(up.conferidoEm).toBeNull();
    expect(up.recusadoEm).toBeNull();
  });
});

/**
 * DOCUMENTO SEGUE O VÍNCULO, NÃO A OBRA.
 *
 * ⚠️ Isto já foi "tem alocação de obra ativa", e estava errado: o motorista
 * contratado em carteira que ainda não foi pra obra nenhuma — ou cuja empresa
 * nem usa o controle de obra — não via documento nenhum. A empresa contrata,
 * a pessoa manda os papéis e bate ponto; obra é detalhe de operação, não
 * requisito de admissão.
 */
describe("quem tem vínculo manda documento, com ou sem obra", () => {
  const SO_DO_MENSAL = [
    {
      tipo: "ESOCIAL",
      titulo: "eSocial",
      obrigatorio: true,
      empresaId: null,
      publico: "MENSAL" as const,
    },
  ];

  it("contratado em carteira SEM obra nenhuma vê os documentos", async () => {
    const { s } = servico({
      exigidos: SO_DO_MENSAL,
      alocacao: null,
      regime: { id: "r1", regime: "EMPREGADO" },
    });
    const r = await s.paraOMotorista("mot1");
    expect(r.total).toBe(1);
  });

  it("parceiro alocado numa obra também vê", async () => {
    const { s } = servico({
      exigidos: SO_DO_MENSAL,
      alocacao: { cliente: { empresaId: "emp1", nome: "Obra Centro" } },
      regime: { id: "r1", regime: "PARCEIRO" },
    });
    const r = await s.paraOMotorista("mot1");
    expect(r.total).toBe(1);
  });

  it("motorista de frete comum, sem vínculo nenhum, continua sem ver nada", async () => {
    const { s } = servico({ exigidos: SO_DO_MENSAL, alocacao: null, regime: null });
    const r = await s.paraOMotorista("mot1");
    expect(r.total).toBe(0);
  });
});

/**
 * UM DOCUMENTO, UMA LINHA.
 *
 * ⚠️ A separação por exigência resolveu "18 papéis não cabem em 12 gavetas",
 * mas abriu a porta pro contrário: a mesma CNH existindo duas vezes — um anexo
 * avulso na gaveta e o documento da exigência. Não existem duas CNH, e o dono
 * foi direto: "temos que ter uma única fonte e um único tipo e ponto final".
 */
describe("anexar pela gaveta cai na exigência dela", () => {
  it("gaveta com UMA exigência: o anexo do painel vira o documento dela", async () => {
    const { s, escritas } = servico({
      exigidos: [
        { tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null },
      ],
    });
    // Sem `exigenciaId`: é o caminho do painel anexando "na gaveta CNH".
    await s.receberDocumento({
      motoristaId: "mot1",
      exigencia: (await s.exigidosPara("mot1"))[0] ?? null,
      tipo: "CNH",
      arquivo: ARQUIVO,
      origem: "PAINEL",
    });
    expect(escritas.find((e) => e.tabela === "documento")!.data.chave).toBe("exig:e1");
  });

  it("gaveta com DUAS exigências continua aceitando anexo avulso", async () => {
    // Aqui não há como adivinhar se é o RG ou a CTPS, e escolher por sorteio é
    // exatamente como o arquivo sumia antes. O anexo fica solto e a tela
    // mostra de onde ele veio.
    const { s, escritas } = servico({
      exigidos: [
        { tipo: "REGISTRO_MOTORISTA", titulo: "RG", obrigatorio: true, empresaId: null },
        { tipo: "REGISTRO_MOTORISTA", titulo: "CTPS", obrigatorio: true, empresaId: null },
      ],
    });
    await s.receberDocumento({
      motoristaId: "mot1",
      exigencia: null,
      tipo: "REGISTRO_MOTORISTA",
      arquivo: ARQUIVO,
      origem: "PAINEL",
    });
    expect(escritas.find((e) => e.tabela === "documento")!.data.chave).toBe(
      "gaveta:REGISTRO_MOTORISTA",
    );
  });
});

/**
 * AVISAR É PARTE DA RECUSA.
 *
 * ⚠️ Sem a push, devolver um documento é escrever num lugar que o motorista
 * não tem motivo pra abrir: ele já tinha feito a parte dele, a tela dizia que
 * estava resolvido, e ele só descobriria na portaria da obra — que é
 * exatamente o que este módulo existe pra evitar.
 */
describe("recusar avisa o motorista", () => {
  const UM = [
    { tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null, publico: "TODOS" as const },
  ];

  it("manda push com o MOTIVO no corpo", async () => {
    const { s, escritas } = servico({ exigidos: UM, enviados: [{ tipo: "CNH" }] });
    await s.recusarDocumento("mot1", "e1", "a foto está cortada", "u1");

    const push = escritas.find((e) => e.tabela === "push")!.data;
    expect(push.tipo).toBe("documento-recusado");
    // O motivo vai no corpo: "mande de novo" sozinho faz a pessoa repetir o
    // mesmo erro.
    expect(push.corpo).toBe("a foto está cortada");
  });

  it("conferir NÃO manda push", async () => {
    // Conferir não pede nada dele. Avisar seria ruído — e ruído faz a pessoa
    // desligar a notificação, perdendo a que importa.
    const { s, escritas } = servico({ exigidos: UM, enviados: [{ tipo: "CNH" }] });
    await s.conferirDocumento("mot1", "e1", "u1");
    expect(escritas.some((e) => e.tabela === "push")).toBe(false);
  });
});

describe("o que se pede de registrado não é do cadastro de motorista", () => {
  /**
   * O papel de admissão CLT mora no cadastro de FUNCIONÁRIO. Se ele vazasse
   * pra lista do motorista, o arquivo que o motorista CLT mandasse iria pro
   * dono errado, e o registrado sem cadastro de motorista nunca o veria.
   */
  const MISTO = [
    { tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null, publico: "TODOS" as const },
    { tipo: "ESOCIAL", titulo: "Ficha de registro", obrigatorio: true, empresaId: null, publico: "REGISTRADOS" as const },
  ];

  it("a lista do motorista (tela dele e ficha do painel) não traz a de registrado", async () => {
    const { s } = servico({ exigidos: MISTO });
    const naTelaDele = await s.estadoDosDocumentos("mot1", { soDoPublicoDele: true });
    const naFicha = await s.estadoDosDocumentos("mot1");
    expect(naTelaDele.documentos.map((d) => d.titulo)).toEqual(["CNH"]);
    expect(naFicha.documentos.map((d) => d.titulo)).toEqual(["CNH"]);
  });

  it("e o motorista que não é registrado não consegue mandar a de registrado", async () => {
    const { s } = servico({ exigidos: MISTO });
    const idRegistro = (await s.listarExigidos()).find((e) => e.titulo === "Ficha de registro")!.id;
    await expect(
      s.receberDoMotorista("mot1", idRegistro, {
        buffer: Buffer.from("%PDF-1.4"),
        mimetype: "application/pdf",
        size: 8,
        originalname: "ficha.pdf",
      }),
    ).rejects.toThrow(/não é pedido pra você/);
  });
});
