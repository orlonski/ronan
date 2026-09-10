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

/**
 * O bug que este bloco fecha: o convite por CPF lia o nome da empresa com
 * `conta.findFirstOrThrow({ select: { nome: true } })`. `Conta` é global, a
 * trava não filtra — e o motorista recebeu "«outra transportadora» quer te
 * adicionar". Nome de empresa aparecendo pra quem não é dela é vazamento, e o
 * jeito de descobrir foi um motorista lendo a notificação.
 */
describe("trava de conta — model global exige alvo", () => {
  it("recusa findFirst sem where dentro de uma requisição", async () => {
    await expect(
      argsDe(() => prisma.conta.findFirst({ select: { nome: true } })),
    ).rejects.toThrow(/sem `where` dentro de uma requisição/);
  });

  it("recusa findFirstOrThrow com where vazio", async () => {
    await expect(argsDe(() => prisma.conta.findFirstOrThrow({ where: {} }))).rejects.toThrow(
      /AlvoGlobalAusenteError|sem `where`/,
    );
  });

  it("aceita quando o alvo está citado", async () => {
    const a = await argsDe(() =>
      prisma.conta.findFirst({ where: { id: "conta-x" }, select: { nome: true } }),
    );
    expect(a.where).toEqual({ id: "conta-x" });
    // Global: nem filtro de conta injetado, nem carimbo.
    expect(a.where.contaId).toBeUndefined();
  });

  it("deixa passar fora de requisição (boot, script, cron)", async () => {
    const a = (await comoSistema(() =>
      prisma.conta.findFirst({ orderBy: { criadaEm: "asc" } as never }),
    )) as Record<string, any>;
    expect(a.orderBy).toEqual({ criadaEm: "asc" });
  });

  it("não atrapalha listagem — a tela de Empresas lista de propósito", async () => {
    const a = await argsDe(() => prisma.conta.findMany({ orderBy: { nome: "asc" } as never }));
    expect(a.where).toBeUndefined();
  });

  it("vale pros outros models globais, não só pra Conta", async () => {
    await expect(argsDe(() => prisma.motoristaIdentidade.findFirst({}))).rejects.toThrow(
      /sem `where`/,
    );
  });
});
