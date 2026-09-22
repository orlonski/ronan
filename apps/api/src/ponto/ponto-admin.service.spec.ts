import { describe, expect, it } from "vitest";
import { comConta } from "../common/conta/conta-context";
import { PontoAdminService } from "./ponto-admin.service";

/** O recálculo do acesso do app não interessa a estes testes. */
const SEM_ACESSO_APP = { agendarRecalculo: () => {} } as never;

/**
 * A config do ponto nasce no primeiro acesso à tela — e nasceu quebrada.
 *
 * `Conta` está em MODELS_GLOBAIS: a trava multi-tenant não injeta `contaId`
 * nela, e `findFirst` sem `where` LANÇA (`exigirAlvo`). Sem alvo, a config de
 * uma empresa poderia nascer com a razão social de outra — por isso a trava
 * prefere explodir. Deu 500 no primeiro acesso real à tela.
 */
describe("a config do ponto nasce certa", () => {
  it("busca a conta COM alvo no where — sem isso a trava lança", async () => {
    const wheres: unknown[] = [];
    const prisma = {
      configPonto: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => data,
      },
      conta: {
        findFirst: async (args: { where?: unknown }) => {
          wheres.push(args?.where);
          // Espelha o `exigirAlvo` da trava: model global sem where lança.
          if (!args?.where) throw new Error("findFirst em model global exige alvo no where");
          return { nome: "Movatruck", cnpj: "00000000000191" };
        },
      },
      motivoCorrecaoPonto: { create: async () => ({}) },
      feriadoPonto: { create: async () => ({}) },
    };
    const s = new PontoAdminService(prisma as never, { log: async () => {} } as never, SEM_ACESSO_APP);
    // `await` DENTRO do run: a promise do Prisma é preguiçosa, e devolvê-la
    // pra fora faria a consulta rodar sem conta no contexto.
    const cfg = await comConta("c1", async () => s.config());
    expect(wheres[0]).toBeTruthy();
    expect((cfg as { razaoSocial: string }).razaoSocial).toBe("Movatruck");
  });

  it("devolve a config existente sem recriar nada", async () => {
    let criou = 0;
    const prisma = {
      configPonto: {
        findFirst: async () => ({ contaId: "c1", razaoSocial: "X", fundamento: null }),
        create: async () => {
          criou++;
          return {};
        },
      },
      conta: { findFirst: async () => ({ nome: "X", cnpj: "1" }) },
    };
    const s = new PontoAdminService(prisma as never, { log: async () => {} } as never, SEM_ACESSO_APP);
    await comConta("c1", async () => s.config());
    expect(criou).toBe(0);
  });
});
