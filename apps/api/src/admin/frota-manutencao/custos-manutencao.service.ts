import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";
import { mesSP, resumirCustoManutencao, type ResumoCustoManutencao } from "../../common/custo-manutencao";
import { inicioDoDiaBR } from "../../common/timezone";

/**
 * A aba "Custos" da Manutenção. Busca e entrega pro `resumirCustoManutencao`
 * (common/custo-manutencao.ts), que é quem agrupa.
 *
 * Conserto entra pela data em que foi CONCLUÍDO: é quando o dinheiro saiu (ou
 * virou conta a pagar). Aberto e em andamento ainda não custaram nada.
 */
@Injectable()
export class CustosManutencaoService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo(
    q: { de: string; ate: string; veiculoId?: string },
    escopo: EscopoAdmin,
  ): Promise<ResumoCustoManutencao & { periodo: { de: string; ate: string } }> {
    const veiculos = await this.prisma.veiculo.findMany({
      where: {
        ...(filtroEscopo(escopo) as Prisma.VeiculoWhereInput),
        ...(q.veiculoId ? { id: q.veiculoId } : {}),
      },
      select: { id: true, placa: true, modelo: true },
    });
    const ids = veiculos.map((v) => v.id);

    const inicio = inicioDoDiaBR(q.de);
    const fimExclusivo = new Date(inicioDoDiaBR(q.ate).getTime() + 86_400_000);

    const [manutencoes, km] = await Promise.all([
      this.prisma.manutencaoVeiculo.findMany({
        where: {
          veiculoId: { in: ids },
          status: "CONCLUIDA",
          concluidaEm: { gte: inicio, lt: fimExclusivo },
        },
        select: {
          id: true,
          veiculoId: true,
          tipo: true,
          concluidaEm: true,
          valorTotal: true,
          descricao: true,
          fornecedor: { select: { nome: true } },
          plano: { select: { descricao: true } },
        },
      }),
      // Mesmo critério de km do prontuário do caminhão: o km das viagens.
      // Viagem.data é @db.Date (meia-noite UTC), então o período vai em dias.
      this.prisma.viagem.groupBy({
        by: ["veiculoId"],
        where: {
          veiculoId: { in: ids },
          data: { gte: new Date(`${q.de}T00:00:00Z`), lte: new Date(`${q.ate}T00:00:00Z`) },
          status: { not: "RASCUNHO_OFFLINE" },
        },
        _sum: { km: true },
      }),
    ]);

    const resumo = resumirCustoManutencao({
      manutencoes: manutencoes.map((m) => ({
        id: m.id,
        veiculoId: m.veiculoId,
        tipo: m.tipo,
        concluidaEm: m.concluidaEm!,
        valorTotal: m.valorTotal != null ? Number(m.valorTotal) : null,
        descricao: m.descricao,
        fornecedorNome: m.fornecedor?.nome ?? null,
        planoDescricao: m.plano?.descricao ?? null,
      })),
      veiculos,
      kmPorVeiculo: new Map(km.map((k) => [k.veiculoId, Number(k._sum.km ?? 0)])),
      mesDe: q.de.slice(0, 7),
      mesAte: mesSP(new Date(fimExclusivo.getTime() - 1)),
    });
    return { periodo: { de: q.de, ate: q.ate }, ...resumo };
  }
}
