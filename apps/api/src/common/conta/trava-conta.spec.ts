import { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { comConta, comoSistema } from "./conta-context";
import { travaConta } from "./trava-conta";

/**
 * O que este teste protege: **nenhuma linha nasce sem dono**.
 *
 * A trava carimba o `contaId` em toda escrita. O jeito de descobrir que ela
 * deixou passar era o pior possível — chave estrangeira estourando em produção,
 * traduzida pra "um dos itens escolhidos não existe mais", que manda o motorista
 * procurar um cadastro sumido que nunca sumiu. Foi assim que TODA viagem guiada
 * finalizada com foto de ticket falhou por dois dias: `viagem.update` com
 * `fotos: { create }` grava uma linha NOVA, e `update` não estava na lista de
 * escritas.
 *
 * Por isso o teste olha os ARGUMENTOS que a trava produz, e não o resultado da
 * consulta: dá pra cobrir toda forma de aninhamento sem banco nenhum, e falha na
 * hora em que alguém mexer na trava — não meses depois, no celular de alguém.
 */

const CONTA = "conta-teste";

/** Intercepta antes do banco e devolve os args já transformados pela trava. */
const espiao = Prisma.defineExtension({
  name: "espiao",
  query: {
    $allModels: {
      $allOperations({ args }) {
        return Promise.resolve(args as never);
      },
    },
  },
});

const prisma = new PrismaClient().$extends(travaConta).$extends(espiao);
const argsDe = async (fn: () => Promise<unknown>) =>
  (await comConta(CONTA, fn)) as Record<string, any>;

describe("trava de conta — carimbo do contaId", () => {
  it("carimba no create simples", async () => {
    const a = await argsDe(() =>
      prisma.viagem.create({ data: { clientId: "c1" } as never }),
    );
    expect(a.data.contaId).toBe(CONTA);
  });

  it("carimba no create ANINHADO dentro de create", async () => {
    const a = await argsDe(() =>
      prisma.viagem.create({
        data: { clientId: "c1", fotos: { create: { storageKey: "a.jpg" } } } as never,
      }),
    );
    expect(a.data.fotos.create.contaId).toBe(CONTA);
  });

  // O caso que quebrou em produção.
  it("carimba no create ANINHADO dentro de update", async () => {
    const a = await argsDe(() =>
      prisma.viagem.update({
        where: { id: "v1" },
        data: { km: 10, fotos: { create: { storageKey: "a.jpg" } } } as never,
      }),
    );
    expect(a.data.fotos.create.contaId).toBe(CONTA);
    // A linha alterada já tem dono: carimbar o topo do update seria mentira útil
    // pra ninguém, e mascararia um update cruzando de conta.
    expect(a.data.contaId).toBeUndefined();
  });

  it("carimba lista de creates aninhados dentro de update", async () => {
    const a = await argsDe(() =>
      prisma.viagem.update({
        where: { id: "v1" },
        data: {
          trechos: { deleteMany: {}, create: [{ ordem: 1 }, { ordem: 2 }] },
        } as never,
      }),
    );
    for (const t of a.data.trechos.create) expect(t.contaId).toBe(CONTA);
  });

  it("carimba createMany aninhado dentro de update", async () => {
    const a = await argsDe(() =>
      prisma.viagem.update({
        where: { id: "v1" },
        data: { pontos: { createMany: { data: [{ lat: 1, lng: 2 }] } } } as never,
      }),
    );
    expect(a.data.pontos.createMany.data[0].contaId).toBe(CONTA);
  });

  it("carimba o create do upsert e desce no lado update dele", async () => {
    const a = await argsDe(() =>
      prisma.viagem.upsert({
        where: { clientId: "c1" },
        create: { clientId: "c1" } as never,
        update: { fotos: { create: { storageKey: "a.jpg" } } } as never,
      }),
    );
    expect(a.create.contaId).toBe(CONTA);
    expect(a.update.fotos.create.contaId).toBe(CONTA);
    expect(a.update.contaId).toBeUndefined();
  });

  it("filtra por conta na leitura", async () => {
    const a = await argsDe(() => prisma.viagem.findMany({ where: { km: 1 } as never }));
    expect(a.where.AND).toContainEqual({ contaId: CONTA });
  });

  it("não carimba nem filtra model global", async () => {
    const a = await argsDe(() =>
      prisma.rotaCache.create({ data: { chave: "x" } as never }),
    );
    expect(a.data.contaId).toBeUndefined();
  });

  it("comoSistema atravessa contas de propósito", async () => {
    const a = (await comoSistema(() =>
      prisma.viagem.findMany({ where: { km: 1 } as never }),
    )) as Record<string, any>;
    expect(a.where.AND).toBeUndefined();
  });
});
