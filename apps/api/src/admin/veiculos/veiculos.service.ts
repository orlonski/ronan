import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CriarVeiculoInput, AtualizarVeiculoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { adotarLancamentosOrfaos } from "../../common/transportadora";
import { filtroEscopo, type EscopoAdmin } from "../../common/escopo/escopo";

type ListVeiculosParams = PaginationQuery & {
  ativo?: "true" | "false";
  transportadoraId?: string;
  semTransportadora?: "true";
};

const TRANSPORTADORA_SELECT = { select: { id: true, nome: true } };

@Injectable()
export class VeiculosService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: ListVeiculosParams, escopo: EscopoAdmin) {
    const where: Prisma.VeiculoWhereInput = {};
    if (params.ativo === "true") where.ativo = true;
    if (params.ativo === "false") where.ativo = false;
    if (params.transportadoraId) where.transportadoraId = params.transportadoraId;
    if (params.semTransportadora === "true") where.transportadoraId = null;
    return paginate(this.prisma.veiculo, {
      params,
      where: where as Record<string, unknown>,
      escopo,
      searchFields: ["placa", "modelo"],
      sortable: {
        placa: "placa",
        modelo: "modelo",
        criadoEm: "criadoEm",
        ativo: "ativo",
        transportadora: "transportadora.nome",
      },
      defaultSort: { field: "placa", order: "asc" },
      include: {
        criadoPor: { select: { id: true, nome: true } },
        transportadora: TRANSPORTADORA_SELECT,
      },
    });
  }

  /** Item por id — usado pelo combobox do painel pra resolver o label de um
   *  veículo já selecionado que não caiu na página atual da busca. */
  async findOne(id: string, escopo: EscopoAdmin) {
    // findFirst + 404 (não 403): não confirma existência de placa de outra frota.
    const v = await this.prisma.veiculo.findFirst({
      where: { id, ...filtroEscopo(escopo) },
      include: { transportadora: TRANSPORTADORA_SELECT },
    });
    if (!v) throw new NotFoundException("Veículo não encontrado");
    return v;
  }

  async create(data: CriarVeiculoInput, usuarioId: string) {
    const exists = await this.prisma.veiculo.findUnique({ where: { placa: data.placa } });
    if (exists) throw new ConflictException("Placa já cadastrada");
    return this.prisma.veiculo.create({ data: { ...data, criadoPorId: usuarioId } });
  }

  async update(id: string, data: AtualizarVeiculoInput) {
    const antes = await this.ensureExists(id);
    const veiculo = await this.prisma.veiculo.update({ where: { id }, data });
    // Classificou uma placa que ainda não tinha frota: adota o histórico dela
    // que está sem dono, senão o gestor loga e não vê nada do que já rodou.
    if (!antes.transportadoraId && veiculo.transportadoraId) {
      await adotarLancamentosOrfaos(
        this.prisma,
        { veiculoId: id },
        veiculo.transportadoraId,
      );
    }
    return veiculo;
  }

  async remove(id: string) {
    await this.ensureExists(id);
    const [viagens, pedagios, abastecimentos, motoristas] = await Promise.all([
      this.prisma.viagem.count({ where: { veiculoId: id } }),
      this.prisma.pedagio.count({ where: { veiculoId: id } }),
      this.prisma.abastecimento.count({ where: { veiculoId: id } }),
      this.prisma.motorista.count({ where: { veiculoDefaultId: id } }),
    ]);
    const partes: string[] = [];
    if (viagens > 0) partes.push(`${viagens} viagem${viagens === 1 ? "" : "s"}`);
    if (pedagios > 0) partes.push(`${pedagios} pedágio${pedagios === 1 ? "" : "s"}`);
    if (abastecimentos > 0)
      partes.push(`${abastecimentos} abastecimento${abastecimentos === 1 ? "" : "s"}`);
    if (motoristas > 0)
      partes.push(`${motoristas} motorista${motoristas === 1 ? "" : "s"} com este como veículo padrão`);
    if (partes.length > 0) {
      throw new ConflictException(
        `Não é possível excluir: vinculado a ${partes.join(", ")}. Use o toggle de ativar/inativar pra esconder sem perder o histórico.`,
      );
    }
    await this.prisma.veiculo.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const v = await this.prisma.veiculo.findUnique({ where: { id } });
    if (!v) throw new NotFoundException("Veículo não encontrado");
    return v;
  }
}
