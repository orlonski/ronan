import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { EvolutionClientService } from "../../whatsapp/evolution-client.service";
import { SessaoService } from "../../whatsapp/sessao.service";
import {
  inicioDoDiaData,
  inicioDoDiaInstante,
  ymdSaoPaulo,
} from "../../common/timezone";

const DIA_MS = 86_400_000;

function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Toneladas com 1 casa e separadores pt-BR (ex.: 1.234,5).
function fmtTon(n: number): string {
  const [int, dec] = (Math.round(n * 10) / 10).toFixed(1).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

@Injectable()
export class ResumoService {
  private readonly log = new Logger(ResumoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionClientService,
  ) {}

  /** Todo dia às 20:00 de Brasília. */
  @Cron("0 0 20 * * *", { name: "resumo-diario", timeZone: "America/Sao_Paulo" })
  async enviarDiario(): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        receberResumoDiario: true,
        ativo: true,
        whatsappResumo: { not: null },
      },
      select: { id: true, nome: true, whatsappResumo: true },
    });
    if (users.length === 0) return;
    if (!this.evolution.configurado) {
      this.log.warn("Resumo diário: Evolution não configurado — pulando.");
      return;
    }
    const texto = await this.montarMensagem();
    let ok = 0;
    for (const u of users) {
      try {
        await this.enviar(u.whatsappResumo!, texto);
        ok++;
      } catch (e) {
        this.log.error(`Resumo pra ${u.nome} falhou: ${(e as Error).message}`);
      }
    }
    this.log.log(`Resumo diário enviado pra ${ok}/${users.length} usuário(s).`);
  }

  /** Envio sob demanda (botão "enviar resumo agora" no dashboard). */
  async enviarAgora(userId: string): Promise<{ ok: true }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { whatsappResumo: true },
    });
    if (!u) throw new NotFoundException("Usuário não encontrado");
    if (!u.whatsappResumo) {
      throw new BadRequestException(
        "Usuário sem número de WhatsApp configurado. Edite o usuário e informe o número.",
      );
    }
    if (!this.evolution.configurado) {
      throw new BadRequestException("WhatsApp (Evolution) não está configurado no servidor.");
    }
    const texto = await this.montarMensagem();
    await this.enviar(u.whatsappResumo, texto);
    return { ok: true };
  }

  private async enviar(numeroRaw: string, texto: string): Promise<void> {
    const numero = SessaoService.normalizar(numeroRaw);
    await this.evolution.enviarTexto(numero, texto);
  }

  /** Monta o texto do resumo com as métricas do momento. */
  private async montarMensagem(): Promise<string> {
    const [y, m, dia] = ymdSaoPaulo();

    // Colunas @db.Date (Viagem.data): fronteiras em meia-noite UTC da data BR.
    const hoje00 = inicioDoDiaData();
    const amanha00 = new Date(hoje00.getTime() + DIA_MS);
    const sem7 = new Date(hoje00.getTime() - 6 * DIA_MS); // hoje + 6 anteriores
    const inicioMes = new Date(Date.UTC(y, m - 1, 1));
    const inicioMesQueVem = new Date(Date.UTC(y, m, 1));

    // Colunas timestamp (Abastecimento.data): fronteiras em 00h BR = 03:00Z.
    const hoje00I = inicioDoDiaInstante();
    const amanha00I = new Date(hoje00I.getTime() + DIA_MS);
    const sem7I = new Date(hoje00I.getTime() - 6 * DIA_MS);
    const inicioMesI = new Date(Date.UTC(y, m - 1, 1, 3));
    const inicioMesQueVemI = new Date(Date.UTC(y, m, 1, 3));

    const [
      motTotal,
      motAprov,
      motPend,
      locCarga,
      locDescarga,
      viHoje,
      vi7,
      viMes,
      viTotal,
      abHoje,
      ab7,
      abMes,
      abTotal,
      viAguardando,
      viDivergente,
      rankMotRaw,
      rankCliRaw,
      rankMatRaw,
    ] = await Promise.all([
      this.prisma.motorista.count(),
      this.prisma.motorista.count({ where: { status: "APROVADO" } }),
      this.prisma.motorista.count({ where: { status: "PENDENTE_APROVACAO" } }),
      // "Ambos" serve carga E descarga, então conta nos dois.
      this.prisma.local.count({ where: { tipo: { in: ["CARGA", "AMBOS"] }, ativo: true } }),
      this.prisma.local.count({ where: { tipo: { in: ["DESCARGA", "AMBOS"] }, ativo: true } }),
      this.prisma.viagem.count({ where: { data: { gte: hoje00, lt: amanha00 } } }),
      this.prisma.viagem.count({ where: { data: { gte: sem7, lt: amanha00 } } }),
      this.prisma.viagem.count({ where: { data: { gte: inicioMes, lt: inicioMesQueVem } } }),
      this.prisma.viagem.count(),
      this.prisma.abastecimento.count({ where: { data: { gte: hoje00I, lt: amanha00I } } }),
      this.prisma.abastecimento.count({ where: { data: { gte: sem7I, lt: amanha00I } } }),
      this.prisma.abastecimento.count({ where: { data: { gte: inicioMesI, lt: inicioMesQueVemI } } }),
      this.prisma.abastecimento.count(),
      this.prisma.viagem.count({ where: { status: { in: ["ENVIADA", "EM_CONFERENCIA"] } } }),
      this.prisma.viagem.count({ where: { status: "DIVERGENTE" } }),
      this.prisma.viagem.groupBy({
        by: ["motoristaId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { motoristaId: "desc" } },
        take: 5,
      }),
      this.prisma.viagem.groupBy({
        by: ["clienteId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { clienteId: "desc" } },
        take: 5,
      }),
      this.prisma.viagem.groupBy({
        by: ["materialId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem } },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { materialId: "desc" } },
        take: 5,
      }),
    ]);

    const [motoristas, clientes, materiais] = await Promise.all([
      this.prisma.motorista.findMany({
        where: { id: { in: rankMotRaw.map((r) => r.motoristaId) } },
        select: { id: true, nome: true },
      }),
      this.prisma.cliente.findMany({
        where: { id: { in: rankCliRaw.map((r) => r.clienteId) } },
        select: { id: true, nome: true },
      }),
      this.prisma.material.findMany({
        where: { id: { in: rankMatRaw.map((r) => r.materialId) } },
        select: { id: true, nome: true },
      }),
    ]);

    const nomeDe = (arr: { id: string; nome: string }[], id: string) =>
      arr.find((x) => x.id === id)?.nome ?? "?";

    const ranking = (
      titulo: string,
      raw: { _count: { _all: number }; _sum: { toneladas: unknown } }[],
      ids: string[],
      arr: { id: string; nome: string }[],
    ) => {
      if (raw.length === 0) return `${titulo}\n_sem viagens no mês_`;
      const linhas = raw
        .map((r, i) => {
          const ton = Number(r._sum.toneladas ?? 0);
          return `${i + 1}. ${nomeDe(arr, ids[i])} — ${fmt(r._count._all)} viagens · ${fmtTon(ton)} t`;
        })
        .join("\n");
      return `${titulo}\n${linhas}`;
    };

    const pad = (n: number) => String(n).padStart(2, "0");
    const dataLabel = `${pad(dia)}/${pad(m)}/${y}`;

    return [
      `📊 *Resumo Schaba* — ${dataLabel}`,
      "",
      "👷 *Motoristas*",
      `• Cadastrados: ${fmt(motTotal)}`,
      `• Aprovados: ${fmt(motAprov)}`,
      `• Pendentes: ${fmt(motPend)}`,
      "",
      "📍 *Locais ativos*",
      `• Carga: ${fmt(locCarga)}`,
      `• Descarga: ${fmt(locDescarga)}`,
      "",
      "🚚 *Viagens*",
      `• Hoje: ${fmt(viHoje)}`,
      `• Últimos 7 dias: ${fmt(vi7)}`,
      `• Mês: ${fmt(viMes)}`,
      `• Total: ${fmt(viTotal)}`,
      "",
      "⛽ *Abastecimentos*",
      `• Hoje: ${fmt(abHoje)}`,
      `• Últimos 7 dias: ${fmt(ab7)}`,
      `• Mês: ${fmt(abMes)}`,
      `• Total: ${fmt(abTotal)}`,
      "",
      "⏳ *Viagens pendentes*",
      `• Aguardando conferência: ${fmt(viAguardando)}`,
      `• Divergentes: ${fmt(viDivergente)}`,
      "",
      "🏆 *Top 5 do mês*",
      "_Ordenado por nº de viagens. Mostra também as toneladas carregadas no mês._",
      "",
      ranking(
        "*Motoristas* (quem mais rodou)",
        rankMotRaw,
        rankMotRaw.map((r) => r.motoristaId),
        motoristas,
      ),
      "",
      ranking(
        "*Clientes* (quem mais movimentou)",
        rankCliRaw,
        rankCliRaw.map((r) => r.clienteId),
        clientes,
      ),
      "",
      ranking(
        "*Materiais* (mais transportados)",
        rankMatRaw,
        rankMatRaw.map((r) => r.materialId),
        materiais,
      ),
    ].join("\n");
  }
}
