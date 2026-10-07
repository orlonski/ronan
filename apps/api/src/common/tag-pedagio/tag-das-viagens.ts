import { Prisma } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import { modulosDaConta } from "../conta/teto-da-conta";
import { contaIdAtual } from "../conta/conta-context";
import type { CoberturaTag } from "./pedagio-lancado";

export type TagDaViagem = {
  temTag: boolean;
  faturaCobreODia: boolean;
  cobertura: CoberturaTag | null;
};

/**
 * Pra cada viagem: o caminhão tem tag (aparece em alguma fatura importada), a
 * fatura do dia já chegou, e quanto a tag e o vale pagaram nas passagens
 * LIGADAS a ela. Só ligação feita conta — sugestão do cruzamento nunca mexe em
 * dinheiro: só passa a valer quando alguém aceita. "Não é viagem" não conta.
 *
 * null = a conta não tem o módulo da tag: quem chama segue como antes, sem
 * nenhuma conferência. Módulo cancelado volta ao comportamento antigo, com as
 * decisões já tomadas guardadas.
 */
export async function tagDasViagens(
  prisma: PrismaService,
  viagens: Array<{ id: string; data: Date | null; veiculoId: string | null }>,
): Promise<Map<string, TagDaViagem> | null> {
  const modulos = await modulosDaConta(prisma, contaIdAtual());
  if (!modulos.has("tag-pedagio")) return null;
  const out = new Map<string, TagDaViagem>();
  if (viagens.length === 0) return out;

  const veiculoIds = [...new Set(viagens.map((v) => v.veiculoId).filter((x): x is string => !!x))];
  const [placas, ligacoes] = await Promise.all([
    veiculoIds.length
      ? prisma.extratoTagVeiculo.findMany({
          where: { veiculoId: { in: veiculoIds }, extrato: { status: { not: "FALHOU" } } },
          select: { veiculoId: true, extrato: { select: { periodoDe: true, periodoAte: true } } },
        })
      : Promise.resolve([]),
    prisma.ligacaoTagViagem.findMany({
      where: { viagemId: { in: viagens.map((v) => v.id) }, desfeitaEm: null, tipo: { not: "NAO_E_VIAGEM" } },
      select: { viagemId: true, passagemAncoraId: true, tipo: true },
    }),
  ]);
  const trechos = ligacoes.length
    ? await prisma.trechoTag.findMany({
        where: { passagemAncoraId: { in: ligacoes.map((l) => l.passagemAncoraId) } },
        select: { passagemAncoraId: true, valorTag: true, valorVale: true },
      })
    : [];
  const trechoDe = new Map(trechos.map((t) => [t.passagemAncoraId, t]));

  const periodosDe = new Map<string, Array<{ de: Date | null; ate: Date | null }>>();
  for (const p of placas) {
    if (!p.veiculoId) continue;
    periodosDe.set(p.veiculoId, [...(periodosDe.get(p.veiculoId) ?? []), { de: p.extrato.periodoDe, ate: p.extrato.periodoAte }]);
  }
  const zero = () => new Prisma.Decimal(0);
  const cobertura = new Map<
    string,
    {
      tag: Prisma.Decimal;
      vale: Prisma.Decimal;
      retorno: Prisma.Decimal;
      trechos: number;
      trechosIda: number;
      trechosVolta: number;
    }
  >();
  for (const l of ligacoes) {
    const t = trechoDe.get(l.passagemAncoraId);
    if (!t || !l.viagemId) continue;
    const c = cobertura.get(l.viagemId) ?? { tag: zero(), vale: zero(), retorno: zero(), trechos: 0, trechosIda: 0, trechosVolta: 0 };
    // A volta vazia fica à parte: não entra na sugestão (ver CoberturaTag). Só
    // a tag dela: vale na volta (raro) é do contratante, não pedágio da empresa.
    if (l.tipo === "RETORNO") {
      cobertura.set(l.viagemId, { ...c, retorno: c.retorno.add(t.valorTag), trechos: c.trechos + 1, trechosVolta: c.trechosVolta + 1 });
    } else {
      cobertura.set(l.viagemId, {
        ...c,
        tag: c.tag.add(t.valorTag),
        vale: c.vale.add(t.valorVale),
        trechos: c.trechos + 1,
        trechosIda: c.trechosIda + 1,
      });
    }
  }

  for (const v of viagens) {
    const periodos = v.veiculoId ? (periodosDe.get(v.veiculoId) ?? []) : [];
    const dia = v.data?.toISOString().slice(0, 10) ?? null;
    out.set(v.id, {
      temTag: periodos.length > 0,
      faturaCobreODia:
        !!dia &&
        periodos.some(
          (p) =>
            p.de && p.ate && p.de.toISOString().slice(0, 10) <= dia && dia <= p.ate.toISOString().slice(0, 10),
        ),
      cobertura: cobertura.get(v.id) ?? null,
    });
  }
  return out;
}
