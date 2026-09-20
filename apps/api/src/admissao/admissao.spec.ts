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
  enviados?: { tipo: string; storageKey?: string }[];
  assinaturas?: { tipoDocumento: string; modo: string; assinadoEm: Date }[];
  arquivoGuardado?: Buffer;
} = {}) {
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
    alocacaoObra: { findFirst: async () => null },
    documentoExigido: {
      findMany: async () =>
        over.exigidos ?? [{ tipo: "CNH", titulo: "CNH", obrigatorio: true, empresaId: null }],
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
    motoristaDocumento: {
      findMany: async () => over.enviados ?? [],
      findFirst: async () => over.enviados?.[0] ?? null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        escritas.push({ tabela: "documento", data: create });
        return create;
      },
    },
    motorista: { findFirst: async () => ({ id: "mot1", nome: "João", cpf: "11122233344" }) },
    assinaturaDocumento: {
      findMany: async () => over.assinaturas ?? [],
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
    await expect(s.receberArquivo("tok", "CNH", ARQUIVO)).rejects.toThrow(
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
    await expect(s.receberArquivo("tok", "ASO", ARQUIVO)).rejects.toThrow(/não é pedido aqui/i);
    expect(escritas.filter((e) => e.tabela === "documento")).toHaveLength(0);
  });

  it("recusa tipo de arquivo que não é foto nem PDF", async () => {
    const { s } = servico();
    await expect(
      s.receberArquivo("tok", "CNH", { ...ARQUIVO, mimetype: "application/x-msdownload" }),
    ).rejects.toThrow(/foto, um PDF ou o arquivo assinado/i);
  });

  it("recusa arquivo grande demais", async () => {
    const { s } = servico();
    await expect(
      s.receberArquivo("tok", "CNH", { ...ARQUIVO, size: 30 * 1024 * 1024 }),
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
    await expect(s.receberArquivo("tok", "CNH", ARQUIVO)).rejects.toThrow(/arquivos demais/i);
  });

  it("aceita o documento pedido e grava na gaveta certa", async () => {
    const { s, escritas } = servico();
    const r = await s.receberArquivo("tok", "CNH", ARQUIVO);
    expect(r).toEqual({ recebido: true, tipo: "CNH", assinaturaEmbutida: false });
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
      s.receberArquivo("tok", "CNH", {
        buffer: Buffer.from("%PDF-1.4 nada assinado aqui"),
        mimetype: "application/pdf",
        size: 100,
        originalname: "contrato.pdf",
      }),
    ).rejects.toThrow(/certificado digital/i);
  });

  it("documento com ICP aceita .p7s e já registra a assinatura", async () => {
    const { s, escritas } = servico({ exigidos: EXIGE_ICP });
    const r = await s.receberArquivo("tok", "CNH", {
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
      s.receberArquivo("tok", "CNH", {
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimetype: "application/octet-stream",
        size: 3,
        originalname: "cnh.jpg.p7s",
      }),
    ).rejects.toThrow(/não tem assinatura digital dentro/i);
  });
});
