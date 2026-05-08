import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

export type ReportarErroInput = {
  origem: "motorista-app" | "dashboard" | "api";
  message: string;
  stack?: string;
  versao?: string;
  userId?: string;
  userType?: string;
  url?: string;
  userAgent?: string;
  extra?: unknown;
};

export type ListarErrosFiltro = {
  origem?: string;
  hash?: string;
  userId?: string;
  desde?: Date;
  ate?: Date;
  limit?: number;
  /** "pendentes" (default) | "resolvidos" | "todos" */
  status?: "pendentes" | "resolvidos" | "todos";
};

@Injectable()
export class ErrorsService {
  constructor(private readonly prisma: PrismaService) {}

  async reportar(input: ReportarErroInput) {
    const hash = this.gerarHash(input.message, input.stack);
    return this.prisma.errorLog.create({
      data: {
        hash,
        origem: input.origem,
        message: input.message.slice(0, 500),
        stack: input.stack?.slice(0, 20_000),
        versao: input.versao,
        userId: input.userId,
        userType: input.userType,
        url: input.url?.slice(0, 500),
        userAgent: input.userAgent?.slice(0, 500),
        extra: input.extra as never,
      },
    });
  }

  /**
   * Lista agrupada por hash. Cada item = um "tipo" de erro com contagem.
   * Ordenado por última ocorrência desc.
   */
  async agrupados(filtro: ListarErrosFiltro = {}) {
    const where: Record<string, unknown> = {};
    if (filtro.origem) where.origem = filtro.origem;
    if (filtro.userId) where.userId = filtro.userId;
    const status = filtro.status ?? "pendentes";
    if (status === "pendentes") where.resolvido = false;
    else if (status === "resolvidos") where.resolvido = true;
    if (filtro.desde || filtro.ate) {
      where.capturadoEm = {} as Record<string, Date>;
      if (filtro.desde) (where.capturadoEm as Record<string, Date>).gte = filtro.desde;
      if (filtro.ate) (where.capturadoEm as Record<string, Date>).lte = filtro.ate;
    }

    const grupos = await this.prisma.errorLog.groupBy({
      by: ["hash"],
      where,
      _count: { _all: true },
      _max: { capturadoEm: true, message: true, origem: true, resolvidoEm: true },
      _min: { capturadoEm: true },
      orderBy: { _max: { capturadoEm: "desc" } },
      take: filtro.limit ?? 100,
    });

    return grupos.map((g) => ({
      hash: g.hash,
      origem: g._max.origem ?? "?",
      message: g._max.message ?? "",
      ocorrencias: g._count._all,
      primeiraOcorrencia: g._min.capturadoEm,
      ultimaOcorrencia: g._max.capturadoEm,
      resolvido: status === "resolvidos",
      resolvidoEm: g._max.resolvidoEm,
    }));
  }

  /**
   * Marca todas as ocorrências de um hash como resolvidas. Eventos novos
   * do mesmo hash entram como pendentes — esse marcador é só pra "limpei
   * o que apareceu até agora". Se o erro voltar, aparece como pendente.
   */
  async resolverGrupo(hash: string, resolvidoPorId: string) {
    return this.prisma.errorLog.updateMany({
      where: { hash, resolvido: false },
      data: { resolvido: true, resolvidoEm: new Date(), resolvidoPorId },
    });
  }

  async reabrirGrupo(hash: string) {
    return this.prisma.errorLog.updateMany({
      where: { hash, resolvido: true },
      data: { resolvido: false, resolvidoEm: null, resolvidoPorId: null },
    });
  }

  /**
   * Lista ocorrências individuais (com filtro por hash pra "ver todas").
   */
  async listar(filtro: ListarErrosFiltro & { hash?: string }) {
    const where: Record<string, unknown> = {};
    if (filtro.origem) where.origem = filtro.origem;
    if (filtro.userId) where.userId = filtro.userId;
    if (filtro.hash) where.hash = filtro.hash;
    if (filtro.desde || filtro.ate) {
      where.capturadoEm = {} as Record<string, Date>;
      if (filtro.desde) (where.capturadoEm as Record<string, Date>).gte = filtro.desde;
      if (filtro.ate) (where.capturadoEm as Record<string, Date>).lte = filtro.ate;
    }

    return this.prisma.errorLog.findMany({
      where,
      orderBy: { capturadoEm: "desc" },
      take: filtro.limit ?? 100,
    });
  }

  async detalhe(id: string) {
    return this.prisma.errorLog.findUnique({ where: { id } });
  }

  /**
   * Hash sha256 dos primeiros 1000 chars do stack normalizado +
   * mensagem. Ignora números (line:col) pra agrupar a mesma linha de
   * código mesmo se reposicionou no bundle.
   */
  private gerarHash(message: string, stack?: string): string {
    const normalizado = (stack ?? message)
      .slice(0, 1000)
      .replace(/:\d+:\d+/g, ":N:N")
      .replace(/0x[0-9a-f]+/gi, "0xN")
      .replace(/\d{4,}/g, "N");
    return createHash("sha256")
      .update(`${message}\n${normalizado}`)
      .digest("hex")
      .slice(0, 16);
  }
}
