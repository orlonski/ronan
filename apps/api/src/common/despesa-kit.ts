import { Prisma } from "@prisma/client";
import { KIT_TIPOS_DESPESA } from "@ronan/shared-types";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * O kit inicial de tipos de gasto ("Alimentação", "Borracharia"…) numa conta.
 *
 * Idempotente (`skipDuplicates` pelo `@@unique([contaId, slug])`): ligar,
 * desligar e ligar de novo não duplica nem desfaz o que a empresa editou —
 * tipo renomeado ou desativado continua como ela deixou. Roda quando a
 * plataforma LIGA o módulo `despesas` (ModulosService.definir); nunca por
 * migration, nunca no boot. Constante só como seed (nada chumbado).
 */
export async function semearKitDespesas(prisma: PrismaService, contaId: string): Promise<number> {
  const r = await prisma.tipoDespesa.createMany({
    data: KIT_TIPOS_DESPESA.map((t, i) => ({
      contaId,
      slug: t.slug,
      nome: t.nome,
      icone: t.icone,
      ordem: (i + 1) * 10,
      devolve: t.devolve,
      manutencao: t.manutencao,
      podeCobrarCliente: t.podeCobrarCliente,
      campos: t.campos as unknown as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  return r.count;
}
