import type { PrismaService } from "../../prisma/prisma.service";
import { pedagioPelaTag, type ReguaPedagioTag } from "./pedagio-lancado";
import { tagDasViagens } from "./tag-das-viagens";

/**
 * Mantém `Viagem.pedagioPelaTag` em dia: o pedágio da viagem pela fatura da
 * tag, na régua do cliente (ida, volta ou as duas). É o número que a fatura do
 * cliente, a planilha de fechamento e o relatório leem — sem ele, o motorista
 * que não lança pedágio (porque não saiu do bolso dele) deixava a empresa
 * pagando o pedágio sozinha.
 *
 * Roda depois de cada processamento da fatura, de cada decisão de ligação e
 * quando o cliente muda a régua. `ids` ausente = todas as viagens com passagem
 * ligada ou com valor da tag gravado (pra limpar quem perdeu a ligação).
 *
 * Viagem já conciliada num fechamento NÃO muda: o número dela já foi pro
 * cliente. Mesma régua do reprocessamento de km.
 *
 * Sem o módulo da tag, não mexe em nada (o que estava gravado fica; quem lê
 * passa a ver o lançado só se o valor for limpo de propósito).
 */
export async function atualizarPedagioPelaTag(
  prisma: PrismaService,
  precificar: (viagemId: string) => Promise<void>,
  ids?: string[],
): Promise<number> {
  const alvo =
    ids ??
    [
      ...new Set([
        ...(
          await prisma.ligacaoTagViagem.findMany({
            where: { desfeitaEm: null, viagemId: { not: null } },
            select: { viagemId: true },
          })
        ).map((l) => l.viagemId!),
        ...(await prisma.viagem.findMany({ where: { pedagioPelaTag: { not: null } }, select: { id: true } })).map((v) => v.id),
      ]),
    ];
  if (alvo.length === 0) return 0;

  const viagens = await prisma.viagem.findMany({
    where: { id: { in: alvo } },
    select: {
      id: true,
      data: true,
      veiculoId: true,
      pedagioPelaTag: true,
      cliente: { select: { empresa: { select: { pedagioTagRepasse: true } } } },
      _count: { select: { matchesFechamento: true } },
    },
  });
  const tag = await tagDasViagens(prisma, viagens);
  if (!tag) return 0;

  let mudaram = 0;
  for (const v of viagens) {
    if (v._count.matchesFechamento > 0) continue;
    const regua: ReguaPedagioTag = v.cliente?.empresa?.pedagioTagRepasse ?? "IDA";
    const novo = pedagioPelaTag(tag.get(v.id)?.cobertura, regua);
    const atual = v.pedagioPelaTag;
    const igual = novo == null ? atual == null : atual != null && atual.eq(novo);
    if (igual) continue;
    await prisma.viagem.update({ where: { id: v.id }, data: { pedagioPelaTag: novo } });
    // O pedágio é insumo do preço quando a tabela repassa pedágio.
    await precificar(v.id);
    mudaram++;
  }
  return mudaram;
}
