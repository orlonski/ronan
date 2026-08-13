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
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { contaIdAtual } from "../../common/conta/conta-context";
import { paraCadaConta } from "../../common/conta/para-cada-conta";

const DIA_MS = 86_400_000;

// Viagens incompletas (EM_ANDAMENTO, AGUARDANDO_PESO) não contam em KPIs/rankings.
const FORA_FECHAMENTO = { status: { notIn: STATUS_FORA_FECHAMENTO } };

function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Número com 1 casa e separadores pt-BR (ex.: 1.234,5). Usado pra toneladas,
// km, litros, ritmo e tempo médio.
function fmtTon(n: number): string {
  const [int, dec] = (Math.round(n * 10) / 10).toFixed(1).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

// Valor em R$ com 2 casas e separadores pt-BR (ex.: R$ 1.234,56).
function fmtBRL(n: number): string {
  const [int, dec] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

// "1 viagem" vs "4 viagens" — evita o "1 viagens" errado.
function plural(n: number, sing: string, plur: string): string {
  return `${fmt(n)} ${n === 1 ? sing : plur}`;
}

// Medalha pro pódio das listas do dia; resto vira um marcador neutro.
function medalha(i: number): string {
  return ["🥇", "🥈", "🥉"][i] ?? "▫️";
}

const DIAS_SEMANA = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

// Dia da semana em pt-BR pra data BR (y/m/dia já vêm de ymdSaoPaulo).
function diaSemana(y: number, m: number, dia: number): string {
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, dia)).getUTCDay()];
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
    // O resumo é uma mensagem com os números da empresa: uma passada por conta,
    // senão o dono da Schaba receberia as viagens da outra no mesmo texto.
    await paraCadaConta(this.prisma, () => this.enviarDiarioDaVez());
  }

  private async enviarDiarioDaVez(): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        receberResumoDiario: true,
        ativo: true,
        whatsappResumo: { not: null },
        // A mensagem é agregada da operação INTEIRA (ranking de motoristas por
        // nome, toneladas, km, combustível). Sai por WhatsApp, fora de qualquer
        // guard — então usuário restrito a frota não entra na lista até o
        // resumo saber se escopar (Fase 5).
        acessoGlobal: true,
      },
      select: {
        id: true,
        nome: true,
        whatsappResumo: true,
        resumoAssuntos: true,
      },
    });
    if (users.length === 0) return;
    if (!this.evolution.configurado) {
      this.log.warn("Resumo diário: Evolution não configurado — pulando.");
      return;
    }
    let ok = 0;
    for (const u of users) {
      const chaves = new Set(u.resumoAssuntos);
      if (chaves.size === 0) continue; // usuário sem nenhum assunto marcado
      try {
        const texto = await this.montarMensagem(chaves);
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
      select: { whatsappResumo: true, resumoAssuntos: true, acessoGlobal: true },
    });
    if (!u) throw new NotFoundException("Usuário não encontrado");
    if (!u.acessoGlobal) {
      // Mesmo motivo do cron: o resumo ainda não sabe se escopar por frota.
      throw new BadRequestException(
        "Este usuário tem acesso restrito a transportadora e o resumo diário ainda não é filtrado por frota.",
      );
    }
    if (!u.whatsappResumo) {
      throw new BadRequestException(
        "Usuário sem número de WhatsApp configurado. Edite o usuário e informe o número.",
      );
    }
    if (!this.evolution.configurado) {
      throw new BadRequestException("WhatsApp (Evolution) não está configurado no servidor.");
    }
    const chaves = new Set(u.resumoAssuntos);
    if (chaves.size === 0) {
      throw new BadRequestException(
        "Este usuário não tem nenhum assunto do resumo marcado. Edite o usuário e selecione os assuntos.",
      );
    }
    const texto = await this.montarMensagem(chaves);
    await this.enviar(u.whatsappResumo, texto);
    return { ok: true };
  }

  private async enviar(numeroRaw: string, texto: string): Promise<void> {
    const numero = SessaoService.normalizar(numeroRaw);
    await this.evolution.enviarTexto(numero, texto);
  }

  /**
   * Monta o texto do resumo só com os blocos marcados (`chaves` = assuntos do
   * usuário). As métricas são sempre calculadas; o filtro decide o que entra.
   */
  private async montarMensagem(chaves: Set<string>): Promise<string> {
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
    // Janelas pra produtividade/saúde (colunas timestamp).
    const inicio14dInst = new Date(hoje00I.getTime() - 13 * DIA_MS); // hoje + 13 = 14 dias
    const corte7d = new Date(hoje00I.getTime() - 7 * DIA_MS);

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
      motHojeRaw,
      matHojeRaw,
    ] = await Promise.all([
      this.prisma.motorista.count(),
      this.prisma.motorista.count({ where: { status: "APROVADO" } }),
      this.prisma.motorista.count({ where: { status: "PENDENTE_APROVACAO" } }),
      // "Ambos" serve carga E descarga, então conta nos dois.
      this.prisma.local.count({ where: { tipo: { in: ["CARGA", "AMBOS"] }, ativo: true } }),
      this.prisma.local.count({ where: { tipo: { in: ["DESCARGA", "AMBOS"] }, ativo: true } }),
      this.prisma.viagem.count({ where: { data: { gte: hoje00, lt: amanha00 }, ...FORA_FECHAMENTO } }),
      this.prisma.viagem.count({ where: { data: { gte: sem7, lt: amanha00 }, ...FORA_FECHAMENTO } }),
      this.prisma.viagem.count({ where: { data: { gte: inicioMes, lt: inicioMesQueVem }, ...FORA_FECHAMENTO } }),
      this.prisma.viagem.count({ where: FORA_FECHAMENTO }),
      this.prisma.abastecimento.count({ where: { data: { gte: hoje00I, lt: amanha00I } } }),
      this.prisma.abastecimento.count({ where: { data: { gte: sem7I, lt: amanha00I } } }),
      this.prisma.abastecimento.count({ where: { data: { gte: inicioMesI, lt: inicioMesQueVemI } } }),
      this.prisma.abastecimento.count(),
      this.prisma.viagem.count({ where: { status: { in: ["ENVIADA", "EM_CONFERENCIA"] } } }),
      this.prisma.viagem.count({ where: { status: "DIVERGENTE" } }),
      this.prisma.viagem.groupBy({
        by: ["motoristaId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem }, ...FORA_FECHAMENTO },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { motoristaId: "desc" } },
        take: 5,
      }),
      this.prisma.viagem.groupBy({
        by: ["clienteId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem }, ...FORA_FECHAMENTO },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { clienteId: "desc" } },
        take: 5,
      }),
      this.prisma.viagem.groupBy({
        by: ["materialId"],
        where: { data: { gte: inicioMes, lt: inicioMesQueVem }, ...FORA_FECHAMENTO },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { materialId: "desc" } },
        take: 5,
      }),
      // Detalhe do dia atual: todos os motoristas e materiais que rodaram hoje.
      this.prisma.viagem.groupBy({
        by: ["motoristaId"],
        where: { data: { gte: hoje00, lt: amanha00 }, ...FORA_FECHAMENTO },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { motoristaId: "desc" } },
      }),
      this.prisma.viagem.groupBy({
        by: ["materialId"],
        where: { data: { gte: hoje00, lt: amanha00 }, ...FORA_FECHAMENTO },
        _count: { _all: true },
        _sum: { toneladas: true },
        orderBy: { _count: { materialId: "desc" } },
      }),
    ]);

    const [motoristas, clientes, materiais] = await Promise.all([
      this.prisma.motorista.findMany({
        where: {
          id: { in: [...rankMotRaw, ...motHojeRaw].map((r) => r.motoristaId) },
        },
        select: { id: true, nome: true },
      }),
      this.prisma.cliente.findMany({
        // EM_ANDAMENTO tem clienteId/materialId null e já foi filtrada por data.
        where: {
          id: {
            in: rankCliRaw
              .map((r) => r.clienteId)
              .filter((id): id is string => id !== null),
          },
        },
        select: { id: true, nome: true },
      }),
      this.prisma.material.findMany({
        where: {
          id: {
            in: [...rankMatRaw, ...matHojeRaw]
              .map((r) => r.materialId)
              .filter((id): id is string => id !== null),
          },
        },
        select: { id: true, nome: true },
      }),
    ]);

    // ---- Métricas estendidas: financeiro, produção, pendências, saúde ----
    const [
      viAggHoje,
      viAgg7,
      viAggMes,
      abAggHoje,
      abAgg7,
      abAggMes,
      pedHoje,
      ped7,
      pedMes,
      comboioPend,
      fechAguardando,
      envGerados,
      pedSemValor,
      locaisRascunho,
      conferidas14d,
      pendentesConf,
      errosGrupos,
      motSumidos,
      maxBuiltAgg,
      tempoRaw,
    ] = await Promise.all([
      this.prisma.viagem.aggregate({ where: { data: { gte: hoje00, lt: amanha00 } }, _sum: { toneladas: true, km: true } }),
      this.prisma.viagem.aggregate({ where: { data: { gte: sem7, lt: amanha00 } }, _sum: { toneladas: true, km: true } }),
      this.prisma.viagem.aggregate({ where: { data: { gte: inicioMes, lt: inicioMesQueVem } }, _sum: { toneladas: true, km: true } }),
      this.prisma.abastecimento.aggregate({ where: { data: { gte: hoje00I, lt: amanha00I } }, _sum: { valorTotal: true, litros: true } }),
      this.prisma.abastecimento.aggregate({ where: { data: { gte: sem7I, lt: amanha00I } }, _sum: { valorTotal: true, litros: true } }),
      this.prisma.abastecimento.aggregate({ where: { data: { gte: inicioMesI, lt: inicioMesQueVemI } }, _sum: { valorTotal: true, litros: true } }),
      this.prisma.pedagio.aggregate({ where: { data: { gte: hoje00, lt: amanha00 } }, _sum: { valor: true } }),
      this.prisma.pedagio.aggregate({ where: { data: { gte: sem7, lt: amanha00 } }, _sum: { valor: true } }),
      this.prisma.pedagio.aggregate({ where: { data: { gte: inicioMes, lt: inicioMesQueVem } }, _sum: { valor: true } }),
      this.prisma.abastecimento.count({ where: { emComboio: true, valorTotal: null } }),
      this.prisma.fechamento.count({ where: { status: "AGUARDANDO_REVISAO" } }),
      this.prisma.envioFechamento.count({ where: { status: "GERADO" } }),
      this.prisma.viagem.count({ where: { tipoDivergencia: "PEDAGIO_SEM_VALOR" } }),
      this.prisma.local.count({ where: { nivelConfianca: "RASCUNHO", ativo: true } }),
      this.prisma.viagem.count({ where: { revisadoEm: { gte: inicio14dInst } } }),
      this.prisma.viagem.count({ where: { revisadoEm: null, status: { not: "RASCUNHO_OFFLINE" } } }),
      this.prisma.errorLog.groupBy({ by: ["hash"], where: { resolvido: false } }),
      this.prisma.motorista.count({ where: { status: "APROVADO", ativo: true, appVistoEm: { lt: corte7d } } }),
      this.prisma.motorista.aggregate({ where: { status: "APROVADO", ativo: true }, _max: { appBuiltAt: true } }),
      this.prisma.$queryRaw<Array<{ s: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM ("revisadoEm" - "sincronizadoEm")))::float8 AS s
        FROM "viagens"
        WHERE "contaId" = ${contaIdAtual()}
          AND "revisadoEm" >= ${inicio14dInst}
      `,
    ]);

    // App desatualizado: motoristas cujo bundle (appBuiltAt) é mais antigo que o
    // mais novo já visto entre os ativos — depende do max, então roda depois.
    const maxBuilt = maxBuiltAgg._max.appBuiltAt;
    const motDesatualizados = maxBuilt
      ? await this.prisma.motorista.count({
          where: { status: "APROVADO", ativo: true, appBuiltAt: { lt: maxBuilt } },
        })
      : 0;

    const errosNaoResolvidos = errosGrupos.length;
    const ritmoDia = conferidas14d / 14;
    const etaDias = ritmoDia > 0 ? Math.ceil(pendentesConf / ritmoDia) : null;
    const tempoMedioDias = tempoRaw[0]?.s != null ? tempoRaw[0].s / 86400 : null;

    // Extratores de _sum (Prisma devolve Decimal | null).
    const tonDe = (a: { _sum: { toneladas: unknown } }) => Number(a._sum.toneladas ?? 0);
    const kmDe = (a: { _sum: { km: unknown } }) => Number(a._sum.km ?? 0);
    const combDe = (a: { _sum: { valorTotal: unknown } }) => Number(a._sum.valorTotal ?? 0);
    const litDe = (a: { _sum: { litros: unknown } }) => Number(a._sum.litros ?? 0);
    const pedDe = (a: { _sum: { valor: unknown } }) => Number(a._sum.valor ?? 0);

    const nomeDe = (arr: { id: string; nome: string }[], id: string | null | undefined) =>
      arr.find((x) => x.id === id)?.nome ?? "?";

    // Bloco de períodos, um por linha (Hoje/Semana/Mês [+ Total]).
    const periodos = (
      hoje: string,
      sem: string,
      mes: string,
      total?: string,
    ) => {
      const l = [`• Hoje: ${hoje}`, `• Semana: ${sem}`, `• Mês: ${mes}`];
      if (total !== undefined) l.push(`• Total: ${total}`);
      return l.join("\n");
    };

    const ranking = (
      titulo: string,
      raw: { _count: { _all: number }; _sum: { toneladas: unknown } }[],
      ids: (string | null)[],
      arr: { id: string; nome: string }[],
    ) => {
      if (raw.length === 0) return `${titulo}\n_sem viagens no mês_`;
      const linhas = raw
        .map((r, i) => {
          const ton = Number(r._sum.toneladas ?? 0);
          return `${i + 1}. *${nomeDe(arr, ids[i])}* — ${plural(r._count._all, "viagem", "viagens")} · ${fmtTon(ton)} t`;
        })
        .join("\n");
      return `${titulo}\n${linhas}`;
    };

    // Lista do dia: subtotal no topo + 2 linhas por item (medalha no pódio,
    // nome em negrito, nº de viagens e toneladas embaixo). Vem ordenada do groupBy.
    const listaHoje = (
      titulo: string,
      rotuloSing: string,
      rotuloPlur: string,
      raw: { _count: { _all: number }; _sum: { toneladas: unknown } }[],
      ids: (string | null)[],
      arr: { id: string; nome: string }[],
      vazio: string,
    ) => {
      if (raw.length === 0) return `${titulo}\n_${vazio}_`;
      const totViagens = raw.reduce((s, r) => s + r._count._all, 0);
      const totTon = raw.reduce((s, r) => s + Number(r._sum.toneladas ?? 0), 0);
      const sub = `_${plural(raw.length, rotuloSing, rotuloPlur)} · ${plural(totViagens, "viagem", "viagens")} · ${fmtTon(totTon)} t_`;
      const linhas = raw
        .map(
          (r, i) =>
            `${medalha(i)} *${nomeDe(arr, ids[i])}*\n     ${plural(r._count._all, "viagem", "viagens")} · ${fmtTon(Number(r._sum.toneladas ?? 0))} t`,
        )
        .join("\n");
      return `${titulo}\n${sub}\n\n${linhas}`;
    };

    const pad = (n: number) => String(n).padStart(2, "0");
    const dataLabel = `${pad(dia)}/${pad(m)}/${y} · ${diaSemana(y, m, dia)}`;
    const has = (c: string) => chaves.has(c);

    // Cabeçalho: título + data com dia da semana. A régua entra no join.
    const blocos: string[] = [`📊 *RESUMO SCHABA*\n🗓️ ${dataLabel}`];

    if (has("motoristas"))
      blocos.push(
        [
          "👷 *Motoristas*",
          `• Cadastrados: ${fmt(motTotal)}`,
          `• Aprovados: ${fmt(motAprov)}`,
          `• Pendentes: ${fmt(motPend)}`,
        ].join("\n"),
      );
    if (has("locais"))
      blocos.push(
        ["📍 *Locais ativos*", `• Carga: ${fmt(locCarga)}`, `• Descarga: ${fmt(locDescarga)}`].join("\n"),
      );
    if (has("viagens"))
      blocos.push(
        [
          "🚚 *Viagens*",
          periodos(fmt(viHoje), fmt(vi7), fmt(viMes), fmt(viTotal)),
        ].join("\n"),
      );
    if (has("producao"))
      blocos.push(
        [
          "📦 *Produção em toneladas*",
          periodos(fmtTon(tonDe(viAggHoje)), fmtTon(tonDe(viAgg7)), fmtTon(tonDe(viAggMes))),
          "",
          "📦 *Produção em km rodados*",
          periodos(fmtTon(kmDe(viAggHoje)), fmtTon(kmDe(viAgg7)), fmtTon(kmDe(viAggMes))),
        ].join("\n"),
      );
    if (has("abastecimentos"))
      blocos.push(
        [
          "⛽ *Abastecimentos*",
          periodos(fmt(abHoje), fmt(ab7), fmt(abMes), fmt(abTotal)),
          "",
          "⛽ *Litros abastecidos*",
          periodos(fmtTon(litDe(abAggHoje)), fmtTon(litDe(abAgg7)), fmtTon(litDe(abAggMes))),
        ].join("\n"),
      );
    if (has("custos"))
      blocos.push(
        [
          "💰 *Custos em combustível*",
          periodos(fmtBRL(combDe(abAggHoje)), fmtBRL(combDe(abAgg7)), fmtBRL(combDe(abAggMes))),
          "",
          "💰 *Custos em pedágio*",
          periodos(fmtBRL(pedDe(pedHoje)), fmtBRL(pedDe(ped7)), fmtBRL(pedDe(pedMes))),
          "",
          `• Comboios sem valor: ${fmt(comboioPend)}`,
        ].join("\n"),
      );
    if (has("pendencias"))
      blocos.push(
        [
          "⏳ *Pendências*",
          `• Aguardando conferência: *${fmt(viAguardando)}*`,
          `• Divergentes: ${fmt(viDivergente)}`,
          `• Pedágios sem valor: ${fmt(pedSemValor)}`,
          `• Fechamentos p/ revisar: ${fmt(fechAguardando)}`,
          `• Relatórios não enviados: ${fmt(envGerados)}`,
          `• Locais a validar: ${fmt(locaisRascunho)}`,
        ].join("\n"),
      );
    if (has("conferencia"))
      blocos.push(
        [
          "⚡ *Conferência*",
          `• Ritmo: ${fmtTon(ritmoDia)} viagens/dia (média 14d)`,
          `• Fila: ${plural(pendentesConf, "pendente", "pendentes")}${etaDias != null ? ` (~${plural(etaDias, "dia", "dias")} pra zerar)` : ""}`,
          `• Tempo médio: ${tempoMedioDias != null ? `${fmtTon(tempoMedioDias)} dias` : "—"}`,
        ].join("\n"),
      );
    if (has("saude"))
      blocos.push(
        [
          "🩺 *Saúde*",
          `• Erros não resolvidos: ${fmt(errosNaoResolvidos)}`,
          `• Motoristas sumidos (+7d): ${fmt(motSumidos)}`,
          `• App desatualizado: ${fmt(motDesatualizados)}`,
        ].join("\n"),
      );
    if (has("ranking"))
      blocos.push(
        [
          "🏆 *Top 5 do mês*",
          "_Por nº de viagens (+ toneladas do mês)_",
          "",
          ranking("*Motoristas* (quem mais rodou)", rankMotRaw, rankMotRaw.map((r) => r.motoristaId), motoristas),
          "",
          ranking("*Clientes* (quem mais movimentou)", rankCliRaw, rankCliRaw.map((r) => r.clienteId), clientes),
          "",
          ranking("*Materiais* (mais transportados)", rankMatRaw, rankMatRaw.map((r) => r.materialId), materiais),
        ].join("\n"),
      );
    if (has("motoristas_hoje"))
      blocos.push(
        listaHoje(
          "🚛 *Viagens por motorista* · hoje",
          "motorista",
          "motoristas",
          motHojeRaw,
          motHojeRaw.map((r) => r.motoristaId),
          motoristas,
          "nenhuma viagem hoje",
        ),
      );
    if (has("materiais_hoje"))
      blocos.push(
        listaHoje(
          "🧱 *Materiais* · hoje",
          "material",
          "materiais",
          matHojeRaw,
          matHojeRaw.map((r) => r.materialId),
          materiais,
          "nenhuma viagem hoje",
        ),
      );

    return blocos.join("\n\n");
  }
}
