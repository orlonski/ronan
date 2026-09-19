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
  exigidos?: { tipo: string; titulo: string; obrigatorio: boolean }[];
  enviados?: { tipo: string }[];
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
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        escritas.push({ tabela: "documento", data: create });
        return create;
      },
    },
    motorista: { findFirst: async () => ({ id: "mot1", nome: "João" }) },
  };
  const uploads = { putMotoristaDocumento: async () => "chave/no/minio" };
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

describe("a página pública não conta o que não deve", () => {
  it("lista o que FALTA e nunca o que já foi enviado", async () => {
    // Quem abre o link pode não ser o titular — o dono do caminhão é um caso
    // previsto. Link que exibe documento de gente é como documento vaza.
    const { s } = servico({
      exigidos: [
        { tipo: "CNH", titulo: "CNH", obrigatorio: true },
        { tipo: "ASO", titulo: "Exame", obrigatorio: true },
      ],
      enviados: [{ tipo: "CNH" }],
    });
    const r = await s.paginaPublica("tok");

    expect(r.faltando.map((f) => f.tipo)).toEqual(["ASO"]);
    expect(r.jaRecebidos).toBe(1);
    // Nenhum caminho de arquivo, nenhuma chave de storage, nenhum nome de
    // arquivo sai daqui.
    expect(JSON.stringify(r)).not.toMatch(/storageKey|minio|\.jpg/i);
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
    ).rejects.toThrow(/foto ou um PDF/i);
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
    expect(r).toEqual({ recebido: true, tipo: "CNH" });
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
