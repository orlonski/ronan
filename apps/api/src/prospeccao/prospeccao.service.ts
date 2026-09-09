import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Leitura e manutenção da base de captação.
 *
 * Tudo em `comoSistema`: Lead, InteracaoLead e SupressaoContato são da
 * plataforma e não têm `contaId`.
 */
@Injectable()
export class ProspeccaoService {
  private readonly log = new Logger("Prospeccao");

  constructor(private readonly prisma: PrismaService) {}

  async resumo() {
    return comoSistema(async () => {
      const [total, porStatus, porUf, comTelefone, comEmail, suprimidos] = await Promise.all([
        this.prisma.lead.count(),
        this.prisma.lead.groupBy({ by: ["status"], _count: true }),
        this.prisma.lead.groupBy({
          by: ["uf"],
          _count: true,
          orderBy: { _count: { uf: "desc" } },
          take: 10,
        }),
        this.prisma.lead.count({ where: { telefone: { not: null } } }),
        this.prisma.lead.count({ where: { email: { not: null } } }),
        this.prisma.supressaoContato.count(),
      ]);

      return {
        total,
        // O que falta pra base virar acionável: lead sem contato não dá pra abordar.
        comTelefone,
        comEmail,
        semContatoNenhum: total - (await this.contarSemContato()),
        porStatus: porStatus.map((s) => ({ status: s.status, total: s._count })),
        porUf: porUf.map((u) => ({ uf: u.uf ?? "—", total: u._count })),
        suprimidos,
      };
    });
  }

  private async contarSemContato(): Promise<number> {
    return this.prisma.lead.count({
      where: { OR: [{ telefone: { not: null } }, { email: { not: null } }] },
    });
  }

  async listar(filtros: {
    uf?: string;
    municipio?: string;
    status?: string;
    scoreMinimo?: number;
    comContato?: boolean;
    pagina: number;
    porPagina: number;
  }) {
    const porPagina = Math.min(Math.max(filtros.porPagina, 1), 200);
    const pagina = Math.max(filtros.pagina, 1);

    const where: Prisma.LeadWhereInput = {
      // Quem pediu pra sair nunca aparece numa lista de trabalho. O filtro é
      // aqui, no ponto único de leitura, e não na tela — tela se esquece.
      optOut: false,
    };

    if (filtros.uf) where.uf = filtros.uf.toUpperCase();
    if (filtros.municipio) {
      where.municipio = { contains: filtros.municipio, mode: "insensitive" };
    }
    if (filtros.status) where.status = filtros.status;
    if (typeof filtros.scoreMinimo === "number") {
      where.score = { gte: filtros.scoreMinimo };
    }
    if (filtros.comContato === true) {
      where.OR = [{ telefone: { not: null } }, { email: { not: null } }];
    }
    if (filtros.comContato === false) {
      where.AND = [{ telefone: null }, { email: null }];
    }

    return comoSistema(async () => {
      const [itens, total] = await Promise.all([
        this.prisma.lead.findMany({
          where,
          orderBy: [{ score: "desc" }, { registradoEm: "desc" }],
          skip: (pagina - 1) * porPagina,
          take: porPagina,
          include: {
            _count: { select: { interacoes: true } },
          },
        }),
        this.prisma.lead.count({ where }),
      ]);

      return { itens, total, pagina, porPagina };
    });
  }

  /**
   * Normaliza telefone pra dígitos e e-mail pra minúsculas — sem isso o mesmo
   * contato entra duas vezes e a supressão falha justamente quando importa.
   */
  static normalizarContato(bruto: string): { contato: string; tipo: "TELEFONE" | "EMAIL" } {
    const limpo = bruto.trim();
    if (limpo.includes("@")) {
      return { contato: limpo.toLowerCase(), tipo: "EMAIL" };
    }
    return { contato: limpo.replace(/\D/g, ""), tipo: "TELEFONE" };
  }

  /**
   * Supressão global: vale pra todos os canais e sobrevive à próxima carga do
   * RNTRC. Marca também os leads que já têm esse contato.
   */
  async registrarOptOut(bruto: string, motivo?: string, fonte?: string) {
    if (!bruto?.trim()) throw new BadRequestException("Informe o telefone ou e-mail");

    const { contato, tipo } = ProspeccaoService.normalizarContato(bruto);
    if (!contato) throw new BadRequestException("Contato inválido");

    return comoSistema(async () => {
      await this.prisma.supressaoContato.upsert({
        where: { contato },
        create: { contato, tipo, motivo, fonte },
        update: { motivo, fonte },
      });

      const { count } = await this.prisma.lead.updateMany({
        where: tipo === "EMAIL" ? { email: contato } : { telefone: contato },
        data: { optOut: true, optOutEm: new Date() },
      });

      this.log.log(`Opt-out registrado (${tipo}) — ${count} lead(s) marcado(s)`);
      return { contato, tipo, leadsMarcados: count };
    });
  }

  /** Um contato está suprimido? Consulte ANTES de qualquer envio. */
  async estaSuprimido(bruto: string): Promise<boolean> {
    const { contato } = ProspeccaoService.normalizarContato(bruto);
    if (!contato) return false;
    const achado = await comoSistema(async () =>
      this.prisma.supressaoContato.findUnique({ where: { contato } }),
    );
    return achado !== null;
  }
}
