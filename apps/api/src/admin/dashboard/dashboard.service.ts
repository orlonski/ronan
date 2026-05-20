import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Service do dashboard executivo. Tudo em paralelo via Promise.all —
 * é uma tela de leitura, latência manda. Datas usam fuso local do servidor
 * (não UTC): viagem é diária, sem hora exata.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot() {
    const agora = new Date();
    const hoje00 = inicioDoDia(agora);
    const amanha00 = adicionarDias(hoje00, 1);
    const inicioMes = inicioDoMes(agora);
    const inicioMesQueVem = inicioDoMes(adicionarDias(inicioMes, 32));
    const inicio14d = inicioDoDia(adicionarDias(agora, -13)); // hoje incluso = 14 dias

    const [
      // Hoje
      viagensHoje,
      toneladasHoje,
      motoristasAtivosHoje,
      veiculosHoje,
      // Mês
      viagensMes,
      toneladasMes,
      combustivelMes,
      pedagioMes,
      // Pendências
      fechamentosRevisao,
      enviosAbertos,
      viagensDivergentes,
      errosPendentesGroups,
      // Tendência
      tendenciaRows,
      // Rankings
      rankingMotoristasRaw,
      rankingClientesRaw,
      rankingMateriaisRaw,
      // Última atividade
      ultimaViagem,
      ultimoAbastecimento,
      ultimoFechamento,
    ] = await Promise.all([
      this.prisma.viagem.count({ where: { data: { gte: hoje00, lt: amanha00 } } }),
      this.prisma.viagem.aggregate({
        where: { data: { gte: hoje00, lt: amanha00 } },
        _sum: { toneladas: true },
      }),
      this.prisma.motorista.count({ where: { ultimoLoginEm: { gte: hoje00 } } }),
      this.prisma.viagem.findMany({
        where: { data: { gte: hoje00, lt: amanha00 } },
        distinct: ["veiculoId"],
        select: { veiculoId: true },
      }),
      this.prisma.viagem.count({ where: { data: { gte: inicioMes, lt: inicioMesQueVem } } }),
      this.prisma.viagem.aggregate({
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _sum: { toneladas: true },
      }),
      this.prisma.abastecimento.aggregate({
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _sum: { valorTotal: true },
      }),
      this.prisma.pedagio.aggregate({
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _sum: { valor: true },
      }),
      this.prisma.fechamento.count({ where: { status: "AGUARDANDO_REVISAO" } }),
      this.prisma.envioFechamento.count({ where: { status: "GERADO" } }),
      this.prisma.viagem.count({ where: { status: "DIVERGENTE" } }),
      this.prisma.errorLog.groupBy({
        by: ["hash"],
        where: { resolvido: false },
        _count: { _all: true },
      }),
      this.prisma.viagem.groupBy({
        by: ["data"],
        where: { data: { gte: inicio14d, lt: amanha00 } },
        _count: { _all: true },
      }),
      this.prisma.viagem.groupBy({
        by: ["motoristaId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _sum: { toneladas: true },
        orderBy: { _sum: { toneladas: "desc" } },
        take: 5,
      }),
      this.prisma.viagem.groupBy({
        by: ["clienteId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _count: { _all: true },
        orderBy: { _count: { clienteId: "desc" } },
        take: 5,
      }),
      this.prisma.viagem.groupBy({
        by: ["materialId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _sum: { toneladas: true },
        orderBy: { _sum: { toneladas: "desc" } },
        take: 5,
      }),
      this.prisma.viagem.findFirst({
        orderBy: { sincronizadoEm: "desc" },
        select: { sincronizadoEm: true },
      }),
      this.prisma.abastecimento.findFirst({
        orderBy: { sincronizadoEm: "desc" },
        select: { sincronizadoEm: true },
      }),
      this.prisma.fechamento.findFirst({
        orderBy: { criadoEm: "desc" },
        select: { criadoEm: true },
      }),
    ]);

    // Resolve nomes dos rankings em um round adicional (ids únicos, ~15 registros)
    const motoristaIds = rankingMotoristasRaw.map((r) => r.motoristaId);
    const clienteIds = rankingClientesRaw.map((r) => r.clienteId);
    const materialIds = rankingMateriaisRaw.map((r) => r.materialId);

    const [motoristasNomes, clientesNomes, materiaisNomes] = await Promise.all([
      motoristaIds.length
        ? this.prisma.motorista.findMany({
            where: { id: { in: motoristaIds } },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
      clienteIds.length
        ? this.prisma.cliente.findMany({
            where: { id: { in: clienteIds } },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
      materialIds.length
        ? this.prisma.material.findMany({
            where: { id: { in: materialIds } },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
    ]);

    const nomeMotorista = new Map(motoristasNomes.map((m) => [m.id, m.nome]));
    const nomeCliente = new Map(clientesNomes.map((c) => [c.id, c.nome]));
    const nomeMaterial = new Map(materiaisNomes.map((m) => [m.id, m.nome]));

    return {
      hoje: {
        viagens: viagensHoje,
        toneladas: (toneladasHoje._sum.toneladas ?? 0).toString(),
        motoristasAtivos: motoristasAtivosHoje,
        veiculosEmUso: veiculosHoje.length,
      },
      mes: {
        viagens: viagensMes,
        toneladas: (toneladasMes._sum.toneladas ?? 0).toString(),
        combustivelValor: (combustivelMes._sum.valorTotal ?? 0).toString(),
        pedagioValor: (pedagioMes._sum.valor ?? 0).toString(),
      },
      pendencias: {
        fechamentosRevisao,
        enviosAbertos,
        viagensDivergentes,
        errosPendentes: errosPendentesGroups.length,
      },
      tendenciaViagens: preencherDias(tendenciaRows, inicio14d, 14),
      rankings: {
        motoristas: rankingMotoristasRaw.map((r) => ({
          id: r.motoristaId,
          nome: nomeMotorista.get(r.motoristaId) ?? "—",
          toneladas: (r._sum.toneladas ?? 0).toString(),
        })),
        clientes: rankingClientesRaw.map((r) => ({
          id: r.clienteId,
          nome: nomeCliente.get(r.clienteId) ?? "—",
          viagens: r._count._all,
        })),
        materiais: rankingMateriaisRaw.map((r) => ({
          id: r.materialId,
          nome: nomeMaterial.get(r.materialId) ?? "—",
          toneladas: (r._sum.toneladas ?? 0).toString(),
        })),
      },
      ultimaAtividade: {
        ultimaViagemEm: ultimaViagem?.sincronizadoEm.toISOString() ?? null,
        ultimoAbastecimentoEm: ultimoAbastecimento?.sincronizadoEm.toISOString() ?? null,
        ultimoFechamentoEm: ultimoFechamento?.criadoEm.toISOString() ?? null,
      },
    };
  }
}

function inicioDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function inicioDoMes(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function adicionarDias(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Recebe linhas { data, _count } com furos e devolve array completo de N dias
 * a partir de `inicio`, ordenado asc, com 0 nos dias sem viagem.
 */
function preencherDias(
  linhas: Array<{ data: Date; _count: { _all: number } }>,
  inicio: Date,
  n: number,
): Array<{ dia: string; total: number }> {
  const mapa = new Map<string, number>();
  for (const r of linhas) {
    const k = inicioDoDia(r.data).toISOString().slice(0, 10);
    mapa.set(k, (mapa.get(k) ?? 0) + r._count._all);
  }
  const out: Array<{ dia: string; total: number }> = [];
  for (let i = 0; i < n; i++) {
    const d = adicionarDias(inicio, i);
    const k = d.toISOString().slice(0, 10);
    out.push({ dia: k, total: mapa.get(k) ?? 0 });
  }
  return out;
}
