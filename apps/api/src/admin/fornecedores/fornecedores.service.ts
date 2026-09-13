import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AtualizarFornecedorInput,
  CriarCustoFixoInput,
  CriarFornecedorInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";

@Injectable()
export class FornecedoresService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: PaginationQuery & { tipo?: string; ativo?: string }) {
    const where: Prisma.FornecedorWhereInput = {};
    if (params.tipo) where.tipo = params.tipo as Prisma.FornecedorWhereInput["tipo"];
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    return paginate(this.prisma.fornecedor, {
      params,
      where: where as Record<string, unknown>,
      // Fornecedor é da empresa inteira, não de uma frota.
      escopo: SEM_ESCOPO,
      searchFields: ["nome", "cnpjCpf", "observacao"],
      sortable: { nome: "nome", tipo: "tipo", criadoEm: "criadoEm" },
      defaultSort: { field: "nome", order: "asc" },
    });
  }

  async findOne(id: string) {
    const f = await this.prisma.fornecedor.findUnique({ where: { id } });
    if (!f) throw new NotFoundException("Fornecedor não encontrado");
    return f;
  }

  create(data: CriarFornecedorInput) {
    return this.prisma.fornecedor.create({ data });
  }

  async update(id: string, data: AtualizarFornecedorInput) {
    await this.findOne(id);
    return this.prisma.fornecedor.update({ where: { id }, data });
  }

  /**
   * Fornecedor com conta lançada vira inativo em vez de sumir: apagar deixaria
   * o título a pagar apontando pro vazio, e o histórico do que se gastou com
   * quem é justamente o motivo de existir cadastro de fornecedor.
   */
  async remove(id: string) {
    await this.findOne(id);
    const usos = await this.prisma.tituloPagar.count({ where: { fornecedorId: id } });
    if (usos > 0) {
      await this.prisma.fornecedor.update({ where: { id }, data: { ativo: false } });
      return { ok: true, desativado: true, titulos: usos };
    }
    await this.prisma.fornecedor.delete({ where: { id } });
    return { ok: true, desativado: false, titulos: 0 };
  }

  listCustos(veiculoId?: string) {
    return this.prisma.custoFixoVeiculo.findMany({
      where: veiculoId ? { veiculoId } : {},
      include: { veiculo: { select: { id: true, placa: true } } },
      orderBy: [{ veiculoId: "asc" }, { vigenciaDe: "desc" }],
    });
  }

  async criarCusto(data: CriarCustoFixoInput) {
    const v = await this.prisma.veiculo.findUnique({ where: { id: data.veiculoId } });
    if (!v) throw new NotFoundException("Veículo não encontrado");

    // Dois custos do mesmo tipo valendo ao mesmo tempo dobrariam o rateio sem
    // ninguém perceber — o custo/km sairia inflado e a margem, negativa.
    const conflito = await this.prisma.custoFixoVeiculo.findFirst({
      where: {
        veiculoId: data.veiculoId,
        tipo: data.tipo,
        OR: [
          { vigenciaAte: null },
          { vigenciaAte: { gte: new Date(`${data.vigenciaDe}T00:00:00Z`) } },
        ],
      },
    });
    if (conflito) {
      throw new ConflictException(
        `Já existe um custo de ${data.tipo} valendo pra esse caminhão. Feche a vigência do antigo antes.`,
      );
    }

    return this.prisma.custoFixoVeiculo.create({
      data: {
        ...data,
        vigenciaDe: new Date(`${data.vigenciaDe}T00:00:00Z`),
        vigenciaAte: data.vigenciaAte ? new Date(`${data.vigenciaAte}T00:00:00Z`) : null,
      },
    });
  }

  async removerCusto(id: string) {
    const c = await this.prisma.custoFixoVeiculo.findUnique({ where: { id } });
    if (!c) throw new NotFoundException("Custo não encontrado");
    await this.prisma.custoFixoVeiculo.delete({ where: { id } });
    return { ok: true };
  }
}
