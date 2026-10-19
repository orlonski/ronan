import type { PrismaClient } from "@prisma/client";

/**
 * Quando o ticket de uma viagem muda, as OUTRAS que apontavam pra ela como
 * "ticket repetido" ficam com o carimbo velho: o aviso seguia dizendo "o número
 * 9346 já foi lançado em outra viagem" e o link abria a viagem 9345. O carimbo
 * só era refeito pra quem mudava o PRÓPRIO ticket.
 *
 * Aqui cada apontadora que deixou de bater com o ticket novo é recarimbada: aponta
 * pra a mais antiga que ainda tem o mesmo número na empresa, ou fica sem carimbo.
 * O aceite anterior ("Aceitar duplicidade") não vale mais — a duplicidade é outra.
 */
export async function recarimbarApontadoras(
  prisma: Pick<PrismaClient, "viagem">,
  viagemId: string,
  ticketNovo: string | null,
): Promise<void> {
  const velhas = await prisma.viagem.findMany({
    where: {
      ticketDuplicadoDeId: viagemId,
      ...(ticketNovo ? { ticket: { not: ticketNovo } } : {}),
    },
    select: { id: true, ticket: true, cliente: { select: { empresaId: true } } },
  });
  for (const v of velhas) {
    const outra =
      v.ticket && v.cliente
        ? await prisma.viagem.findFirst({
            where: {
              id: { notIn: [v.id, viagemId] },
              ticket: v.ticket,
              cliente: { empresaId: v.cliente.empresaId },
            },
            orderBy: { sincronizadoEm: "asc" },
            select: { id: true },
          })
        : null;
    await prisma.viagem.update({
      where: { id: v.id },
      data: { ticketDuplicadoDeId: outra?.id ?? null, duplicidadeAceitaEm: null },
    });
  }
}
