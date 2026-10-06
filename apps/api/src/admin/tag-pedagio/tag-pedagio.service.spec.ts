import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { comConta } from "../../common/conta/conta-context";
import { faturaExemplo, textoDaFatura } from "../../common/tag-pedagio/fatura-sintetica";
import { TagPedagioService } from "./tag-pedagio.service";

/**
 * Importação da fatura: idempotência (arquivo e nº da fatura), "a fatura é
 * desta empresa?" (raiz do CNPJ) e quem confirma praça pra todas as empresas.
 * O PDF é trocado pelo TEXTO SINTÉTICO — nenhum arquivo de cliente aqui.
 */

const pdf = vi.hoisted(() => ({ texto: "" }));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText() {
      return { text: pdf.texto };
    }
    async destroy() {}
  },
}));

type Extrato = { id: string; contaId: string; hashArquivo: string; numeroFatura: string | null; status: string; importadoEm: Date; passagens: number; [k: string]: unknown };

function montar(cnpjDaConta: string | null) {
  const extratos: Extrato[] = [];
  const passagens: unknown[] = [];
  const conta = () => "conta-A";
  const prisma = {
    extratoTag: {
      findUnique: vi.fn(async ({ where }: { where: { contaId_hashArquivo: { contaId: string; hashArquivo: string } } }) =>
        extratos.find((e) => e.contaId === where.contaId_hashArquivo.contaId && e.hashArquivo === where.contaId_hashArquivo.hashArquivo) ?? null,
      ),
      findFirst: vi.fn(async ({ where }: { where: { numeroFatura: string } }) =>
        extratos.find((e) => e.contaId === conta() && e.numeroFatura === where.numeroFatura && e.status !== "FALHOU") ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Partial<Extrato> }) => {
        const e = { id: `e${extratos.length + 1}`, contaId: conta(), importadoEm: new Date(), passagens: 0, ...data } as Extrato;
        extratos.push(e);
        return e;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => extratos.splice(extratos.findIndex((e) => e.id === where.id), 1)),
    },
    conta: { findUnique: vi.fn(async () => ({ cnpj: cnpjDaConta, nome: "Empresa A" })) },
    veiculo: { findMany: vi.fn(async () => [{ id: "v1", placa: "TST-1023" }]) },
    pedagioRodovia: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    pracaTagDePara: { upsert: vi.fn(async () => ({})) },
    pracaTagDeParaConta: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        extratoTag: { create: prisma.extratoTag.create },
        extratoTagVeiculo: { create: vi.fn(async () => ({})) },
        passagemTag: {
          createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
            passagens.push(...data);
            return { count: data.length };
          }),
        },
      }),
    ),
  };
  const uploads = { putFaturaTag: vi.fn(async () => "conta-A/tag-pedagio/x.pdf"), removerObjeto: vi.fn(async () => {}) };
  const motor = { processar: vi.fn(async () => ({ trechos: 0, achados: 0 })) };
  const svc = new TagPedagioService(prisma as never, uploads as never, motor as never);
  return { svc, prisma, uploads, motor, extratos, passagens };
}

const user = (plataforma = false) => ({ id: "u1", plataforma }) as never;
const arquivo = (conteudo = "pdf-1") => ({ buffer: Buffer.from(conteudo), originalname: "fatura.pdf", mimetype: "application/pdf" });

describe("importar fatura da tag", () => {
  beforeEach(() => {
    pdf.texto = textoDaFatura(faturaExemplo());
  });

  it("lê, guarda o PDF com nome sorteado e grava as linhas com a placa do cadastro (forma antiga)", async () => {
    const m = montar("12.345.678/0001-00");
    const r = await comConta("conta-A", () => m.svc.importar(arquivo(), false, user()));
    expect(r.jaImportado).toBe(false);
    expect(r.extrato.status).toBe("LIDO");
    expect(m.uploads.putFaturaTag).toHaveBeenCalledTimes(1);
    expect(m.passagens).toHaveLength(11 + 4 + 4 + 3);
    const a = m.passagens.filter((p) => (p as { placaTexto: string }).placaTexto === "TST1A23");
    expect(a.every((p) => (p as { veiculoId: string }).veiculoId === "v1")).toBe(true);
    expect(m.motor.processar).toHaveBeenCalled();
  });

  it("o mesmo arquivo de novo não grava nada; a mesma fatura re-baixada também não", async () => {
    const m = montar("12.345.678/0001-00");
    await comConta("conta-A", () => m.svc.importar(arquivo(), false, user()));
    const de_novo = await comConta("conta-A", () => m.svc.importar(arquivo(), false, user()));
    expect(de_novo.jaImportado).toBe(true);
    const rebaixada = await comConta("conta-A", () => m.svc.importar(arquivo("pdf-1-rebaixado"), false, user()));
    expect(rebaixada.jaImportado).toBe(true);
    expect(rebaixada.motivo).toMatch(/já foi importada/);
    expect(m.extratos).toHaveLength(1);
  });

  it("o mesmo arquivo em OUTRA empresa não é 'já importado' (o hash é por conta)", async () => {
    const m = montar("12.345.678/0001-00");
    m.extratos.push({ id: "x", contaId: "conta-B", hashArquivo: "?", numeroFatura: "1", status: "LIDO", importadoEm: new Date(), passagens: 0 });
    const r = await comConta("conta-A", () => m.svc.importar(arquivo(), false, user()));
    expect(r.jaImportado).toBe(false);
  });

  it("CNPJ de outra empresa: pede confirmação explícita mostrando o nome lido", async () => {
    const m = montar("99.999.999/0001-99");
    await expect(comConta("conta-A", () => m.svc.importar(arquivo(), false, user()))).rejects.toMatchObject({
      response: { code: "CNPJ_DIFERENTE", nomeLido: "Transportadora Exemplo Ltda" },
    });
    expect(m.passagens).toHaveLength(0);
    const ok = await comConta("conta-A", () => m.svc.importar(arquivo(), true, user()));
    expect(ok.extrato.status).toBe("LIDO");
  });

  it("FALHOU fica na lista com o motivo, sem passagem e sem PDF guardado", async () => {
    pdf.texto = "Um documento qualquer\nsem fatura nenhuma";
    const m = montar("12.345.678/0001-00");
    const r = await comConta("conta-A", () => m.svc.importar(arquivo(), false, user()));
    expect(r.extrato.status).toBe("FALHOU");
    expect(r.motivo).toBeTruthy();
    expect(m.passagens).toHaveLength(0);
    expect(m.uploads.putFaturaTag).not.toHaveBeenCalled();
  });
});

describe("confirmar praça", () => {
  it("a empresa confirma pra ELA; pra todas, só a equipe da plataforma", async () => {
    const m = montar(null);
    const input = { operadora: "SEM_PARAR", chavePraca: "MT246|119000", pedagioRodoviaId: "p1" };
    await comConta("conta-A", () => m.svc.confirmarPraca(input, user()));
    expect(m.prisma.pracaTagDeParaConta.upsert).toHaveBeenCalledTimes(1);
    await expect(comConta("conta-A", () => m.svc.confirmarPraca({ ...input, global: true }, user()))).rejects.toThrow(/equipe da Movatruck/);
    expect(m.prisma.pracaTagDePara.upsert).not.toHaveBeenCalled();
    await comConta("conta-A", () => m.svc.confirmarPraca({ ...input, global: true }, user(true)));
    expect(m.prisma.pracaTagDePara.upsert).toHaveBeenCalledTimes(1);
  });

  it("ligar a ligação automática é decisão da plataforma, não da empresa", async () => {
    const m = montar(null);
    await expect(comConta("conta-A", () => m.svc.salvarConfiguracao(true, user()))).rejects.toThrow(/Movatruck/);
  });
});
