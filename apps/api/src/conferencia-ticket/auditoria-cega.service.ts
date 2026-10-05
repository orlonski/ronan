import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { contaIdAtual } from "../common/conta/conta-context";
import type { Divergencia, Incerteza } from "../common/conferencia-ticket";
import { montarDeclarado, SELECT_DECLARADO } from "./conferencia-fila.service";

/**
 * Até aqui, a leitura do ticket via a foto JUNTO com o que o motorista lançou
 * — e copiava o lançado quando o papel não trazia o campo (05/10/2026: "Obra:
 * ARENA — confere" num ticket sem ARENA). Tudo o que ela disse que "confere"
 * antes deste instante pode ter sido cópia, inclusive o peso.
 *
 * É o `iniciadoEm` do processo que pôs a leitura às cegas no ar.
 */
export const CORTE_LEITURA_CEGA = new Date("2026-10-05T17:12:10Z");

/** A origem dos jobs desta auditoria — o worker lê e NUNCA age por ela. */
export const ORIGEM_AUDITORIA_CEGA = "auditoria-cega";

/** Onde a releitura discordou, do mais grave pro menos. */
export type GravidadeAuditoria =
  /** Peso ou número do documento: é dinheiro ou é outro ticket. */
  | "PESO_OU_TICKET"
  /** Placa ou data: caminhão ou dia errado. */
  | "PLACA_OU_DATA"
  /** Só obra/material sem vínculo: se resolve vinculando, sem gastar leitura. */
  | "SO_VINCULO"
  /** Foto ilegível, leitura fraca — sem conclusão. */
  | "SEM_CONCLUSAO"
  | "CONFERE";

/**
 * Classifica o resultado de uma releitura. A ordem importa: uma viagem com o
 * peso divergente E a obra sem vínculo é caso de peso — o vínculo é detalhe.
 */
export function classificarAuditoria(r: {
  veredito: string | null;
  divergencias: Divergencia[];
  incertezas: Incerteza[];
}): GravidadeAuditoria {
  if (r.veredito === "BATE" || r.veredito === "NAO_APLICAVEL") return "CONFERE";
  const campos = [...r.divergencias.map((d) => d.campo), ...r.incertezas.map((i) => i.campo)];
  if (campos.some((c) => c === "toneladas" || c === "ticket")) return "PESO_OU_TICKET";
  if (campos.some((c) => c === "placa" || c === "data")) return "PLACA_OU_DATA";
  const soNome =
    campos.length > 0 &&
    r.divergencias.length === 0 &&
    r.incertezas.every((i) => (i.campo === "cliente" || i.campo === "material") && i.motivo === "sem vínculo");
  if (soNome) return "SO_VINCULO";
  if (r.divergencias.some((d) => d.campo === "cliente" || d.campo === "material")) return "PESO_OU_TICKET";
  return "SEM_CONCLUSAO";
}

/**
 * Releitura às cegas do que a IA disse que conferia antes do conserto.
 *
 * Três regras que não se negociam:
 *   1. **Nada roda sem alguém clicar** depois de ver quantas são e quanto custa.
 *   2. **A releitura nunca mexe na viagem** — nem status, nem motorista, nem
 *      chat. Ela só registra o que leu; quem decide é gente, olhando a lista.
 *      (Viagem aprovada já pode estar faturada: desfazer sozinho seria pior.)
 *   3. Cada viagem entra uma vez: rodar de novo não paga a mesma leitura.
 */
@Injectable()
export class AuditoriaCegaService {
  private readonly log = new Logger("ConferenciaTicket");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * As viagens cuja ÚLTIMA leitura concluída é anterior ao corte e disse
   * "confere" — e que ainda não entraram nesta auditoria.
   */
  private async candidatas(): Promise<{ viagemId: string; aprovadaPelaIa: boolean; emFechamento: boolean }[]> {
    const lidas = await this.prisma.conferenciaTicket.findMany({
      where: { status: "CONCLUIDA" },
      select: { viagemId: true, veredito: true, finalizadoEm: true, criadoEm: true, origem: true },
      orderBy: { criadoEm: "desc" },
    });
    const jaAuditadas = new Set(
      (
        await this.prisma.conferenciaTicket.findMany({
          where: { origem: ORIGEM_AUDITORIA_CEGA, status: { not: "FALHOU" } },
          select: { viagemId: true },
        })
      ).map((c) => c.viagemId),
    );

    // A última leitura de cada viagem decide: se alguém já mandou "ler de
    // novo" depois do conserto, a viagem já tem leitura às cegas.
    const ultima = new Map<string, (typeof lidas)[number]>();
    for (const c of lidas) if (!ultima.has(c.viagemId)) ultima.set(c.viagemId, c);

    const ids = [...ultima.values()]
      .filter((c) => c.veredito === "BATE")
      .filter((c) => (c.finalizadoEm ?? c.criadoEm).getTime() < CORTE_LEITURA_CEGA.getTime())
      .filter((c) => !jaAuditadas.has(c.viagemId))
      .map((c) => c.viagemId);
    if (ids.length === 0) return [];

    const viagens = await this.prisma.viagem.findMany({
      where: { id: { in: ids }, fotos: { some: {} } },
      select: { id: true, conferidoPorIaEm: true, _count: { select: { matchesFechamento: true } } },
    });
    return viagens.map((v) => ({
      viagemId: v.id,
      aprovadaPelaIa: !!v.conferidoPorIaEm,
      emFechamento: v._count.matchesFechamento > 0,
    }));
  }

  /**
   * Quanto custa uma leitura hoje (às cegas são duas chamadas). Medido nas
   * leituras feitas depois do conserto quando já há amostra; antes disso, a
   * média antiga com folga pela chamada de julgamento.
   */
  private async custoPorLeitura(): Promise<{ usd: number; medido: boolean }> {
    const depois = await this.prisma.conferenciaTicket.aggregate({
      where: { status: "CONCLUIDA", finalizadoEm: { gte: CORTE_LEITURA_CEGA }, custoUsd: { gt: 0 } },
      _avg: { custoUsd: true },
      _count: true,
    });
    if (depois._count >= 5) return { usd: Number(depois._avg.custoUsd ?? 0), medido: true };
    const antes = await this.prisma.conferenciaTicket.aggregate({
      where: { status: "CONCLUIDA", custoUsd: { gt: 0 } },
      _avg: { custoUsd: true },
    });
    return { usd: Number(antes._avg.custoUsd ?? 0.005) * 1.4, medido: false };
  }

  /** Quantas são e quanto custa. Não gasta nada. */
  async previa() {
    const c = await this.candidatas();
    const custo = await this.custoPorLeitura();
    return {
      total: c.length,
      aprovadasPelaIa: c.filter((x) => x.aprovadaPelaIa).length,
      emFechamento: c.filter((x) => x.emFechamento).length,
      custoPorLeituraUsd: custo.usd,
      custoEstimadoUsd: custo.usd * c.length,
      custoMedido: custo.medido,
      corte: CORTE_LEITURA_CEGA.toISOString(),
    };
  }

  /**
   * Põe as candidatas na fila. `esperado` é o total que a pessoa viu na
   * prévia: se o número mudou no meio (outra pessoa clicou, chegou viagem
   * nova), não roda — o OK foi dado pra outro número.
   */
  async executar(esperado: number): Promise<{ enfileiradas: number; motivo?: string }> {
    const conta = await this.prisma.conta.findUnique({
      where: { id: contaIdAtual() },
      select: { iaConferenciaTicket: true },
    });
    if (!conta?.iaConferenciaTicket) {
      return { enfileiradas: 0, motivo: "A conferência não está liberada para esta empresa." };
    }

    const c = await this.candidatas();
    if (c.length !== esperado) {
      return { enfileiradas: 0, motivo: `O total mudou de ${esperado} pra ${c.length}. Veja a prévia de novo.` };
    }

    const placas = (await this.prisma.veiculo.findMany({ select: { placa: true } })).map((v) => v.placa);
    let enfileiradas = 0;
    for (const { viagemId } of c) {
      const viagem = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: {
          ...SELECT_DECLARADO,
          fotos: { orderBy: { capturadaEm: "desc" }, take: 1, select: { id: true, storageKey: true } },
        },
      });
      const foto = viagem?.fotos[0];
      if (!viagem || !foto) continue;
      try {
        await this.prisma.conferenciaTicket.create({
          data: {
            viagemId,
            ticketFotoId: foto.id,
            storageKey: foto.storageKey,
            viagemAtiva: viagemId,
            origem: ORIGEM_AUDITORIA_CEGA,
            declarado: montarDeclarado(viagem, placas) as unknown as Prisma.InputJsonValue,
          },
        });
        enfileiradas++;
      } catch (err) {
        // Já tem leitura viva pra essa viagem (mutex no `viagemAtiva`): fica
        // pra próxima rodada, não é erro.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    this.log.log(`Auditoria às cegas: ${enfileiradas} viagem(ns) na fila.`);
    return { enfileiradas };
  }

  /** O que a auditoria achou, agrupado por gravidade. */
  async resultado() {
    const jobs = await this.prisma.conferenciaTicket.findMany({
      where: { origem: ORIGEM_AUDITORIA_CEGA },
      orderBy: { criadoEm: "desc" },
      select: {
        viagemId: true,
        status: true,
        veredito: true,
        divergencias: true,
        incertezas: true,
        finalizadoEm: true,
        viagem: {
          select: {
            ticket: true,
            data: true,
            status: true,
            conferidoPorIaEm: true,
            motorista: { select: { nome: true } },
          },
        },
      },
    });

    // Uma linha por viagem: a releitura mais recente dela.
    const vistos = new Set<string>();
    const unicos = jobs.filter((j) => (vistos.has(j.viagemId) ? false : (vistos.add(j.viagemId), true)));

    const contagem: Record<string, number> = { naFila: 0, falhou: 0 };
    const itens = [];
    for (const j of unicos) {
      if (j.status === "PENDENTE" || j.status === "EXECUTANDO") {
        contagem.naFila++;
        continue;
      }
      if (j.status !== "CONCLUIDA") {
        contagem.falhou++;
        continue;
      }
      const divergencias = (j.divergencias ?? []) as unknown as Divergencia[];
      const incertezas = (j.incertezas ?? []) as unknown as Incerteza[];
      const gravidade = classificarAuditoria({ veredito: j.veredito, divergencias, incertezas });
      contagem[gravidade] = (contagem[gravidade] ?? 0) + 1;
      if (gravidade === "CONFERE") continue;
      itens.push({
        viagemId: j.viagemId,
        gravidade,
        ticket: j.viagem.ticket,
        data: j.viagem.data,
        statusViagem: j.viagem.status,
        aprovadaPelaIa: !!j.viagem.conferidoPorIaEm,
        motorista: j.viagem.motorista?.nome ?? null,
        campos: [
          ...divergencias.map((d) => ({ campo: d.campo, lancado: d.declarado, lido: d.lido })),
          ...incertezas.map((i) => ({ campo: i.campo, lancado: i.declarado, lido: i.lido })),
        ],
      });
    }

    const ordem: GravidadeAuditoria[] = ["PESO_OU_TICKET", "PLACA_OU_DATA", "SEM_CONCLUSAO", "SO_VINCULO"];
    itens.sort((a, b) => ordem.indexOf(a.gravidade) - ordem.indexOf(b.gravidade));
    return { contagem, itens };
  }
}
