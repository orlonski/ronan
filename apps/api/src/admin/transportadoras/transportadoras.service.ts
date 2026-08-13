import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AtualizarTransportadoraInput,
  CriarTransportadoraInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

type ListTransportadorasParams = PaginationQuery & {
  ativa?: "true" | "false";
};

@Injectable()
export class TransportadorasService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListTransportadorasParams) {
    const where: Prisma.TransportadoraWhereInput = {};
    if (params.ativa === "true") where.ativa = true;
    if (params.ativa === "false") where.ativa = false;
    return paginate(this.prisma.transportadora, {
      params,
      where: where as Record<string, unknown>,
      // Model sem coluna de frota: não há o que filtrar por transportadora. O
      // isolamento entre EMPRESAS aqui é da trava de conta; o recorte por frota
      // fica com a matriz de papéis (não existe guard de escopo — ver escopo.ts).
      escopo: SEM_ESCOPO,
      searchFields: ["nome", "cnpj", "contato"],
      sortable: { nome: "nome", cnpj: "cnpj", ativa: "ativa", criadoEm: "criadoEm" },
      defaultSort: { field: "nome", order: "asc" },
      include: {
        criadoPor: { select: { id: true, nome: true } },
        _count: { select: { motoristas: true, veiculos: true, usuarios: true } },
      },
    });
  }

  findOne(id: string) {
    return this.prisma.transportadora.findUniqueOrThrow({
      where: { id },
      include: {
        criadoPor: { select: { id: true, nome: true } },
        _count: { select: { motoristas: true, veiculos: true, usuarios: true } },
      },
    });
  }

  /**
   * Quantos motoristas e veículos ainda não foram classificados. Alimenta o
   * aviso na tela — enquanto houver não classificados, os lançamentos deles
   * nascem sem dono e ficam invisíveis pros usuários restritos.
   */
  async naoClassificados() {
    const [motoristas, veiculos] = await Promise.all([
      this.prisma.motorista.count({ where: { transportadoraId: null, ativo: true } }),
      this.prisma.veiculo.count({ where: { transportadoraId: null, ativo: true } }),
    ]);
    return { motoristas, veiculos };
  }

  async create(data: CriarTransportadoraInput, usuarioId: string) {
    if (data.cnpj) {
      const exists = await this.prisma.transportadora.findFirst({
        where: { cnpj: data.cnpj },
      });
      if (exists) throw new ConflictException("CNPJ já cadastrado");
    }
    return this.prisma.transportadora.create({
      data: { ...data, criadoPorId: usuarioId } as Prisma.TransportadoraUncheckedCreateInput,
    });
  }

  async update(id: string, data: AtualizarTransportadoraInput) {
    await this.ensureExists(id);
    if (data.cnpj) {
      const exists = await this.prisma.transportadora.findFirst({
        where: { cnpj: data.cnpj },
      });
      if (exists && exists.id !== id) throw new ConflictException("CNPJ já cadastrado");
    }
    return this.prisma.transportadora.update({
      where: { id },
      data: data as Prisma.TransportadoraUncheckedUpdateInput,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Viagem/Pedagio/Abastecimento saem em SetNull, mas apagar uma frota com
    // histórico faria os lançamentos dela virarem "sem dono" — some da tela do
    // gestor sem explicação. Bloqueia e manda inativar.
    const [motoristas, veiculos, viagens, usuarios] = await Promise.all([
      this.prisma.motorista.count({ where: { transportadoraId: id } }),
      this.prisma.veiculo.count({ where: { transportadoraId: id } }),
      this.prisma.viagem.count({ where: { transportadoraId: id } }),
      this.prisma.usuarioTransportadora.count({ where: { transportadoraId: id } }),
    ]);
    const partes: string[] = [];
    if (motoristas > 0) partes.push(`${motoristas} motorista${motoristas === 1 ? "" : "s"}`);
    if (veiculos > 0) partes.push(`${veiculos} veículo${veiculos === 1 ? "" : "s"}`);
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "ns"}`);
    if (usuarios > 0) partes.push(`${usuarios} usuário${usuarios === 1 ? "" : "s"} com acesso`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculada a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    await this.prisma.transportadora.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const t = await this.prisma.transportadora.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Transportadora não encontrada");
    return t;
  }
}
