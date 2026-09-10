import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { PrecosService } from "./precos.service";

/**
 * A validação da tabela é regra pura sobre a lista que chega — não depende de
 * banco. O `prisma` só é tocado depois que tudo passa, e nestes casos nunca
 * chega lá.
 */
function servico(faixasNoBanco: unknown[] = []) {
  const prisma = {
    faixaPreco: {
      findMany: async () => faixasNoBanco,
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
  };
  return new PrecosService(prisma as never);
}

const faixa = (de: number, ate: number | null, centavos = 100_000) => ({
  deVeiculos: de,
  ateVeiculos: ate,
  valorCentavos: centavos,
});

describe("substituir — a tabela precisa cobrir toda frota, uma vez só", () => {
  it("recusa buraco entre faixas", async () => {
    // Com 6 caminhões ninguém responde.
    await expect(servico().substituir([faixa(1, 5), faixa(7, null)])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("recusa faixas que se sobrepõem", async () => {
    // Com 5 caminhões duas faixas respondem valores diferentes.
    await expect(servico().substituir([faixa(1, 5), faixa(5, null)])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("recusa tabela sem faixa aberta no fim", async () => {
    // Quem tem 30 caminhões — o cliente mais valioso — ficaria sem preço.
    await expect(servico().substituir([faixa(1, 5), faixa(6, 20)])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("recusa faixa aberta no meio", async () => {
    await expect(servico().substituir([faixa(1, null), faixa(6, null)])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("recusa faixa que termina antes de começar", async () => {
    await expect(servico().substituir([faixa(10, 5)])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("recusa tabela vazia", async () => {
    await expect(servico().substituir([])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("aceita tabela contínua e aberta no fim, em qualquer ordem de entrada", async () => {
    await expect(
      servico().substituir([faixa(21, null), faixa(1, 5), faixa(6, 20)]),
    ).resolves.toBeDefined();
  });

  it("aceita uma faixa só, se ela cobrir tudo", async () => {
    await expect(servico().substituir([faixa(1, null)])).resolves.toBeDefined();
  });
});

describe("precoPara", () => {
  const tabela = [
    { deVeiculos: 1, ateVeiculos: 5, valorCentavos: 89_000, rotulo: "Frota pequena" },
    { deVeiculos: 6, ateVeiculos: 20, valorCentavos: 189_000, rotulo: "Frota média" },
    { deVeiculos: 21, ateVeiculos: null, valorCentavos: 349_000, rotulo: "Frota grande" },
  ];

  it("acha a faixa certa nas bordas", async () => {
    const s = servico(tabela);
    expect((await s.precoPara(5))?.valorCentavos).toBe(89_000);
    expect((await s.precoPara(6))?.valorCentavos).toBe(189_000);
    expect((await s.precoPara(20))?.valorCentavos).toBe(189_000);
    expect((await s.precoPara(21))?.valorCentavos).toBe(349_000);
  });

  it("frota enorme cai na faixa aberta", async () => {
    expect((await servico(tabela).precoPara(500))?.valorCentavos).toBe(349_000);
  });

  it("tabela vazia devolve null em vez de inventar preço", async () => {
    // Quem chama tem que dizer "vou confirmar", nunca um número chutado.
    expect(await servico([]).precoPara(10)).toBeNull();
  });
});
