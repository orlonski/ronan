import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CriarVeiculoInput, AtualizarVeiculoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

const SAFE_SELECT = {
  id: true,
  placa: true,
  modelo: true,
  ativo: true,
  criadoEm: true,
  alteradoEm: true,
  motoristas: {
    select: { motorista: { select: { id: true, nome: true, cpf: true, ativo: true } } },
    orderBy: { motorista: { nome: "asc" } },
  },
} as const;

@Injectable()
export class VeiculosService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.veiculo.findMany({
      select: SAFE_SELECT,
      orderBy: { placa: "asc" },
    });
    return rows.map((v) => this.flatten(v));
  }

  async create(data: CriarVeiculoInput) {
    const exists = await this.prisma.veiculo.findUnique({ where: { placa: data.placa } });
    if (exists) throw new ConflictException("Placa já cadastrada");
    await this.ensureMotoristasExistem(data.motoristaIds);
    const created = await this.prisma.veiculo.create({
      data: {
        placa: data.placa,
        modelo: data.modelo,
        motoristas: { create: data.motoristaIds.map((motoristaId) => ({ motoristaId })) },
      },
      select: SAFE_SELECT,
    });
    return this.flatten(created);
  }

  async update(id: string, data: AtualizarVeiculoInput) {
    const atual = await this.prisma.veiculo.findUnique({
      where: { id },
      include: { motoristas: { select: { motoristaId: true } } },
    });
    if (!atual) throw new NotFoundException("Veículo não encontrado");

    const motoristaIdsAtuais = atual.motoristas.map((m) => m.motoristaId);
    const motoristaIdsNovos = data.motoristaIds ?? motoristaIdsAtuais;

    if (motoristaIdsNovos.length === 0) {
      throw new BadRequestException("Veículo precisa de pelo menos 1 motorista vinculado");
    }

    const removidos = motoristaIdsAtuais.filter((mid) => !motoristaIdsNovos.includes(mid));
    const adicionados = motoristaIdsNovos.filter((mid) => !motoristaIdsAtuais.includes(mid));

    if (adicionados.length > 0) await this.ensureMotoristasExistem(adicionados);

    const { motoristaIds: _ignore, ...rest } = data;
    const updateData: Record<string, unknown> = { ...rest };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (removidos.length > 0) {
        // Se removo um motorista que tinha esse veículo como default, limpa o default dele
        await tx.motorista.updateMany({
          where: { id: { in: removidos }, veiculoDefaultId: id },
          data: { veiculoDefaultId: null },
        });
        await tx.motoristaVeiculo.deleteMany({
          where: { veiculoId: id, motoristaId: { in: removidos } },
        });
      }
      if (adicionados.length > 0) {
        await tx.motoristaVeiculo.createMany({
          data: adicionados.map((motoristaId) => ({ veiculoId: id, motoristaId })),
          skipDuplicates: true,
        });
      }
      return tx.veiculo.update({ where: { id }, data: updateData, select: SAFE_SELECT });
    });
    return this.flatten(updated);
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

  private async ensureMotoristasExistem(ids: string[]) {
    if (ids.length === 0) return;
    const count = await this.prisma.motorista.count({ where: { id: { in: ids } } });
    if (count !== ids.length) {
      throw new NotFoundException("Um ou mais motoristas não foram encontrados");
    }
  }

  private flatten<M>(v: { motoristas: { motorista: M }[] } & Record<string, unknown>) {
    const { motoristas, ...rest } = v;
    return { ...rest, motoristas: motoristas.map((m) => m.motorista) };
  }
}
