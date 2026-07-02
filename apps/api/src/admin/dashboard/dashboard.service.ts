import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ymdSaoPaulo } from "../../common/timezone";

/**
 * Service do dashboard executivo. Tudo em paralelo via Promise.all —
 * é uma tela de leitura, latência manda.
 *
 * Fuso: o container roda em UTC, então NUNCA usar new Date().setHours(0) —
 * isso ancora o dia em UTC e, a partir das 21h de Brasília (00h UTC), o "hoje"
 * pula pro dia seguinte e a tela zera. As fronteiras são calculadas na data
 * civil de São Paulo (UTC-3). Dois tipos:
 *  - `*00` (meia-noite UTC da data BR): casa com colunas @db.Date (viagem, pedagio).
 *  - `*Inst` (meia-noite de Brasília = 03:00 UTC): pra colunas timestamp
 *    (abastecimento.data, ultimoLoginEm).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot() {
    const agora = new Date();
    const [y, m, dia] = ymdSaoPaulo(agora); // data civil em SP (m = 1-12)

    // Fronteiras pra colunas @db.Date (data-only) — meia-noite UTC da data BR
    const hoje00 = new Date(Date.UTC(y, m - 1, dia));
    const amanha00 = new Date(Date.UTC(y, m - 1, dia + 1));
    const inicioMes = new Date(Date.UTC(y, m - 1, 1));
    const inicioMesQueVem = new Date(Date.UTC(y, m, 1));
    const inicio14d = new Date(Date.UTC(y, m - 1, dia - 13)); // hoje incluso = 14 dias

    // Fronteiras pra colunas timestamp — meia-noite de Brasília (UTC-3) em UTC
    const hoje00Inst = new Date(Date.UTC(y, m - 1, dia, 3));
    const inicioMesInst = new Date(Date.UTC(y, m - 1, 1, 3));
    const inicioMesQueVemInst = new Date(Date.UTC(y, m, 1, 3));
    const inicio14dInst = new Date(Date.UTC(y, m - 1, dia - 13, 3)); // hoje incluso = 14 dias

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
      // Conferência
      conferidasTotal,
      pendentesConferencia,
      conferidas14d,
      leadTimeRows,
    ] = await Promise.all([
      this.prisma.viagem.count({ where: { data: { gte: hoje00, lt: amanha00 } } }),
      this.prisma.viagem.aggregate({
        where: { data: { gte: hoje00, lt: amanha00 } },
        _sum: { toneladas: true },
      }),
      this.prisma.motorista.count({ where: { ultimoLoginEm: { gte: hoje00Inst } } }),
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
        where: { data: { gte: inicioMesInst, lt: inicioMesQueVemInst } },
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
      // Conferência — universo conferível exclui rascunhos offline
      this.prisma.viagem.count({ where: { revisadoEm: { not: null } } }),
      this.prisma.viagem.count({
        // EM_ANDAMENTO tem revisadoEm null mas ainda não é conferível.
        where: { revisadoEm: null, status: { notIn: ["RASCUNHO_OFFLINE", "EM_ANDAMENTO"] } },
      }),
      this.prisma.viagem.count({ where: { revisadoEm: { gte: inicio14dInst } } }),
      // Lead time médio (segundos) das viagens conferidas nos últimos 14 dias:
      // do momento que chegou no servidor (sincronizadoEm) até a conferência (revisadoEm).
      this.prisma.$queryRaw<Array<{ avg_secs: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM ("revisadoEm" - "sincronizadoEm")))::float8 AS avg_secs
        FROM "viagens"
        WHERE "revisadoEm" >= ${inicio14dInst}
      `,
    ]);

    // Resolve nomes dos rankings em um round adicional (ids únicos, ~15 registros)
    const motoristaIds = rankingMotoristasRaw.map((r) => r.motoristaId);
    // EM_ANDAMENTO tem clienteId/materialId null e já foi filtrada por status/data.
    const clienteIds = rankingClientesRaw
      .map((r) => r.clienteId)
      .filter((id): id is string => id !== null);
    const materialIds = rankingMateriaisRaw
      .map((r) => r.materialId)
      .filter((id): id is string => id !== null);

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

    // Vazão: viagens conferidas/dia na média das últimas 2 semanas.
    const ritmoDia = conferidas14d / 14;
    // Previsão pra zerar o backlog. 0 quando nada pendente; null quando há
    // pendentes mas o ritmo recente é zero (não dá pra estimar).
    const etaDias =
      pendentesConferencia === 0
        ? 0
        : ritmoDia > 0
          ? Math.ceil(pendentesConferencia / ritmoDia)
          : null;
    const avgSecs = leadTimeRows[0]?.avg_secs ?? null;
    const tempoMedioDias = avgSecs != null ? avgSecs / 86400 : null;

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
      conferencia: {
        total: conferidasTotal + pendentesConferencia,
        conferidas: conferidasTotal,
        pendentes: pendentesConferencia,
        ritmoDia,
        etaDias,
        tempoMedioDias,
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
          nome: nomeCliente.get(r.clienteId ?? "") ?? "—",
          viagens: r._count._all,
        })),
        materiais: rankingMateriaisRaw.map((r) => ({
          id: r.materialId,
          nome: nomeMaterial.get(r.materialId ?? "") ?? "—",
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

/**
 * Recebe linhas { data, _count } com furos e devolve array completo de N dias
 * a partir de `inicio`, ordenado asc, com 0 nos dias sem viagem.
 * Tudo em UTC: `data` vem de coluna @db.Date (meia-noite UTC) e `inicio` é
 * construído com Date.UTC, então a chave YYYY-MM-DD bate.
 */
function preencherDias(
  linhas: Array<{ data: Date | null; _count: { _all: number } }>,
  inicio: Date,
  n: number,
): Array<{ dia: string; total: number }> {
  const mapa = new Map<string, number>();
  for (const r of linhas) {
    // EM_ANDAMENTO tem data null e já foi filtrada pelo where da query.
    if (!r.data) continue;
    const k = r.data.toISOString().slice(0, 10);
    mapa.set(k, (mapa.get(k) ?? 0) + r._count._all);
  }
  const out: Array<{ dia: string; total: number }> = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(inicio.getTime() + i * 86400000);
    const k = d.toISOString().slice(0, 10);
    out.push({ dia: k, total: mapa.get(k) ?? 0 });
  }
  return out;
}
